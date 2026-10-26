import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { ThreadStatusReader } from "../lib/thread-status.js";

const event = (type, turnId = "turn", timestamp = new Date().toISOString()) => JSON.stringify({ timestamp, type: "event_msg", payload: { type, turn_id: turnId } }) + "\n";
async function fixture(t, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "companion-status-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { file: path.join(directory, "rollout.jsonl"), reader: new ThreadStatusReader(options) };
}

test("list status follows started, completed, restarted and aborted turns on later polls", async (t) => {
  const { file, reader } = await fixture(t);
  await fs.writeFile(file, event("task_started"));
  assert.equal((await reader.read(file)).running, true);
  assert.equal((await reader.read(file)).running, true);
  await fs.appendFile(file, event("task_complete", "older-turn"));
  assert.equal((await reader.read(file)).running, true);
  await fs.appendFile(file, event("task_complete"));
  assert.equal((await reader.read(file)).running, false);
  await fs.appendFile(file, event("task_started", "next"));
  assert.equal((await reader.read(file)).running, true);
  await fs.appendFile(file, event("turn_aborted", "next"));
  assert.equal((await reader.read(file)).running, false);
});

test("incomplete and malformed records do not lose the active turn or completion", async (t) => {
  const { file, reader } = await fixture(t);
  await fs.writeFile(file, event("task_started"));
  await reader.read(file);
  const completion = event("task_complete");
  await fs.appendFile(file, "malformed\n" + completion.slice(0, -3));
  assert.equal((await reader.read(file)).running, true);
  await fs.appendFile(file, completion.slice(-3));
  assert.equal((await reader.read(file)).running, false);
});

test("unchanged active files expire and file replacement cannot retain the old status", async (t) => {
  const { file, reader } = await fixture(t, { staleMs: 1000 });
  await fs.writeFile(file, event("task_started"));
  assert.equal((await reader.read(file)).running, true);
  assert.equal((await reader.read(file, Date.now() + 2000)).running, false);
  await fs.rename(file, file + ".old");
  await fs.writeFile(file, event("task_complete"));
  assert.equal((await reader.read(file)).running, false);
  reader.clear();
  assert.equal(reader.cache.size, 0);
  assert.equal((await reader.read(file)).running, false);
});

test("large files stay bounded and missing lifecycle evidence remains unknown", async (t) => {
  const { file, reader } = await fixture(t, { maxBytes: 1024, maxScanBytes: 1024 });
  await fs.writeFile(file, event("task_started"));
  await reader.read(file);
  await fs.appendFile(file, JSON.stringify({ type: "response_item", payload: { text: "x".repeat(4096) } }) + "\n");
  assert.equal((await reader.read(file)).running, null);
  reader.clear();
  assert.equal((await reader.read(file)).running, null);
  await fs.appendFile(file, event("task_complete"));
  assert.equal((await reader.read(file)).running, false);
  await fs.appendFile(file, event("task_started", "new"));
  assert.equal((await reader.read(file)).running, true);
  assert.equal((await reader.read(file + ".missing")).running, null);
  assert.equal((await reader.read(null)).running, null);
});

test("incremental polling retains lifecycle state beyond the initial tail window", async (t) => {
  const { file, reader } = await fixture(t, { maxBytes: 1024, maxScanBytes: 1024 });
  await fs.writeFile(file, event("task_started"));
  await reader.read(file);
  for (let i = 0; i < 8; i += 1) {
    await fs.appendFile(file, JSON.stringify({ type: "response_item", payload: { text: "x".repeat(300) } }) + "\n");
    assert.equal((await reader.read(file)).running, true);
  }
  await fs.appendFile(file, event("task_complete"));
  assert.equal((await reader.read(file)).running, false);
});

const server = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const app = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
test("list endpoint enriches only requested page rows and isolates unreadable files", async () => {
  const helper = server.slice(server.indexOf("async function addThreadStatuses("), server.indexOf("\nasync function getThreads("));
  const calls = [];
  const enrich = vm.runInNewContext(`${helper}\naddThreadStatuses`, {
    threadStatusReader: { read: async (file) => { calls.push(file); return { running: file === "/running" }; } },
    resolveRolloutPath: (file) => { if (file === "/outside") throw new Error("outside home"); return file; }
  });
  const page = { threads: [{ id: "one", rolloutPath: "/running" }, { id: "two", rolloutPath: "/idle" }, { id: "bad", rolloutPath: "/outside" }], selectedThread: { id: "outside-page", rolloutPath: "/not-requested" } };
  await enrich(page);
  assert.deepEqual(calls.sort(), ["/idle", "/running"]);
  assert.deepEqual(page.threads.map((row) => row.status.running), [true, false, null]);
});

test("sidebar adds and removes its running badge from each poll's status", () => {
  const renderer = app.slice(app.indexOf("function renderThreads("), app.indexOf("\nfunction renderSidebarState("));
  const state = { threads: [{ id: "one", title: "Example", status: { running: true } }], selectedId: null, threadTotal: 1 };
  const els = { threadCount: {}, threadList: {} };
  const render = vm.runInNewContext(`${renderer}\nrenderThreads`, { state, els, visibleThreads: () => state.threads, t: (key) => key, escapeHtml: (value) => value, renderProjectControls() {}, DRAFT_THREAD_ID: "draft" });
  render();
  assert.match(els.threadList.innerHTML, /thread-running/);
  state.threads[0].status.running = false;
  render();
  assert.doesNotMatch(els.threadList.innerHTML, /thread-running/);
  state.threads[0].status.running = null;
  render();
  assert.doesNotMatch(els.threadList.innerHTML, /thread-running/);
});


test("cold status reads recover a start outside the tail and follow later completion", async (t) => {
  const { file, reader } = await fixture(t, { maxBytes: 1024, maxScanBytes: 8192 });
  await fs.writeFile(file, event("task_started") + JSON.stringify({ type: "response_item", payload: { text: "x".repeat(4096) } }) + "\n");
  assert.equal((await reader.read(file)).running, true);
  await fs.appendFile(file, event("task_complete"));
  assert.equal((await reader.read(file)).completed, true);
  reader.clear();
  assert.equal((await reader.read(file)).completed, true);
  await fs.appendFile(file, event("task_started", "next"));
  await fs.appendFile(file, JSON.stringify({ type: "response_item", payload: { text: "x".repeat(4096) } }) + "\n");
  reader.clear();
  assert.equal((await reader.read(file)).running, true);
});
