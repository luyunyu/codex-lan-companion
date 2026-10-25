import { promises as fs } from "node:fs";

export function subagentInfo(row) {
  for (let source of [row?.threadSource, row?.source]) {
    if (source === "guardian_review" || source === "subagent") return { isSubagent: true, parentId: null };
    if (typeof source === "string") {
      try { source = JSON.parse(source); } catch { continue; }
    }
    if (!source || typeof source !== "object" || !Object.hasOwn(source, "subagent")) continue;
    const spawn = source.subagent?.thread_spawn;
    return {
      isSubagent: true,
      parentId: typeof spawn?.parent_thread_id === "string" ? spawn.parent_thread_id : null,
      nickname: typeof spawn?.agent_nickname === "string" ? spawn.agent_nickname : "",
      agentRole: typeof spawn?.agent_role === "string" ? spawn.agent_role : ""
    };
  }
  return { isSubagent: false, parentId: null };
}

export function sidebarThreadPage(rows, options, paginate) {
  const page = paginate(rows.filter((row) => !subagentInfo(row).isSubagent), options);
  // Keep a child open across sidebar polling, searches and page changes.
  page.selectedThread = rows.find((row) => row.id === options.selectedId) || null;
  return page;
}

export function childThreads(rows, parentId) {
  return rows.flatMap((row) => {
    const info = subagentInfo(row);
    if (row.id === parentId || !info.isSubagent || info.parentId !== parentId) return [];
    return [{ ...row, parentId, agentNickname: info.nickname, agentRole: info.agentRole,
      title: info.nickname || (row.title && row.title !== "Untitled" ? row.title : info.agentRole || "Subagent") }];
  });
}

// Index/IPC fallbacks can omit source metadata. Read only the session header.
export class SessionMetadataReader {
  constructor({ maxBytes = 64 * 1024, maxEntries = 2000 } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.epoch = 0;
  }

  clear() {
    this.epoch += 1;
    this.cache.clear();
  }

  async read(filePath) {
    if (!filePath) return {};
    const epoch = this.epoch;
    let handle;
    try {
      handle = await fs.open(filePath, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) return {};
      const cached = this.cache.get(filePath);
      const unchanged = stat.size === cached?.size && stat.mtimeMs === cached?.mtimeMs;
      if (cached?.ino === stat.ino && cached.dev === stat.dev && (unchanged || stat.size > cached.size)) return cached.meta;
      const buffer = Buffer.alloc(Math.min(this.maxBytes, stat.size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry.type !== "session_meta") continue;
        const meta = { source: entry.payload?.source };
        if (epoch === this.epoch) {
          this.cache.delete(filePath);
          this.cache.set(filePath, { ino: stat.ino, dev: stat.dev, size: stat.size, mtimeMs: stat.mtimeMs, meta });
          while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
        }
        return meta;
      }
      return {};
    } catch {
      if (epoch === this.epoch) this.cache.delete(filePath);
      return {};
    } finally {
      await handle?.close();
    }
  }
}
