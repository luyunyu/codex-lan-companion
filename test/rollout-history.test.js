import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { readRolloutWindow } from "../lib/rollout-history.js";
import { stripInjectedUserContext } from "../lib/user-message-content.js";
import { mergeMessageHistory } from "../public/message-history.js";

async function fixture(t, text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lan-history-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "rollout.jsonl");
  await fs.writeFile(file, text);
  return { file, size: Buffer.byteLength(text) };
}

test("backward windows preserve UTF-8, CRLF, byte offsets and oversized records", async (t) => {
  const lines = ["最早", "中文🙂".repeat(150), "last", "no final newline"];
  const text = lines.join("\r\n");
  const { file, size } = await fixture(t, text);
  let before = size;
  const all = [];
  do {
    const page = await readRolloutWindow(file, { size, before, maxBytes: 30, chunkSize: 11 });
    assert.ok(page.startOffset < before);
    all.unshift(...page.entries);
    before = page.startOffset;
  } while (before > 0);
  assert.deepEqual(all.map((entry) => entry.line), lines);
  for (const { offset, line } of all) assert.equal(Buffer.from(text).subarray(offset, offset + Buffer.byteLength(line)).toString(), line);
});

test("cursor validation and empty files do not loop", async (t) => {
  const { file, size } = await fixture(t, "");
  assert.deepEqual(await readRolloutWindow(file, { size, maxBytes: 40 }), { entries: [], startOffset: 0 });
  for (const before of [-1, 1, "NaN", "1.5", "", "Infinity"]) {
    await assert.rejects(readRolloutWindow(file, { size, before, maxBytes: 40 }), { status: 400 });
  }
});

test("filtered-out byte windows still advance their cursors", async (t) => {
  const { file, size } = await fixture(t, `keep\n${"skip\n".repeat(100)}`);
  const first = await readRolloutWindow(file, { size, maxBytes: 30, mapLine: () => null });
  assert.equal(first.entries.length, 0);
  assert.ok(first.startOffset > 0 && first.startOffset < size);
  const rest = await readRolloutWindow(file, { size, before: first.startOffset, maxBytes: size, mapLine: (line) => line === "keep" ? { visible: line } : null });
  assert.equal(rest.startOffset, 0);
  assert.deepEqual(rest.entries, [{ line: { visible: "keep" }, offset: 0 }]);
});

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
function serverFixture(file, overrides = {}) {
  const context = {
    fs, existsSync, readRolloutWindow, stripInjectedUserContext,
    DEFAULT_MESSAGE_LIMIT: 40, MAX_MESSAGE_LIMIT: 1000,
    TAIL_ROLLOUT_MIN_BYTES: 2048, TAIL_ROLLOUT_MAX_BYTES: 8192,
    ACTIVE_STATUS_CACHE_MS: 2000, ACTIVE_TURN_STALE_MS: 600000,
    messageCache: new Map(), recentNotices: [], codexIpcClient: null, appServerClients: new Map(),
    keepIpcWarm() {}, findThread: async (id) => ({ id, rolloutPath: file }), resolveRolloutPath: (value) => value,
    codexPaths: () => ({ home: "/test" }), getThreads: async () => [],
    childThreads: () => [], addThreadStatuses: async (value) => value,
    ...overrides
  };
  return vm.runInNewContext(`${source.slice(source.indexOf("function textFromContent("), source.indexOf("\nfunction normalizeSendImages("))}\n({getMessages, limitMessagesForClient})`, context);
}

test("production byte windows reach messages before a rollout's final 4 MiB", async (t) => {
  const rows = Array.from({ length: 130 }, (_, index) => {
    const row = JSON.parse(record(index));
    row.payload.message += ` ${"x".repeat(40000)}`;
    return JSON.stringify(row);
  });
  const { file, size } = await fixture(t, `${rows.join("\n")}\n`);
  assert.ok(size > 4 * 1024 * 1024);
  const { getMessages } = serverFixture(file, { TAIL_ROLLOUT_MIN_BYTES: 512 * 1024, TAIL_ROLLOUT_MAX_BYTES: 4 * 1024 * 1024 });
  let page = await getMessages("fixture");
  assert.equal(page.messages.length, 40, "fill the requested page across byte windows");
  assert.ok(page.historyStart > 0);
  const seen = new Set();
  for (let index = 0; index < 10; index++) {
    for (const message of page.messages) seen.add(message.sourceOffset);
    if (!page.hasMore) break;
    page = await getMessages("fixture", { before: page.nextBefore });
  }
  assert.equal(seen.size, 130);
  assert.ok(seen.has(0));
});

function record(index, response = false) {
  const timestamp = new Date(1700000000000 + index * 1000).toISOString();
  return JSON.stringify({ timestamp, type: response ? "response_item" : "event_msg", payload: response
    ? { type: "message", role: index % 2 ? "assistant" : "user", content: [{ type: "input_text", text: `message ${index} 中文🙂` }] }
    : { type: index % 2 ? "agent_message" : "user_message", message: `message ${index} 中文🙂` } });
}

