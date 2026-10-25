import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AppServerThreadClient } from "../lib/app-server-thread.js";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// All sessions, credentials and model responses are disposable fixtures. No cloud calls.
test("real CLI and authenticated API create and run silently with project instructions, including after restart", {
  skip: !process.env.CODEX_LAN_TEST_CLI, timeout: 20000
}, async (t) => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "clc-background-api-")));
  const cwd = path.join(home, "项目 空格");
  const shared = path.join(home, "shared");
  const bin = path.join(home, "bin");
  await Promise.all([fs.mkdir(cwd), fs.mkdir(shared), fs.mkdir(bin)]);
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(cwd, ".git"));
  await fs.writeFile(path.join(home, "AGENTS.md"), "GLOBAL_BACKGROUND_INSTRUCTION\n");
  await fs.writeFile(path.join(cwd, "AGENTS.md"), "PROJECT_BACKGROUND_INSTRUCTION\n");
  const openMarker = path.join(home, "open-called");
  await fs.writeFile(path.join(bin, "open"), `#!/bin/sh\ntouch '${openMarker}'\n`, { mode: 0o755 });

  const modelInputs = [];
  const model = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    modelInputs.push(JSON.parse(body));
    const item = { id: "fixture-message", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "Fixture reply" }] };
    const response = { id: "fixture-response", object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "Fixture reply" },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response }
    ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  model.listen(0, "127.0.0.1");
  await once(model, "listening");
  t.after(() => new Promise((resolve) => model.close(resolve)));
  await fs.writeFile(path.join(home, "config.toml"), `model = "fixture-model"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);

  const cli = process.env.CODEX_LAN_TEST_CLI;
  const seed = new AppServerThreadClient({ cli, home, cwd });
  await seed.initialize();
  const project = await seed.request("project/create", { idempotencyKey: "background-fixture", name: "Fixture project", roots: [{ path: cwd }, { path: shared }] });
  await seed.close();

  const methods = [];
  const broadcasts = [];
  const sockets = new Set();
  const ipcPath = path.join(home, "desktop.sock");
  const ipc = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const size = buffer.readUInt32LE(0);
        const message = JSON.parse(buffer.subarray(4, 4 + size).toString());
        buffer = buffer.subarray(4 + size);
        if (message.type === "broadcast") { broadcasts.push(message); continue; }
        methods.push(message.method);
        if (message.method !== "initialize") continue; // Removed methods deliberately never respond.
        const payload = Buffer.from(JSON.stringify({ type: "response", requestId: message.requestId, resultType: "success", result: { clientId: "fixture-desktop" } }));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(payload.length);
        socket.write(Buffer.concat([header, payload]));
      }
    });
  });
  ipc.listen(ipcPath);
  await once(ipc, "listening");
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise((resolve) => ipc.close(resolve)); });

  let child;
  let exited;
  let base;
  let output = "";
  const stop = async () => { if (child) { child.kill("SIGTERM"); await exited; child = null; } };
  t.after(stop);
  async function start(readonly = false) {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js", "--host", "127.0.0.1", "--port", String(port), "--codex-home", home,
      "--ipc-socket", ipcPath, "--password", "fixture-code", ...(readonly ? ["--readonly"] : [])], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, CODEX_CLI: cli, PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"]
    });
    exited = once(child, "exit");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) return; } catch {}
      await pause(20);
    }
    assert.fail(`Fixture service did not start: ${output}`);
  }
  async function post(body, authorized = true) {
    let response;
    try {
      response = await fetch(`${base}/api/send`, { method: "POST", signal: AbortSignal.timeout(6000),
        headers: { "content-type": "application/json", ...(authorized ? { Authorization: "Bearer fixture-code" } : {}) }, body: JSON.stringify(body) });
    } catch (error) { assert.fail(`${error.message}; IPC methods: ${methods.join(",")}; ${output.slice(-1800)}`); }
    return { status: response.status, data: await response.json() };
  }
  async function waitForReply(id) {
    for (let i = 0; i < 200; i++) {
      const response = await fetch(`${base}/api/threads/${id}/messages`, { headers: { Authorization: "Bearer fixture-code" } });
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      if (data.messages?.some((message) => message.content === "Fixture reply") && !data.status?.thinking) return data;
      await pause(20);
    }
    assert.fail(`Fixture reply did not complete: ${output.slice(-3000)}`);
  }
  await start();
  assert.equal((await post({ newThread: true, message: "Fixture prompt", projectId: project.project.id }, false)).status, 401);
  const began = Date.now();
  const first = await post({ newThread: true, message: "Fixture prompt", projectId: project.project.id });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.mode, "app-server");
  const creationMs = Date.now() - began;
  assert.ok(creationMs < 5000, "Creation should not wait for removed Desktop methods");
  t.diagnostic(`Isolated creation and first-turn submission: ${creationMs}ms`);
  const messages = await waitForReply(first.data.threadId);
  assert.equal(messages.thread.cwd, cwd);
  assert.equal(messages.messages.some((message) => message.title === "Desktop refresh delayed"), false);
  assert.ok(JSON.stringify(modelInputs[0]).includes("PROJECT_BACKGROUND_INSTRUCTION"));
  assert.ok(JSON.stringify(modelInputs[0]).includes("GLOBAL_BACKGROUND_INSTRUCTION"));
  assert.deepEqual(methods, ["initialize"]);
  assert.ok(broadcasts.some((message) => message.method === "thread-unarchived" && message.params.conversationId === first.data.threadId));
  assert.equal(await fs.stat(openMarker).catch(() => null), null);

  // Completed tasks release the creator's writer before manual Desktop access.
  const inspector = new AppServerThreadClient({ cli, home, cwd });
  t.after(() => inspector.close());
  for (let i = 0; ; i++) {
    try { await inspector.resumeThread(first.data.threadId); break; } catch (error) {
      if (i >= 50 || !/active writer/.test(error.message)) throw error;
      await pause(20);
    }
  }
  const read = await inspector.request("thread/read", { threadId: first.data.threadId, includeTurns: true });
  assert.equal(read.thread.projectId, project.project.id);
  const firstRecord = JSON.parse((await fs.readFile(read.thread.path, "utf8")).split("\n")[0]);
  assert.equal(firstRecord.payload.originator, "codex_lan_companion");
  await inspector.close();
  await stop();
  await start();
  const second = await post({ threadId: first.data.threadId, message: "Second fixture prompt" });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.mode, "app-server");
  for (let i = 0; i < 200 && modelInputs.length < 2; i++) await pause(20);
  assert.equal(modelInputs.length, 2);
  assert.equal(await fs.stat(openMarker).catch(() => null), null);
  await stop();
  await start(true);
  assert.equal((await post({ newThread: true, message: "Read-only fixture", projectId: project.project.id })).status, 403);
  assert.equal(modelInputs.length, 2);
});
