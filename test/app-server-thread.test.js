import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { AppServerThreadClient, createAppServerThread } from "../lib/app-server-thread.js";

const threadId = "01234567-1234-1234-1234-0123456789ab";
const options = { cli: "/mock/codex", home: "/account/home", cwd: "/repo", workspaceRoots: ["/repo", "/shared"], projectId: "project-id", title: "测试项目" };

function fixture({ changeResult = () => {}, respond = true, malformed = false, rejectMethod = "" } = {}) {
  const requests = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let launch;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    child.emit("close", 0);
  };
  child.kill = close;
  child.stdin = new Writable({ write(chunk, encoding, done) {
    const request = JSON.parse(chunk.toString());
    requests.push(request);
    queueMicrotask(() => {
      if (request.id == null || !respond) return;
      if (malformed) { child.stdout.write("not JSON\n"); return; }
      let result = {};
      if (request.method === "thread/start") {
        result = { cwd: options.cwd, runtimeWorkspaceRoots: options.workspaceRoots, thread: { id: threadId, cwd: options.cwd, projectId: options.projectId } };
        changeResult(result);
      }
      if (request.method === "turn/start") result = { turn: { id: "test-turn" } };
      const response = request.method === rejectMethod
        ? { id: request.id, error: { message: "project unavailable" } }
        : { id: request.id, result };
      const bytes = Buffer.from(`${JSON.stringify({ method: "thread/started", params: { thread: { id: "unrelated" } } })}\n${JSON.stringify(response)}\n`);
      // Framing must survive split UTF-8 codepoints as well as split JSON records.
      for (let i = 0; i < bytes.length; i++) child.stdout.write(bytes.subarray(i, i + 1));
    });
    done();
  } });
  child.stdin.on("finish", () => queueMicrotask(close));
  return {
    requests,
    emit: (message) => child.stdout.write(`${JSON.stringify(message)}\n`),
    get closed() { return closed; },
    get launch() { return launch; },
    spawnProcess: (...args) => { launch = args; return child; }
  };
}

test("App Server persists a validated project thread, without sending a model turn", async () => {
  const mock = fixture();
  const result = await createAppServerThread(options, mock);
  assert.equal(result.threadId, threadId);
  assert.equal(mock.launch[0], options.cli);
  assert.deepEqual(mock.launch[1], ["app-server"]);
  assert.equal(mock.launch[2].cwd, options.cwd);
  assert.equal(mock.launch[2].env.CODEX_HOME, options.home);
  assert.deepEqual(mock.requests.map((request) => request.method), ["initialize", "initialized", "thread/start", "thread/name/set"]);
  assert.deepEqual(mock.requests[2].params, { cwd: options.cwd, runtimeWorkspaceRoots: options.workspaceRoots, projectId: options.projectId, threadSource: "user" });
  assert.deepEqual(mock.requests[3].params, { threadId, name: options.title });
  assert.equal(mock.requests[2].params.approvalPolicy, undefined);
  assert.equal(mock.requests[2].params.model, undefined);
  assert.equal(mock.closed, true);
});

test("default and legacy root selections omit a synthetic project id", async () => {
  const mock = fixture({ changeResult: (result) => { result.thread.projectId = null; } });
  await createAppServerThread({ ...options, projectId: undefined }, mock);
  assert.equal(Object.hasOwn(mock.requests[2].params, "projectId"), false);
});

test("wrong or unsupported cwd, membership and workspace roots fail before persistence", async () => {
  for (const changeResult of [
    (result) => { result.cwd = "/wrong"; },
    (result) => { result.thread.cwd = "/wrong"; },
    (result) => { delete result.thread.projectId; },
    (result) => { result.thread.projectId = "wrong"; },
    (result) => { delete result.runtimeWorkspaceRoots; },
    (result) => { result.runtimeWorkspaceRoots = ["/repo"]; },
    (result) => { result.runtimeWorkspaceRoots = ["/repo", "/wrong"]; }
  ]) {
    const mock = fixture({ changeResult });
    await assert.rejects(createAppServerThread(options, mock), (error) => {
      assert.match(error.message, /did not preserve/);
      assert.equal(error.threadId, undefined);
      return true;
    });
    assert.equal(mock.requests.some((request) => request.method === "thread/name/set"), false);
    assert.equal(mock.closed, true);
  }
});

test("errors, invalid framing and timeouts reject and close the temporary process", async () => {
  for (const config of [{ rejectMethod: "thread/start" }, { malformed: true }, { respond: false }]) {
    const mock = fixture(config);
    await assert.rejects(createAppServerThread(options, { ...mock, timeoutMs: 30 }), /project unavailable|invalid JSON|timed out/);
    assert.equal(mock.closed, true);
  }
  const mock = fixture({ rejectMethod: "thread/name/set" });
  await assert.rejects(createAppServerThread(options, mock), (error) => error.threadId === threadId);
  assert.equal(mock.closed, true);
});

