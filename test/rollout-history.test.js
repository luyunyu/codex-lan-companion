import { userInputRequest, answeredUserInputIds, userInputResolved, validateUserInputAnswers, userInputReplyText, userInputAnswered, desktopUserInputState, desktopPendingAsyncInputIds } from "../lib/user-input-requests.js";
import { desktopUserInput } from "../lib/desktop-user-input.js";
import { desktopSteerTurnParams } from "../lib/desktop-ipc-protocol.js";
import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { readRolloutWindow } from "../lib/rollout-history.js";
import { stripInjectedUserContext } from "../lib/user-message-content.js";
import { mergeMessageHistory } from "../public/message-history.js";
import { ThreadStatusReader } from "../lib/thread-status.js";

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
    fs, existsSync, readRolloutWindow, stripInjectedUserContext, userInputRequest, answeredUserInputIds, userInputResolved, userInputAnswered, desktopUserInputState, desktopPendingAsyncInputIds,
    userInputSubmissions: new Set(), userInputInFlight: new Set(),
    validateUserInputAnswers, userInputReplyText, desktopUserInput, desktopSteerTurnParams,
    DEFAULT_MESSAGE_LIMIT: 40, MAX_MESSAGE_LIMIT: 1000,
    TAIL_ROLLOUT_MIN_BYTES: 2048, TAIL_ROLLOUT_MAX_BYTES: 8192,
    ACTIVE_STATUS_CACHE_MS: 2000, ACTIVE_TURN_STALE_MS: 600000,
    messageCache: new Map(), recentNotices: [], codexIpcClient: null, appServerClients: new Map(),
    threadStatusReader: new ThreadStatusReader(),
    keepIpcWarm() {}, findThread: async (id) => ({ id, rolloutPath: file }), resolveRolloutPath: (value) => value,
    codexPaths: () => ({ home: "/test" }), getThreads: async () => [],
    childThreads: () => [], addThreadStatuses: async (value) => value,
    ...overrides
  };
  const messagesSource = source.slice(source.indexOf("function textFromContent("), source.indexOf("\nfunction normalizeSendImages("));
  const inputSource = source.slice(source.indexOf("async function respondToUserInput("), source.indexOf("\nasync function serveStatic("));
  return vm.runInNewContext(`${messagesSource}\n${inputSource}\n({getMessages, limitMessagesForClient, respondToUserInput})`, context);
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

for (const startInWindow of [true, false]) {
  test(`running feedback survives quiet tool execution (start in window: ${startInWindow})`, async (t) => {
    const timestamp = new Date(Date.now() - 30000).toISOString();
    const line = (type, payload) => JSON.stringify({ timestamp, type, payload }) + "\n";
    const history = Array.from({ length: 70 }, (_, index) => record(index)).join("\n") + "\n";
    const start = line("event_msg", { type: "task_started", turn_id: "active" });
    const tool = line("response_item", { type: "function_call", name: "fixture", arguments: "PRIVATE_TOOL_INPUT" });
    const { file } = await fixture(t, startInWindow ? history + start + tool : start + history + tool);
    const quietAt = new Date(timestamp);
    await fs.utimes(file, quietAt, quietAt);
    const { getMessages } = serverFixture(file);
    const page = await getMessages("fixture");
    assert.equal(page.partial, true);
    assert.equal(page.status.thinking, true);
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_TOOL_INPUT/);
    for (const type of ["task_complete", "turn_aborted"]) {
      if (type === "turn_aborted") await fs.appendFile(file, start);
      await fs.appendFile(file, line("event_msg", { type, turn_id: "active" }));
      assert.equal((await getMessages("fixture")).status.thinking, false);
    }
    await fs.appendFile(file, start);
    const staleAt = new Date(Date.now() - 11 * 60000);
    // Both event timestamps and file activity must be stale.
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replaceAll(timestamp, staleAt.toISOString()));
    await fs.utimes(file, staleAt, staleAt);
    assert.equal((await getMessages("fixture")).status.thinking, false);
  });
}

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

