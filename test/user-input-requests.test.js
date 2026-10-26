import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { userInputRequest, validateUserInputAnswers, userInputReplyText, answeredUserInputIds, userInputResolved, desktopUserInputState, desktopPendingAsyncInputIds } from "../lib/user-input-requests.js";
import { desktopSteerTurnParams } from "../lib/desktop-ipc-protocol.js";
import { desktopUserInput } from "../lib/desktop-user-input.js";
import { appendQuotedOption } from "../public/user-input-dialog.js";

const payload = { type: "function_call", name: "functions.request_user_input_async", id: "fc-fixture", call_id: "call-fixture", status: "completed",
  arguments: JSON.stringify({ questions: [{ title: "How should we record work?", options: ["Optional", "Required"] }, { title: "Any constraints?" }] }) };
const request = userInputRequest(payload);
const answers = Object.fromEntries(request.questions.map((question, index) => [question.id, index ? "Keep existing records" : "Optional, with timestamps"]));

test("async function calls and native blocking requests preserve question and option identity", () => {
  assert.equal(request.mode, "async");
  assert.equal(request.questions[0].id, JSON.stringify(["request_user_input_async", payload.call_id, 0]));
  assert.equal(request.questions[0].options[0].label, "Optional");
  const blocking = userInputRequest({ id: 7, method: "item/tool/requestUserInput", params: { questions: [{ id: "scope", header: "Scope", question: "Pick scope", options: [{ label: "Small", description: "One module" }] }] } });
  assert.equal(blocking.mode, "blocking");
  assert.equal(blocking.questions[0].id, "scope");
  assert.equal(blocking.questions[0].options[0].description, "One module");
  for (const argumentsValue of ["invalid", "null", "[]", "true"]) assert.equal(userInputRequest({ ...payload, arguments: argumentsValue }), null);
  assert.equal(userInputRequest({ id: "x", name: "other", arguments: payload.arguments }), null);
});

test("answers require every question and retain custom additions, quotes append without losing edits", () => {
  assert.deepEqual(validateUserInputAnswers(request, answers), answers);
  for (const invalid of [null, {}, [], { ...answers, extra: "bad" }, { ...answers, [request.questions[0].id]: " " }, { ...answers, [request.questions[0].id]: "x".repeat(12001) }]) {
    assert.throws(() => validateUserInputAnswers(request, invalid), { status: 400 });
  }
  assert.equal(appendQuotedOption("", "Optional"), "Optional");
  assert.equal(appendQuotedOption("Existing detail", "Required"), "Existing detail\nRequired");
  assert.equal(appendQuotedOption("Optional\nAdditional note", "Required"), "Optional\nAdditional note\nRequired");
});

test("async replies use the Desktop envelope and only accepted replies resolve questions", () => {
  const text = userInputReplyText(request, answers);
  assert.deepEqual(answeredUserInputIds(text), request.questions.map((question) => question.id));
  assert.deepEqual(answeredUserInputIds("ordinary message"), []);
  const event = (status) => [{ message: { type: "steeringUserMessage", status, input: [{ type: "text", text }] } }];
  assert.equal(userInputResolved(request, payload.id, event("pending")), false);
  assert.equal(userInputResolved(request, payload.id, event("rejected")), false);
  assert.equal(userInputResolved(request, payload.id, event("interrupted")), false);
  assert.equal(userInputResolved(request, payload.id, event("accepted")), true);
  assert.equal(userInputResolved({ mode: "blocking", questions: [] }, "7", [{ method: "serverRequest/resolved", params: { requestId: 7 } }]), true);
});

