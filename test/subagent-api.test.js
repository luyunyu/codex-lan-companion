import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("authenticated API hides indexed/spawned children and returns live and archived children under their parent", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "companion-agent-api-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  const now = new Date().toISOString();
  const source = (nickname) => ({ subagent: { thread_spawn: { parent_thread_id: ids[0], agent_nickname: nickname } } });
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  await fs.mkdir(path.join(home, "sessions"));
  for (const [i, id] of ids.entries()) {
    const metadata = i === 0 || i === 4 ? "user" : source(`Worker ${i}`);
    const lines = [
      { type: "session_meta", payload: { id, source: metadata }, timestamp: now },
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn" }, timestamp: now },
      { type: "event_msg", payload: { type: "user_message", message: "Fixture prompt" }, timestamp: now },
      { type: "event_msg", payload: { type: "agent_message", message: `Fixture response ${i}` }, timestamp: now }
    ];
    if (i !== 1) lines.push({ type: "event_msg", payload: { type: "task_complete", turn_id: "turn" }, timestamp: now });
    await fs.writeFile(path.join(home, "sessions", `rollout-${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }
  await fs.writeFile(path.join(home, "session_index.jsonl"), ids.map((id) => JSON.stringify({ id, thread_name: "Untitled", updated_at: now })).join("\n"));
  const sql = ["CREATE TABLE threads (id TEXT, title TEXT, rollout_path TEXT, created_at_ms INTEGER, updated_at_ms INTEGER, updated_at INTEGER, archived INTEGER, preview TEXT, cwd TEXT, model TEXT, source TEXT);"];
  for (const i of [0, 1, 2, 4]) {
    sql.push(`INSERT INTO threads VALUES (${[ids[i], "Untitled", `sessions/rollout-${ids[i]}.jsonl`, Date.now(), Date.now(), 1, i === 2 ? 1 : 0, "", home, "", i === 0 || i === 4 ? "user" : JSON.stringify(source(`Worker ${i}`))].map(quote).join(",")});`);
  }
  execFileSync("sqlite3", [path.join(home, "state_5.sqlite"), sql.join("\n")]);
  const portProbe = net.createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const child = spawn(process.execPath, ["server.js", "--host", "127.0.0.1", "--port", String(port), "--readonly", "--password", "fixture-code", "--codex-home", home, "--ipc-socket", path.join(home, "no-desktop.sock")], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  t.after(async () => { child.kill("SIGTERM"); await exited; });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(`${base}/`); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true, output);
  assert.equal((await fetch(`${base}/api/threads`)).status, 401);
  assert.equal((await fetch(`${base}/api/project-files`)).status, 401);
  const get = async (url) => {
    const response = await fetch(`${base}${url}`, { headers: { Authorization: "Bearer fixture-code" } });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const list = await get(`/api/threads?selectedId=${ids[2]}`);
  const files = await get(`/api/project-files?threadId=${ids[0]}&homeVersion=${list.codexHomeVersion}`);
  assert.equal(files.absolutePath, home);
  assert.ok(files.entries.some((entry) => entry.name === "sessions" && entry.directory));
  const filesStatus = async (query) => (await fetch(`${base}/api/project-files?${query}`, {
    headers: { Authorization: "Bearer fixture-code" }
  })).status;
  assert.equal(await filesStatus("threadId=unknown"), 404);
  assert.equal(await filesStatus(`threadId=${ids[0]}&directory=..`), 403);
  assert.equal(await filesStatus(`threadId=${ids[0]}&homeVersion=stale`), 409);
  assert.deepEqual(list.threads.map((row) => row.id).sort(), [ids[0], ids[4]]);
  assert.equal(list.total, 2);
  assert.equal(list.selectedThread.id, ids[2]);
  const parent = await get(`/api/threads/${ids[0]}/messages`);
  assert.equal(parent.thread.title, "Untitled");
  assert.equal(parent.thread.subagents.length, 3);
  assert.equal(parent.thread.subagents.filter((row) => row.status.running).length, 1);
  assert.equal(parent.thread.subagents.filter((row) => row.status.completed).length, 2);
  const archived = await get(`/api/threads/${ids[2]}/messages`);
  assert.equal(archived.thread.parentId, ids[0]);
  assert.equal(archived.thread.title, "Worker 2");
  assert.ok(archived.messages.some((message) => message.content === "Fixture response 2"));
  const indexed = await get(`/api/threads/${ids[3]}/messages`);
  assert.equal(indexed.thread.parentId, ids[0]);
  assert.equal(indexed.thread.title, "Worker 3");
});
