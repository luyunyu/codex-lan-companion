import { desktopUserInput } from "../lib/desktop-user-input.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { readDesktopIpcVersions, desktopRequestEnvelope, desktopStartTurnParams, desktopThreadAvailableBroadcast } from "../lib/desktop-ipc-protocol.js";

const current = { detected: true, versions: { "thread-follower-start-turn": 2, "thread-follower-interrupt-turn": 4, "thread-owner-discovery": 1 } };
const legacy = { detected: false, versions: { "thread-follower-start-turn": 1 } };
const input = [{ type: "text", text: "hello", text_elements: [] }];

test("current local requests use version 2 without selecting the remote host protocol", () => {
  assert.deepEqual(desktopRequestEnvelope(current, "thread-follower-start-turn", { hostId: "local" }), { version: 2 });
  assert.deepEqual(desktopRequestEnvelope(current, "thread-follower-start-turn", { hostId: "remote" }), { hostId: "remote", version: 3 });
  assert.deepEqual(desktopRequestEnvelope(current, "thread-owner-discovery", { hostId: "local" }), { version: 1 });
});

test("current start parameters preserve thread settings and message identity", () => {
  const params = desktopStartTurnParams(current, "thread", input, "message");
  assert.deepEqual(params.turnStart.request, { threadId: "thread", input, clientUserMessageId: "message" });
  assert.equal(params.turnStart.context.inheritThreadSettings, true);
  assert.equal(params.turnStartParams, undefined);
  assert.equal(params.turnStart.request.approvalPolicy, undefined);
  assert.equal(params.turnStart.request.model, undefined);
});

test("legacy fallback retains the existing request format", () => {
  assert.deepEqual(desktopRequestEnvelope(legacy, "thread-follower-start-turn", { hostId: "local" }), { hostId: "local", version: 1 });
  assert.deepEqual(desktopStartTurnParams(legacy, "thread", input, "message"), { conversationId: "thread", hostId: "local", turnStartParams: { input, attachments: [] } });
});

test("interrupt without an expected turn uses the Desktop compatibility version", () => {
  assert.equal(desktopRequestEnvelope(current, "thread-follower-interrupt-turn", { conversationId: "thread" }).version, 3);
  assert.equal(desktopRequestEnvelope(current, "thread-follower-interrupt-turn", { expectedTurnId: "turn" }).version, 4);
});

test("version discovery reads an ASAR table without running bundled JavaScript", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clc-ipc-test-"));
  try {
    const source = Buffer.from('throw new Error("must not run"); const versions={"thread-owner-discovery":1,"thread-follower-start-turn":2};');
    const json = Buffer.from(JSON.stringify({ files: { ".vite": { files: { build: { files: { "src-test.js": { size: source.length, offset: "0" } } } } } } }));
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(json.length + 8, 4);
    prefix.writeUInt32LE(json.length, 12);
    const archive = path.join(directory, "app.asar");
    await fs.writeFile(archive, Buffer.concat([prefix, json, source]));
    assert.deepEqual(await readDesktopIpcVersions(archive), { "thread-owner-discovery": 1, "thread-follower-start-turn": 2 });
    await fs.writeFile(archive, Buffer.from("short"));
    assert.equal(await readDesktopIpcVersions(archive), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Desktop client sends the new envelope exactly once and propagates the Desktop turn result", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const classSource = source.slice(source.indexOf("class DesktopCodexIpcClient {"), source.indexOf("\nfunction getCodexIpcClient()"));
  const Client = vm.runInNewContext(`${classSource}\nDesktopCodexIpcClient`, {
    Buffer, randomUUID, setTimeout, clearTimeout, desktopRequestEnvelope, desktopStartTurnParams, desktopUserInput,
    IPC_VERSION_BY_METHOD: legacy.versions
  });
  const client = new Client();
  client.protocol = current;
  client.ready = Promise.resolve();
  client.captureEvent = () => {};
  const frames = [];
  client.socket = { writable: true, write(frame) {
    const message = JSON.parse(frame.subarray(4).toString());
    frames.push(message);
    queueMicrotask(() => client.handleMessage({ type: "response", requestId: message.requestId, resultType: "success", result: { result: { turn: { id: "turn" } } } }));
  } };
  const response = await client.startTurn("thread", "hello");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].version, 2);
  assert.equal(frames[0].hostId, undefined);
  assert.equal(frames[0].params.turnStart.request.threadId, "thread");
  assert.equal(frames[0].params.turnStart.request.input[0].text, "hello");
  assert.equal(response.result.result.turn.id, "turn");
  await client.startTurn("thread", "用 [$sample](/fixture/sample/SKILL.md) 和 [@Demo](plugin://demo@local)");
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[1].params.turnStart.request.input.slice(1), [
    { type: "skill", name: "sample", path: "/fixture/sample/SKILL.md" },
    { type: "mention", name: "Demo", path: "plugin://demo@local" }
  ]);
});

