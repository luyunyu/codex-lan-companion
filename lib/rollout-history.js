import { open } from "node:fs/promises";

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