for (const response of [false, true]) {
  test(`history reaches the beginning past 1000 messages (${response ? "response" : "event"} source)`, async (t) => {
    const records = Array.from({ length: 1103 }, (_, index) => record(index, response));
    const { file } = await fixture(t, `${records.join("\n")}\n`);
    const { getMessages } = serverFixture(file);
    let page = await getMessages("fixture", { limit: 80 });
    const seen = new Map();
    let pages = 0;
    while (true) {
      pages++;
      assert.ok(page.messages.length <= 80);
      for (const message of page.messages) {
        assert.equal(seen.has(message.sourceOffset), false, "history page overlaps");
        seen.set(message.sourceOffset, message.content);
      }
      if (!page.hasMore) break;
      assert.ok(pages < 200);
      const cursor = page.nextBefore;
      page = await getMessages("fixture", { limit: 80, before: String(cursor) });
      if (page.hasMore) assert.ok(page.nextBefore < cursor);
    }
    assert.equal(seen.size, 1103);
    assert.equal(seen.get(0), "message 0 中文🙂");
  });
}

test("pinned errors do not move the history cursor past intervening messages", async (t) => {
  const { file } = await fixture(t, "");
  const { limitMessagesForClient } = serverFixture(file);
  const messages = Array.from({ length: 100 }, (_, sourceOffset) => ({ sourceOffset, role: "user", timestamp: new Date(1700000000000 + sourceOffset * 1000).toISOString(), content: String(sourceOffset) }));
  messages[0] = { ...messages[0], role: "notice", kind: "error" };
  const page = limitMessagesForClient(messages, {}, 20, 0);
  assert.ok(page.messages.some((message) => message.sourceOffset === 0));
  assert.equal(page.nextBefore, 80);
});

test("duplicate response copies stay excluded at the oldest event boundary", async (t) => {
  const text = [record(0, true), record(0), ...Array.from({ length: 30 }, (_, index) => record(index + 1))].join("\n");
  const { file } = await fixture(t, text);
  const { getMessages } = serverFixture(file);
  const first = await getMessages("fixture");
  const history = await getMessages("fixture", { before: String(Buffer.byteLength(record(0, true)) + 1) });
  assert.ok(first.messages.length);
  assert.equal(history.messages.length, 0);
  assert.equal(history.hasMore, false);
});

test("polling preserves loaded history, updates overlapping records and expires live approvals", () => {
  const previous = [
    { role: "user", sourceOffset: 0, content: "old" },
    { role: "assistant", sourceOffset: 90, content: "streaming" },
    { role: "interaction", requestId: "expired", canApprove: true }
  ];
  const merged = mergeMessageHistory(previous, [
    { role: "assistant", sourceOffset: 90, content: "complete" },
    { role: "user", sourceOffset: 180, content: "new" }
  ]);
  assert.deepEqual(merged.map((message) => message.content), ["old", "complete", "new"]);
});

test("tool calls and outputs are excluded from payloads and the default 40-message budget", async (t) => {
  const rows = [];
  for (let index = 0; index < 55; index++) {
    rows.push(record(index));
    const timestamp = new Date(1700000000000 + index * 1000).toISOString();
    for (const payload of [
      { type: "function_call", name: "fixture", arguments: "PRIVATE_CALL_ARGUMENTS" },
      { type: "function_call_output", output: "Rejected( PRIVATE_TOOL_OUTPUT" },
      { type: "custom_tool_call", input: "PRIVATE_CUSTOM_INPUT" }
    ]) rows.push(JSON.stringify({ type: "response_item", timestamp, payload }));
  }
  const { file } = await fixture(t, `${rows.join("\n")}\n`);
  const { getMessages, limitMessagesForClient } = serverFixture(file, { TAIL_ROLLOUT_MAX_BYTES: 1024 * 1024 });
  const page = await getMessages("fixture");
  assert.equal(page.limit, 40);
  assert.equal(page.messages.length, 40);
  assert.equal(page.messages[0].content, "message 15 中文🙂");
  assert.equal(page.limitUnit, "chat");
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|tool_call|tool_output/);
  const legacy = limitMessagesForClient([{ role: "tool", content: "PRIVATE_LEGACY_OUTPUT" }]);
  assert.equal(legacy.messages.length, 0);
  assert.equal(legacy.totalMessages, 0);
  const older = await getMessages("fixture", { before: page.nextBefore });
  assert.equal(older.messages.length, 15);
  assert.doesNotMatch(JSON.stringify(older), /PRIVATE_/);
});