test("async questions stay pending after tool completion and disappear after a tagged reply or turn completion", async (t) => {
  const now = new Date().toISOString();
  const call = { type: "function_call", name: "request_user_input_async", id: "fixture-question", call_id: "fixture-call", arguments: JSON.stringify({ questions: [{ title: "Choose scope", options: ["Small", "Large"] }] }) };
  const question = userInputRequest(call).questions[0];
  const line = (type, payload) => JSON.stringify({ timestamp: now, type, payload }) + "\n";
  const initial = line("event_msg", { type: "task_started", turn_id: "turn" }) + line("response_item", call) + line("response_item", { type: "function_call_output", call_id: call.call_id, output: "Tool completed" });
  const { file } = await fixture(t, initial);
  let page = await serverFixture(file).getMessages("fixture");
  assert.equal(page.messages.filter((message) => message.inputRequest).length, 1);
  assert.equal(page.messages.find((message) => message.inputRequest).canRespond, true);
  const reply = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: question.id, question: question.title, answer: "Small with additions" }])}\n</send_user_message_question_reply>`;
  await fs.writeFile(file, initial + line("event_msg", { type: "user_message", message: reply }));
  page = await serverFixture(file).getMessages("fixture");
  assert.equal(page.messages.some((message) => message.inputRequest), false);
  await fs.writeFile(file, initial + line("event_msg", { type: "task_complete", turn_id: "turn" }));
  page = await serverFixture(file).getMessages("fixture");
  assert.equal(page.messages.some((message) => message.inputRequest), false);
});

test("the real pending-message lookup allows the first answer and suppresses stale polls after success", async (t) => {
  const now = new Date().toISOString();
  const call = { type: "function_call", name: "request_user_input_async", id: "fixture-pending", call_id: "fixture-call", arguments: JSON.stringify({ questions: [{ title: "Choose", options: ["Small"] }] }) };
  const rows = [{ type: "event_msg", payload: { type: "task_started", turn_id: "turn" } }, { type: "response_item", payload: call }];
  const { file } = await fixture(t, rows.map((row) => JSON.stringify({ ...row, timestamp: now })).join("\n") + "\n");
  const calls = [];
  const api = serverFixture(file, { ALLOW_WRITE: true, refreshCodexHomeContext: async () => {}, randomUUID: () => "client",
    getCodexIpcClient: () => ({ request: async (...args) => calls.push(args) }) });
  const question = userInputRequest(call).questions[0];
  const body = { threadId: "fixture", requestId: call.id, answers: { [question.id]: "Small with details" } };
  assert.equal((await api.getMessages("fixture")).messages.filter((message) => message.inputRequest).length, 1);
  await assert.rejects(api.respondToUserInput({ ...body, requestId: "expired" }), { status: 409 });
  assert.equal(calls.length, 0);
  assert.equal((await api.respondToUserInput(body)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "thread-follower-steer-turn");
  assert.equal((await api.getMessages("fixture")).messages.filter((message) => message.inputRequest).length, 0);
  await assert.rejects(api.respondToUserInput(body), { status: 409 });
});


test("context usage uses the latest valid report, survives quota-only events and updates after compaction", async (t) => {
  const token = (info) => JSON.stringify({ type: "event_msg", timestamp: "2026-10-26T01:00:00Z", payload: { type: "token_count", info } });
  const info = (used, capacity = 100000) => ({ last_token_usage: { total_tokens: used }, model_context_window: capacity, total_token_usage: { total_tokens: 9000000 } });
  const { file } = await fixture(t, [record(0), token(info(80000)), token(info(20000)), token(null)].join("\n"));
  const { getMessages } = serverFixture(file);
  let result = await getMessages("fixture");
  assert.equal(result.contextUsage.usedTokens, 20000);
  assert.equal(result.contextUsage.contextWindow, 100000);
  assert.equal(result.contextUsage.usedPercent, 20);
  assert.equal(result.contextUsage.updatedAt, "2026-10-26T01:00:00Z");
  assert.equal(result.messages.length, 1);
  await fs.appendFile(file, "\n" + token(info(120000)));
  result = await getMessages("fixture");
  assert.equal(result.contextUsage.usedPercent, 100);
  assert.equal(result.contextUsage.usedTokens, 120000);
  await fs.appendFile(file, "\n" + token(info(1, 0)));
  result = await getMessages("fixture");
  assert.equal(result.contextUsage, null);
});

test("context usage is unavailable for empty, draft-like and legacy records", async (t) => {
  const { file } = await fixture(t, record(0));
  const { getMessages } = serverFixture(file);
  assert.equal((await getMessages("fixture")).contextUsage, null);
});

test("a fresh browser recognizes Desktop answers keyed by call_id in both user message sources", async (t) => {
  const timestamp = new Date().toISOString();
  const call = { type: "function_call", name: "request_user_input_async", id: "fc-fixture", call_id: "call-fixture", arguments: JSON.stringify({ questions: [{ title: "Choose", options: ["Small"] }] }) };
  const line = (type, payload) => JSON.stringify({ timestamp, type, payload }) + "\n";
  const reply = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: JSON.stringify(["request_user_input_async", call.call_id, 0]), question: "Choose", answer: "Small" }])}\n</send_user_message_question_reply>`;
  for (const payload of [{ type: "user_message", message: reply }, { type: "message", role: "user", content: [{ type: "input_text", text: reply }] }]) {
    const { file } = await fixture(t, line("event_msg", { type: "task_started", turn_id: "current" }) + line("response_item", call)
      + line(payload.type === "message" ? "response_item" : "event_msg", payload));
    const page = await serverFixture(file).getMessages("fixture");
    assert.equal(page.status.thinking, true);
    assert.equal(page.messages.some((message) => message.inputRequest), false);
    assert.equal(page.status.interactionRequired, false);
  }
});