test("simultaneous startup requests share one IPC connection attempt", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const classSource = source.slice(source.indexOf("class DesktopCodexIpcClient {"), source.indexOf("\nfunction getCodexIpcClient()"));
  const Client = vm.runInNewContext(`${classSource}\nDesktopCodexIpcClient`, { Buffer, IPC_VERSION_BY_METHOD: legacy.versions });
  const client = new Client();
  let attempts = 0;
  client.connect = async () => { attempts += 1; await Promise.resolve(); return { ok: true }; };
  await Promise.all([client.ensureReady(), client.ensureReady(), client.ensureReady()]);
  assert.equal(attempts, 1);
});

test("available-thread notification is a versioned broadcast without requests or activation", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const classSource = source.slice(source.indexOf("class DesktopCodexIpcClient {"), source.indexOf("\nfunction getCodexIpcClient()"));
  const Client = vm.runInNewContext(`${classSource}\nDesktopCodexIpcClient`, {
    Buffer, desktopThreadAvailableBroadcast, IPC_VERSION_BY_METHOD: legacy.versions
  });
  const client = new Client();
  const frames = [];
  client.protocol = { detected: true, versions: { "thread-unarchived": 1 } };
  client.clientId = "companion";
  client.socket = { writable: true, write: (frame) => frames.push(JSON.parse(frame.subarray(4).toString())) };
  assert.equal(client.notifyThreadAvailable("created"), true);
  assert.deepEqual(frames, [{ type: "broadcast", method: "thread-unarchived", version: 1,
    sourceClientId: "companion", params: { hostId: "local", conversationId: "created" } }]);
  assert.equal(client.pending.size, 0);
  client.protocol = legacy;
  assert.equal(client.notifyThreadAvailable("created"), false);
  client.protocol = { detected: true, versions: { "thread-unarchived": 2 } };
  assert.equal(client.notifyThreadAvailable("created"), false);
  client.socket = null;
  assert.equal(client.notifyThreadAvailable("created"), false);
  assert.equal(frames.length, 1);
});

test("model overrides update Desktop thread settings before sending and reject unapplied updates", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const classSource = source.slice(source.indexOf("class DesktopCodexIpcClient {"), source.indexOf("\nfunction getCodexIpcClient()"));
  const Client = vm.runInNewContext(`${classSource}\nDesktopCodexIpcClient`, {
    Buffer, randomUUID, desktopStartTurnParams, desktopUserInput, IPC_VERSION_BY_METHOD: legacy.versions
  });
  const client = new Client();
  client.ensureReady = async () => {};
  client.protocol = { detected: true, versions: { "thread-follower-start-turn": 2, "thread-follower-update-thread-settings": 2 } };
  const calls = [];
  let applied = true;
  client.request = async (method, params) => { calls.push({ method, params }); return { result: { applied } }; };
  await client.startTurn("thread", "hello", [], { model: "fixture-model", effort: "high" });
  assert.deepEqual(calls.map((call) => call.method), ["thread-follower-update-thread-settings", "thread-follower-start-turn"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params.threadSettings)), { model: "fixture-model", effort: "high" });
  assert.equal(calls[1].params.turnStart.context.inheritThreadSettings, true);
  calls.length = 0;
  applied = false;
  await assert.rejects(client.startTurn("thread", "hello", [], { model: "fixture-model" }), /not applied/);
  assert.equal(calls.length, 1);
  client.protocol = legacy;
  calls.length = 0;
  await client.startTurn("thread", "hello", [], { model: "fixture-model", effort: "low" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.turnStartParams.model, "fixture-model");
  assert.equal(calls[0].params.turnStartParams.effort, "low");
});

test("steering includes a restorable message and uses the existing active turn protocol", async () => {
  const { desktopSteerTurnParams } = await import("../lib/desktop-ipc-protocol.js");
  const params = desktopSteerTurnParams("thread", input, "client-message", { text: "hello", cwd: "/fixture", now: 123 });
  assert.equal(params.restoreMessage.id, params.clientUserMessageId);
  assert.equal(params.restoreMessage.text, "hello");
  assert.equal(params.restoreMessage.createdAt, 123);
  assert.deepEqual(params.restoreMessage.context.commentAttachments, []);
  assert.equal(params.restoreMessage.context.prompt, "hello");
  assert.equal(params.conversationId, "thread");
  assert.deepEqual(desktopRequestEnvelope({ detected: true, versions: { "thread-follower-steer-turn": 1 } }, "thread-follower-steer-turn", params), { version: 1 });
});