const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
function apiFixture({ allowWrite = true, mode = "async", homeChange = false, reject = false, local = false } = {}) {
  const calls = [];
  let home = "/fixture/home";
  const inputRequest = mode === "async" ? request : userInputRequest({ id: "native", method: "item/tool/requestUserInput", params: { questions: [{ id: "scope", question: "Pick scope" }] } });
  const submissions = new Set();
  const context = {
    interactionDedupeKey: (message) => JSON.stringify(message.inputRequest),
    ALLOW_WRITE: allowWrite, codexPaths: () => ({ home }), refreshCodexHomeContext: async () => {},
    getMessages: async (threadId) => {
      if (homeChange) home = "/another/home";
      return { messages: threadId === "thread" && !submissions.has('submitted') ? [{ requestId: "pending", inputRequest, canRespond: true, requiresDesktopAction: true, source: local ? "app-server" : "desktop-ipc" }] : [] };
    },
    validateUserInputAnswers, userInputReplyText, desktopUserInput, desktopSteerTurnParams, randomUUID: () => "client-message",
    appServerClients: new Map(local ? [["thread", {
      active: new Map([["thread", "turn"]]),
      steerTurn: async (...args) => calls.push(["steer", ...args]),
      respondToUserInput: (...args) => calls.push(["respond", ...args])
    }]] : []),
    getCodexIpcClient: () => ({ request: async (...args) => { calls.push(args); if (reject) throw new Error("unsupported"); } })
  };
  const respond = vm.runInNewContext(`const userInputSubmissions = new Set(); const userInputInFlight = new Set();\n${source.slice(source.indexOf("async function respondToUserInput("), source.indexOf("\nasync function serveStatic("))}\nrespondToUserInput`, context);
  return { calls, respond, inputRequest };
}

test("authenticated input handler routes async and blocking answers without starting or interrupting turns", async () => {
  for (const mode of ["async", "blocking"]) for (const local of [false, true]) {
    const { respond, calls, inputRequest } = apiFixture({ mode, local });
    const values = Object.fromEntries(inputRequest.questions.map((question) => [question.id, "Custom addition"]));
    assert.equal((await respond({ threadId: "thread", requestId: "pending", answers: values })).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], local ? mode === "async" ? "steer" : "respond" : mode === "async" ? "thread-follower-steer-turn" : "thread-follower-submit-user-input");
    if (!local && mode === "blocking") assert.equal(calls[0][1].response.answers.scope.answers[0], "Custom addition");
    if (!local && mode === "async") assert.deepEqual(answeredUserInputIds(calls[0][1].input[0].text), inputRequest.questions.map((question) => question.id));
    await assert.rejects(respond({ threadId: "thread", requestId: "pending", answers: values }), { status: 409 });
  }
});

test("readonly, stale ids, another conversation, changed account and malformed answers never write", async () => {
  for (const variant of [{ allowWrite: false }, { homeChange: true }, { requestId: "old" }, { threadId: "other" }, { answers: {} }]) {
    const { respond, calls } = apiFixture(variant);
    await assert.rejects(respond({ threadId: "thread", requestId: "pending", answers, ...variant }));
    assert.equal(calls.length, 0);
  }
  const { respond, calls } = apiFixture({ reject: true });
  await assert.rejects(respond({ threadId: "thread", requestId: "pending", answers }), /unsupported/);
  await assert.rejects(respond({ threadId: "thread", requestId: "pending", answers }), /unsupported/);
  assert.equal(calls.length, 2, "failed submissions can retry exactly the same method");
});

test("latest Desktop request snapshots retire resolved blocking requests without retiring pending ones", () => {
  const request = { mode: "blocking", questions: [] };
  const snapshot = (requests) => ({ message: { params: { conversationState: { requests } } } });
  assert.equal(userInputResolved(request, "7", [snapshot([]), snapshot([{ id: 7 }])]), false);
  assert.equal(userInputResolved(request, "7", [snapshot([{ id: 7 }]), snapshot([])]), true);
  assert.equal(userInputResolved(request, "7", [snapshot([]), { method: "item/tool/requestUserInput", id: 7 }]), false);
});

