import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

async function paginatedSessionId(filePath) {
  const handle = await open(filePath, "r");
  try {
    // Metadata can include large instructions; cap header reads at 1 MiB.
    let buffer = Buffer.alloc(0);
    while (buffer.length < 1024 * 1024) {
      const chunk = Buffer.alloc(16 * 1024);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, buffer.length);
      if (!bytesRead) return null;
      buffer = Buffer.concat([buffer, chunk.subarray(0, bytesRead)]);
      const end = buffer.indexOf(10);
      if (end < 0) continue;
      buffer = buffer.subarray(0, end);
      break;
    }
    const entry = JSON.parse(buffer.toString("utf8"));
    return entry.type === "session_meta" && entry.payload?.history_mode === "paginated"
      ? entry.payload.session_id || entry.payload.id : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

// Desktop can resume a paginated session in a new rollout. Treat its files as
// one byte address space so existing history cursors remain bounded and unique.
export async function rolloutHistoryFiles(filePath) {
  const latest = await stat(filePath);
  const single = [{ filePath, ...latest, start: 0 }];
  const id = await paginatedSessionId(filePath);
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) return single;
  let root = path.dirname(filePath);
  // Only traverse the numeric date directories of the containing sessions tree.
  const dateDirectory = /[/\\]sessions[/\\]\d{4}[/\\]\d{2}[/\\]\d{2}$/;
  if (dateDirectory.test(root)) root = path.dirname(path.dirname(path.dirname(root)));
  const candidates = [];
  const filenamePattern = new RegExp(`^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-${id}(?:_[0-9a-f-]{36})?\\.jsonl$`, "i");
  async function visit(directory, depth) {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) {
        await visit(path.join(directory, entry.name), depth + 1);
      } else if (entry.isFile() && filenamePattern.test(entry.name)) {
        candidates.push(path.join(directory, entry.name));
      }
    }));
  }
  await visit(root, 0);
  const files = [];
  for (const candidate of candidates.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))) {
    // Ignore successors until the database points to them; never import another
    // session merely because its filename contains the requested ID.
    if (path.basename(candidate) > path.basename(filePath)) continue;
    if (candidate === filePath || await paginatedSessionId(candidate) === id) {
      files.push({ filePath: candidate, ...(candidate === filePath ? latest : await stat(candidate)) });
    }
  }
  if (!files.some((file) => file.filePath === filePath)) return single;
  let start = 0;
  return files.map((file) => {
    const segment = { ...file, start };
    start += file.size;
    return segment;
  });
}

export async function readRolloutHistoryWindow(filePath, options) {
  if (!options.files) return readRolloutWindow(filePath, options);
  const { files, size, maxBytes } = options;
  let end = options.before == null ? size : Number(options.before);
  if (!Number.isSafeInteger(end) || end < 0 || end > size || (options.before != null && !/^\d+$/.test(String(options.before)))) {
    const error = new Error("Invalid history cursor; reload the conversation.");
    error.status = 400;
    throw error;
  }
  const entries = [];
  const initialEnd = end;
  for (let index = files.length - 1; index >= 0; index--) {
    const file = files[index];
    if (end <= file.start) continue;
    const window = await readRolloutWindow(file.filePath, {
      ...options, size: file.size, before: end - file.start,
      maxBytes: Math.max(1, maxBytes - (initialEnd - end))
    });
    entries.unshift(...window.entries.map((entry) => ({ ...entry, offset: file.start + entry.offset })));
    end = file.start + window.startOffset;
    if (window.startOffset > 0 || initialEnd - end >= maxBytes) break;
  }
  return { entries, startOffset: end };
}

// Read complete JSONL records backwards. UTF-8 is decoded only after joining
// chunk boundaries; even a record larger than the window is never cut in half.
export async function readRolloutWindow(filePath, { before, size, maxBytes, chunkSize = 64 * 1024, mapLine = (line) => line }) {
  const end = before == null ? size : Number(before);
  if (!Number.isSafeInteger(end) || end < 0 || end > size || (before != null && !/^\d+$/.test(String(before)))) {
    const error = new Error("Invalid history cursor; reload the conversation.");
    error.status = 400;
    throw error;
  }
  const handle = await open(filePath, "r");
  const entries = [];
  let position = end;
  let pending = Buffer.alloc(0);
  let startOffset = end;
  try {
    while (position > 0) {
      const start = Math.max(0, position - chunkSize);
      const buffer = Buffer.alloc(position - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      if (bytesRead !== buffer.length) throw new Error("Conversation file changed while reading history; retry.");
      const joined = Buffer.concat([buffer, pending]);
      let lineEnd = joined.length;
      let newline;
      while ((newline = joined.lastIndexOf(10, lineEnd - 1)) >= 0 && lineEnd > 0) {
        const offset = start + newline + 1;
        const line = joined.subarray(newline + 1, lineEnd).toString("utf8").replace(/\r$/, "");
        if (line.trim()) {
          const mapped = mapLine(line);
          if (mapped != null) entries.push({ line: mapped, offset });
          startOffset = offset;
          if (end - offset >= maxBytes) return { entries: entries.reverse(), startOffset };
        }
        lineEnd = newline;
      }
      pending = Buffer.from(joined.subarray(0, lineEnd));
      position = start;
    }
    if (pending.length) {
      const mapped = mapLine(pending.toString("utf8").replace(/\r$/, ""));
      if (mapped != null) entries.push({ line: mapped, offset: 0 });
    }
    return { entries: entries.reverse(), startOffset: 0 };
  } finally {
    await handle.close();
  }
}