test("IPC history cannot revive answered questions or questions from previous turns on first load", async (t) => {
  const timestamp = new Date().toISOString();
  const line = (type, payload) => JSON.stringify({ timestamp, type, payload }) + "\n";
  const call = { type: "function_call", name: "request_user_input_async", id: "fc-old", call_id: "call-old", arguments: JSON.stringify({ questions: [{ title: "Old question", options: ["Small"] }] }) };
  const ipcMessage = { role: "interaction", requestId: "call-old", inputRequest: userInputRequest({ type: "agentMessage", id: "call-old", questions: [{ title: "Old question", options: ["Small"] }] }), canRespond: true, requiresDesktopAction: true, source: "desktop-ipc", content: "Old question", timestamp };
  for (const currentRunning of [false, true]) {
    const { file } = await fixture(t, line("event_msg", { type: "task_started", turn_id: "old" }) + line("response_item", call)
      + line("event_msg", { type: "task_complete", turn_id: "old" })
      + (currentRunning ? line("event_msg", { type: "task_started", turn_id: "current" }) : ""));
    const api = serverFixture(file, { ALLOW_WRITE: true, refreshCodexHomeContext: async () => {}, codexIpcClient: { events: [], getRecentInteractionMessages: () => [ipcMessage], getRecentNoticeMessages: () => [] } });
    const page = await api.getMessages("fixture");
    assert.equal(page.messages.some((message) => message.inputRequest), false);
    assert.equal(page.status.interactionRequired, false);
    await assert.rejects(api.respondToUserInput({ threadId: "fixture", requestId: "call-old", answers: { [ipcMessage.inputRequest.questions[0].id]: "Small" } }), { status: 409 });
  }
});

test("an unidentified question before the current start and a superseded open turn are never current confirmations", async (t) => {
  const timestamp = new Date().toISOString();
  const line = (type, payload) => JSON.stringify({ timestamp, type, payload }) + "\n";
  const call = { type: "function_call", name: "request_user_input_async", id: "fc-old", call_id: "call-old", arguments: JSON.stringify({ questions: [{ title: "Old", options: ["Small"] }] }) };
  const cases = [
    line("response_item", call) + line("event_msg", { type: "task_started", turn_id: "current" }),
    line("event_msg", { type: "task_started", turn_id: "abandoned" }) + line("response_item", call)
      + line("event_msg", { type: "task_started", turn_id: "later" }) + line("event_msg", { type: "task_complete", turn_id: "later" })
  ];
  for (const text of cases) {
    const { file } = await fixture(t, line("event_msg", { type: "agent_message", message: "x".repeat(50000) }) + line("event_msg", { type: "ignored", padding: "x".repeat(10000) }) + text + line("event_msg", { type: "agent_message", message: "Latest progress" }).repeat(20));
    const page = await serverFixture(file).getMessages("fixture", { limit: 1 });
    assert.ok(page.partial);
    assert.equal(page.messages.some((message) => message.inputRequest), false);
  }
});