test("background turns stay connected, route approvals and interrupt, then close to release the writer", async () => {
  const mock = fixture();
  const client = new AppServerThreadClient({ ...options, ...mock });
  try {
    await client.createThread(options);
    const result = await client.startTurn(threadId, [{ type: "text", text: "Test" }]);
    assert.equal(result.turn.id, "test-turn");
    assert.equal(mock.closed, false);
    assert.equal(client.active.get(threadId), "test-turn");
    await client.interrupt(threadId);
    assert.deepEqual(mock.requests.find((request) => request.method === "turn/interrupt").params, { threadId, turnId: "test-turn" });
    mock.emit({ id: 0, method: "item/commandExecution/requestApproval", params: { threadId, command: "test command" } });
    assert.equal(client.pendingApprovals(threadId).length, 1);
    assert.throws(() => client.respondToApproval("other", "0", "accept"), /no longer pending/);
    assert.equal(mock.requests.some((request) => request.id === 0), false);
    client.respondToApproval(threadId, "0", "decline");
    assert.deepEqual(mock.requests.find((request) => request.id === 0).result, { decision: "decline" });
    assert.equal(client.pendingApprovals(threadId).length, 0);
    mock.emit({ method: "turn/completed", params: { threadId, turn: { id: "test-turn", status: "completed" } } });
    await client.exited;
    assert.equal(client.active.has(threadId), false);
    assert.equal(client.loaded.has(threadId), false);
    assert.equal(mock.closed, true);
    assert.equal(mock.requests.filter((request) => request.method === "turn/start").length, 1);
  } finally { await client.close(); }
});

// Opt-in integration uses a disposable CODEX_HOME, without credentials or model requests.
test("installed CLI persists project membership, cwd and roots across process exit", { skip: !process.env.CODEX_LAN_TEST_CLI }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "clc-thread-integration-"));
  const cwd = path.join(home, "项目 空格");
  const shared = path.join(home, "shared");
  await fs.mkdir(cwd);
  await fs.mkdir(shared);
  const cli = process.env.CODEX_LAN_TEST_CLI;
  async function rpc(method, params) {
    const child = spawn(cli, ["app-server"], { cwd, env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    const pending = new Map();
    let id = 0;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      const callback = pending.get(message.id);
      if (!callback || message.method) return;
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result);
    });
    child.stderr.resume();
    const exit = new Promise((resolve) => child.once("close", resolve));
    const timer = setTimeout(() => { for (const callback of pending.values()) callback.reject(new Error("CLI probe timed out")); child.kill("SIGKILL"); }, 10000);
    const request = (method, params) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
    });
    try {
      await request("initialize", { clientInfo: { name: "clc_test", version: "0.1.0" }, capabilities: { experimentalApi: true } });
      child.stdin.write('{"method":"initialized"}\n');
      return await request(method, params);
    } finally {
      child.stdin.end();
      await exit;
      clearTimeout(timer);
    }
  }
  try {
    const created = await rpc("project/create", { idempotencyKey: "clc-test", name: "Test", roots: [{ path: cwd }, { path: shared }] });
    const projectId = created.project.id;
    const result = await createAppServerThread({ cli, home, cwd, workspaceRoots: [cwd, shared], projectId, title: "Persistence test" });
    const read = await rpc("thread/read", { threadId: result.threadId, includeTurns: true });
    assert.equal(read.thread.projectId, projectId);
    assert.equal(await fs.realpath(read.thread.cwd), await fs.realpath(cwd));
    assert.equal(read.thread.name, "Persistence test");
    assert.deepEqual(read.thread.turns, []);
    const resumed = await rpc("thread/resume", { threadId: result.threadId });
    assert.deepEqual(resumed.runtimeWorkspaceRoots, [cwd, shared]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});


test("App Server sends model and effort overrides without changing permission settings", async () => {
  const mock = fixture();
  const client = new AppServerThreadClient({ ...options, ...mock });
  try {
    await client.startTurn(threadId, [{ type: "text", text: "Test" }], { model: "fixture-model", effort: "high" });
    const params = mock.requests.find((request) => request.method === "turn/start").params;
    assert.equal(params.model, "fixture-model");
    assert.equal(params.effort, "high");
    assert.equal(Object.hasOwn(params, "approvalPolicy"), false);
    assert.equal(Object.hasOwn(params, "sandboxPolicy"), false);
  } finally { await client.close(); }
});