test("running composer sends use steering, preserve inherited settings and never fall back to starting a turn", async () => {
  const calls = [];
  const sendSource = source.slice(source.indexOf("async function sendToCodex("), source.indexOf("\nasync function startNewCodexThread("));
  const send = vm.runInNewContext(`${sendSource}\nsendToCodex`, {
    ALLOW_WRITE: true, refreshCodexHomeContext: async () => ({}), normalizeSendImages: () => [],
    desktopUserInput, desktopSteerTurnParams, randomUUID: () => "message", findThread: async () => ({ id: "thread", cwd: "/fixture" }),
    appServerClients: new Map(), getCodexIpcClient: () => ({ request: async (...args) => { calls.push(args); throw new Error("turn finished"); } }),
    getModels: () => { throw new Error("steering must inherit current settings"); }
  });
  await assert.rejects(send("Supplement", "thread", [], { steer: true, model: "ignored" }), /turn finished/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "thread-follower-steer-turn");
  assert.equal(calls[0][1].restoreMessage.cwd, "/fixture");
  assert.equal(calls[0][1].restoreMessage.text, "Supplement");
});

test("Desktop snapshot patches resolve answers received after the browser opened without mutating history", () => {
  const question = { type: "agentMessage", id: payload.call_id, questions: [{ title: "How should we record work?", options: ["Optional"] }] };
  const nativeRequest = userInputRequest(question);
  const nativeAnswers = { [nativeRequest.questions[0].id]: "Optional with details" };
  const state = { requests: [{ id: "7", method: "item/tool/requestUserInput" }], turns: [{ turnId: "current", status: "inProgress", items: [question] }] };
  const original = structuredClone(state);
  const events = [{ message: { params: { change: { type: "snapshot", revision: 1, conversationState: state } } } }];
  const patch = (patches) => events.push({ message: { params: { change: { type: "patches", baseRevision: events.length, revision: events.length + 1, patches } } } });
  assert.equal(userInputResolved(nativeRequest, payload.call_id, events), false);
  assert.equal(desktopPendingAsyncInputIds(desktopUserInputState(events)).has(payload.call_id), true);
  patch([{ op: "add", path: ["turns", 0, "items", 1], value: { type: "steeringUserMessage", status: "pending", input: [{ type: "text", text: userInputReplyText(nativeRequest, nativeAnswers) }] } }]);
  assert.equal(userInputResolved(nativeRequest, payload.call_id, events), false);
  patch([{ op: "replace", path: ["turns", 0, "items", 1, "status"], value: "accepted" }]);
  assert.equal(userInputResolved(nativeRequest, payload.call_id, events), true);
  patch([{ op: "remove", path: ["requests", 0] }, { op: "replace", path: ["turns", 0, "status"], value: "completed" }]);
  assert.equal(userInputResolved({ mode: "blocking", questions: [] }, "7", events), true);
  assert.equal(desktopPendingAsyncInputIds(desktopUserInputState(events)).size, 0);
  assert.deepEqual(state, original);
});

test("canonical Desktop history excludes older questions and incomplete patch sequences cannot prove a pending question", () => {
  const question = { type: "agentMessage", id: payload.call_id, questions: [{ title: "Choose", options: [] }] };
  const state = { turnHistory: { kind: "canonical", history: { islands: [{ entries: [{ value: "old" }, { value: "current" }] }], entitiesByKey: {
    old: { turnId: "old", status: "completed", items: [question] }, current: { turnId: "current", status: "inProgress", items: [] }
  } } }, turns: [] };
  const events = [{ message: { params: { change: { type: "snapshot", revision: 5, conversationState: state } } } }];
  assert.equal(userInputResolved(request, payload.id, events), true);
  assert.equal(desktopPendingAsyncInputIds(desktopUserInputState(events)).size, 0);
  const unrelated = { ...request, sourceId: "new-call", legacySourceId: "new-fc" };
  assert.equal(userInputResolved(unrelated, "new-fc", events), false, "an older snapshot cannot resolve an unseen new question");
  events.push({ message: { params: { change: { type: "patches", baseRevision: 6, revision: 7, patches: [] } } } });
  assert.equal(desktopUserInputState(events), null);
  assert.equal(desktopPendingAsyncInputIds(desktopUserInputState(events)).size, 0);
  const unsafe = [{ params: { change: { type: "snapshot", revision: 1, conversationState: {} } } }, { params: { change: { type: "patches", baseRevision: 1, revision: 2, patches: [{ op: "add", path: ["__proto__", "polluted"], value: true }] } } }];
  assert.equal(desktopUserInputState(unsafe), null);
  assert.equal({}.polluted, undefined);
});
