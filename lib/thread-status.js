import { promises as fs } from "node:fs";

// List polling reads lifecycle events only, never builds message bodies.
export class ThreadStatusReader {
  constructor({ maxBytes = 512 * 1024, staleMs = 10 * 60 * 1000, maxEntries = 1000 } = {}) {
    this.maxBytes = maxBytes;
    this.staleMs = staleMs;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.epoch = 0;
  }

  clear() {
    this.epoch += 1;
    this.cache.clear();
  }

  async read(filePath, nowMs = Date.now()) {
    if (!filePath) return { running: null };
    const epoch = this.epoch;
    let handle;
    try {
      handle = await fs.open(filePath, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) return { running: null };
      const previous = this.cache.get(filePath);
      const sameFile = previous?.ino === stat.ino && previous?.dev === stat.dev;
      const unchanged = sameFile && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs;
      let state = unchanged ? { ...previous } : null;
      if (!state) {
        const incremental = sameFile && stat.size > previous.size && stat.size - previous.offset <= this.maxBytes;
        const start = incremental ? previous.offset : Math.max(0, stat.size - this.maxBytes);
        state = incremental ? { ...previous } : { running: start === 0 ? false : null, completed: false, turnId: null, lastEntryAtMs: 0 };
        const buffer = Buffer.alloc(stat.size - start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        const data = buffer.subarray(0, bytesRead);
        const end = data.lastIndexOf(10);
        const first = !incremental && start > 0 ? data.indexOf(10) + 1 : 0;
        if (end >= first) {
          for (const line of data.subarray(first, end).toString("utf8").split("\n")) {
            try {
              const entry = JSON.parse(line);
              const timestamp = Date.parse(entry.timestamp);
              if (Number.isFinite(timestamp)) state.lastEntryAtMs = timestamp;
              if (entry.type !== "event_msg") continue;
              const payload = entry.payload;
              if (payload?.type === "task_started") {
                state.running = true;
                state.completed = false;
                state.turnId = payload.turn_id || null;
              } else if (payload?.type === "task_complete" || payload?.type === "turn_aborted") {
                if (!state.running || !payload.turn_id || !state.turnId || payload.turn_id === state.turnId) {
                  state.running = false;
                  state.completed = payload.type === "task_complete";
                  state.turnId = null;
                }
              }
            } catch {
              // Ignore malformed lines and retry incomplete trailing lines next time.
            }
          }
        }
        state.offset = end >= 0 ? start + end + 1 : start;
        Object.assign(state, { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev });
        if (epoch === this.epoch) {
          this.cache.delete(filePath);
          this.cache.set(filePath, state);
          while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
        }
      }
      const stale = state.running && nowMs - Math.max(state.lastEntryAtMs, stat.mtimeMs) > this.staleMs;
      return { running: stale ? false : state.running, completed: Boolean(state.completed) };
    } catch {
      if (epoch === this.epoch) this.cache.delete(filePath);
      return { running: null };
    } finally {
      await handle?.close();
    }
  }
}