test("tool-heavy windows and encrypted-only reasoning do not shorten a 40-message page", async (t) => {
  const rows = [];
  for (let index = 0; index < 65; index++) {
    rows.push(record(index));
    rows.push(JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: `PRIVATE_TOOL_${"x".repeat(32000)}` } }));
    rows.push(JSON.stringify({ type: "response_item", payload: { type: "reasoning", summary: [], encrypted_content: `PRIVATE_ENCRYPTED_${"x".repeat(32000)}` } }));
  }
  const { file, size } = await fixture(t, `${rows.join("\n")}\n`);
  const { getMessages } = serverFixture(file, { TAIL_ROLLOUT_MIN_BYTES: 512 * 1024, TAIL_ROLLOUT_MAX_BYTES: 4 * 1024 * 1024 });
  const first = await getMessages("fixture");
  assert.equal(first.messages.length, 40);
  assert.equal(first.messages[0].content, "message 25 中文🙂");
  assert.ok(size - first.historyStart > 40 * 24 * 1024);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_/);
  const older = await getMessages("fixture", { before: first.nextBefore });
  assert.equal(older.messages.length, 25);
  assert.equal(older.messages[0].content, "message 0 中文🙂");
  assert.equal(older.hasMore, false);
});

test("injected skills neither count toward pagination nor alter the original rollout file", async (t) => {
  const skill = "<skill>\n<name>fixture</name>\n<path>/test/fixture/SKILL.md</path>\nINJECTED_SKILL_BODY\n</skill>";
  const rows = [];
  for (let index = 0; index < 55; index++) {
    rows.push(JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ text: skill }] } }));
    rows.push(record(index, true));
  }
  const original = `${rows.join("\n")}\n`;
  const { file } = await fixture(t, original);
  const { getMessages } = serverFixture(file);
  const page = await getMessages("fixture");
  assert.equal(page.messages.length, 40);
  assert.equal(page.messages[0].content, "message 15 中文🙂");
  assert.doesNotMatch(JSON.stringify(page), /INJECTED_SKILL_BODY/);
  const older = await getMessages("fixture", { before: page.nextBefore });
  assert.equal(older.messages.length, 15);
  assert.doesNotMatch(JSON.stringify(older), /INJECTED_SKILL_BODY/);
  assert.equal(await fs.readFile(file, "utf8"), original);
});

test("summaries and response phases survive parsing, without raw or encrypted reasoning", async (t) => {
  const timestamp = new Date(1700000000000).toISOString();
  const payloads = [
    { type: "message", role: "user", content: [{ text: "prompt" }] },
    { type: "reasoning", summary: [{ type: "summary_text", text: "Visible reasoning summary" }], encrypted_content: "PRIVATE_ENCRYPTED", content: [{ text: "PRIVATE_RAW_REASONING" }] },
    { type: "reasoning", summary: [], encrypted_content: "PRIVATE_ENCRYPTED_ONLY" },
    { type: "message", role: "assistant", phase: "commentary", content: [{ text: "Visible progress" }] },
    { type: "message", role: "assistant", phase: "final_answer", content: [{ text: "Final answer" }] }
  ];
  const { file } = await fixture(t, payloads.map((payload) => JSON.stringify({ type: "response_item", timestamp, payload })).join("\n"));
  const { getMessages } = serverFixture(file);
  const page = await getMessages("fixture");
  assert.equal(page.messages.length, 4);
  assert.equal(page.messages[1].kind, "reasoning");
  assert.equal(page.messages[1].content, "Visible reasoning summary");
  assert.equal(page.messages[2].phase, "commentary");
  assert.equal(page.messages[3].phase, "final_answer");
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_/);
});

test("event reasoning summaries remain visible alongside event-source conversations", async (t) => {
  const lines = [record(0), JSON.stringify({ type: "event_msg", payload: { type: "agent_reasoning", text: "Visible summary" } }), record(1)];
  const { file } = await fixture(t, lines.join("\n"));
  const { getMessages } = serverFixture(file);
  const page = await getMessages("fixture");
  assert.equal(page.messages.length, 3);
  assert.ok(page.messages.some((message) => message.kind === "reasoning" && message.content === "Visible summary"));
});

test("approvals and important errors do not reduce the chat budget", async (t) => {
  const { file } = await fixture(t, "");
  const { limitMessagesForClient } = serverFixture(file);
  const chat = Array.from({ length: 50 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", sourceOffset: index * 100, timestamp: new Date(1700000000000 + index * 1000).toISOString(), content: String(index) }));
  const result = limitMessagesForClient([
    { role: "notice", kind: "error", content: "Important error" },
    ...chat,
    { role: "interaction", requestId: "pending", requiresDesktopAction: true }
  ]);
  assert.equal(result.messages.filter((message) => ["user", "assistant"].includes(message.role)).length, 40);
  assert.ok(result.messages.some((message) => message.requestId === "pending"));
  assert.ok(result.messages.some((message) => message.kind === "error"));
  assert.equal(result.nextBefore, 1000);
});