test("a current unanswered question survives IPC deduplication while a Desktop reply removes both sources", async (t) => {
  const timestamp = new Date().toISOString();
  const call = { type: "function_call", name: "request_user_input_async", id: "fc-current", call_id: "call-current", arguments: JSON.stringify({ questions: [{ title: "Current question", options: ["Small"] }] }) };
  const nativeQuestion = { type: "agentMessage", id: call.call_id, questions: [{ title: "Current question", options: ["Small"] }] };
  const inputRequest = userInputRequest(nativeQuestion);
  const ipcMessage = { role: "interaction", requestId: call.call_id, inputRequest, canRespond: true, requiresDesktopAction: true, source: "desktop-ipc", turnId: "current", content: "Current question", timestamp };
  const line = (type, payload) => JSON.stringify({ timestamp, type, payload }) + "\n";
  const initial = line("event_msg", { type: "task_started", turn_id: "current" }) + line("response_item", call);
  const { file } = await fixture(t, initial);
  const ipc = { events: [], getRecentInteractionMessages: () => [ipcMessage], getRecentNoticeMessages: () => [] };
  const page = await serverFixture(file, { codexIpcClient: ipc }).getMessages("fixture");
  assert.equal(page.messages.filter((message) => message.inputRequest).length, 1);
  assert.equal(page.messages.find((message) => message.inputRequest).requestId, call.call_id);
  assert.equal(page.messages.find((message) => message.inputRequest).turnId, "current");
  assert.equal(page.status.interactionRequired, true);
  await fs.writeFile(file, initial + line("event_msg", { type: "user_message", message: userInputReplyText(inputRequest, { [inputRequest.questions[0].id]: "Small" }) }));
  const after = await serverFixture(file, { codexIpcClient: ipc }).getMessages("fixture");
  assert.equal(after.messages.some((message) => message.inputRequest), false);
  assert.equal(after.status.interactionRequired, false);
});

test("without rollout data only the latest active Desktop snapshot can make async history actionable", async () => {
  const old = { type: "agentMessage", id: "old-call", questions: [{ title: "Old", options: [] }] };
  const current = { type: "agentMessage", id: "current-call", questions: [{ title: "Current", options: [] }] };
  const messages = [old, current].map((item) => ({ role: "interaction", requestId: item.id, inputRequest: userInputRequest(item), content: item.questions[0].title, canRespond: true, requiresDesktopAction: true, source: "desktop-ipc" }));
  const state = { turns: [{ turnId: "old", status: "completed", items: [old] }, { turnId: "current", status: "inProgress", items: [current] }] };
  const ipc = { events: [{ message: { params: { conversationId: "fixture", change: { type: "snapshot", revision: 1, conversationState: state } } } }], conversationIdFromMessage: () => "fixture", getRecentInteractionMessages: () => messages, getRecentNoticeMessages: () => [] };
  const page = await serverFixture(null, { codexIpcClient: ipc }).getMessages("fixture");
  assert.deepEqual(Array.from(page.messages, (message) => message.requestId), ["current-call"]);
  ipc.events.length = 0;
  const unknown = await serverFixture(null, { codexIpcClient: ipc }).getMessages("fixture");
  assert.equal(unknown.messages.length, 0);
  assert.equal(unknown.status.interactionRequired, false);
});

test("legacy Companion receipts still resolve questions and explicit older turn metadata cannot attach to a new turn", async (t) => {
  const timestamp = new Date().toISOString();
  const line = (type, payload) => JSON.stringify({ timestamp, type, payload }) + "\n";
  const call = { type: "function_call", name: "request_user_input_async", id: "fc-legacy", call_id: "call-canonical", arguments: JSON.stringify({ questions: [{ title: "Choose", options: [] }] }) };
  const legacyReply = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: JSON.stringify(["request_user_input_async", call.id, 0]), question: "Choose", answer: "Custom" }])}\n</send_user_message_question_reply>`;
  const cases = [
    line("event_msg", { type: "task_started", turn_id: "current" }) + line("response_item", call) + line("event_msg", { type: "user_message", message: legacyReply }),
    line("event_msg", { type: "task_started", turn_id: "current" }) + line("response_item", { ...call, internal_chat_message_metadata_passthrough: { turn_id: "older" } })
  ];
  for (const text of cases) {
    const { file } = await fixture(t, text);
    const page = await serverFixture(file).getMessages("fixture");
    assert.equal(page.status.thinking, true);
    assert.equal(page.messages.some((message) => message.inputRequest), false);
  }
});
