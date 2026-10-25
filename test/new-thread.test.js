import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const fallback = source.slice(source.indexOf("async function startNewCodexThreadViaAppServer("), source.indexOf("\nasync function openCodexUrl("));

function fixture({ turnError, switchHomeAfterCreate = false, createError } = {}) {
  const calls = [];
  let home = "/account";
  let finish;
  const exited = new Promise((resolve) => { finish = resolve; });
  const context = {
    Date, process: { cwd: () => "/server" },
    codexPaths: () => ({ home }),
    refreshCodexHomeContext: async () => ({ home }),
    threadsCache: "cached", appServerThreadIds: new Set(), appServerClients: new Map(),
    desktopUserInput: (text) => [{ type: "text", text }], logInfo() {},
    codexIpcClient: { notifyThreadAvailable: (id) => { calls.push(["notify", id]); return true; } },
    getLocalAppServerClient: () => ({
      close: async () => {},
      exited,
      createThread: async (options) => {
        calls.push(["create", options]);
        if (createError) throw createError;
        if (switchHomeAfterCreate) home = "/other";
        return { threadId: "new-thread" };
      },
      startTurn: async (id, input) => {
        calls.push(["turn", id, input]);
        if (turnError) throw new Error(turnError);
        return { turn: { id: "first-turn" } };
      }
    })
  };
  return { calls, context, finish, start: vm.runInNewContext(`${fallback}\nstartNewCodexThreadViaAppServer`, context) };
}

test("project creation sends exactly one first turn silently without Desktop navigation or owner discovery", async () => {
  const { start, calls, context, finish } = fixture();
  const result = await start("First message", { id: "project", rootPaths: ["/repo", "/shared"] }, "/account");
  assert.deepEqual(calls.map(([name]) => name), ["create", "notify", "turn"]);
  assert.equal(calls[0][1].cwd, "/repo");
  assert.deepEqual(calls[0][1].workspaceRoots, ["/repo", "/shared"]);
  assert.equal(calls[0][1].projectId, "project");
  assert.deepEqual(calls[2], ["turn", "new-thread", [{ type: "text", text: "First message" }]]);
  assert.equal(result.turnId, "first-turn");
  assert.equal(result.source, "app-server");
  assert.equal(context.threadsCache, null);
  assert.equal(context.appServerThreadIds.has("new-thread"), true);
  finish();
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), ["notify", "new-thread"]);
  assert.equal(calls.filter(([kind]) => kind === "notify").length, 2);
});

test("default directory and synthetic legacy roots retain their directory without fake project IDs", async () => {
  for (const [project, cwd] of [[null, "/server"], [{ id: "root:/legacy", rootPaths: ["/legacy"] }, "/legacy"]]) {
    const { start, calls } = fixture();
    await start("Hello", project);
    assert.equal(calls[0][1].cwd, cwd);
    assert.equal(calls[0][1].projectId, undefined);
  }
});

test("partial failure exposes the existing thread without retrying creation or the first turn", async () => {
  const { start, calls } = fixture({ turnError: "turn/start timed out" });
  await assert.rejects(start("Hello", { id: "p", rootPaths: ["/repo"] }), (error) => {
    assert.equal(error.threadId, "new-thread");
    assert.equal(error.status, 503);
    assert.match(error.message, /Check its messages/);
    return true;
  });
  assert.deepEqual(calls.map(([name]) => name), ["create", "notify", "turn"]);
});

test("account changes prevent delivery and hide old-account thread IDs", async () => {
  const { start, calls } = fixture({ switchHomeAfterCreate: true });
  await assert.rejects(start("Hello", { id: "p", rootPaths: ["/repo"] }, "/account"), (error) => {
    assert.match(error.message, /home changed/);
    assert.equal(error.threadId, undefined);
    return true;
  });
  assert.equal(calls.some(([name]) => name === "turn"), false);
});

test("invalid project settings fail before submitting any message", async () => {
  const { start, calls } = fixture({ createError: new Error("project assignment mismatch") });
  await assert.rejects(start("Hello", { id: "p", rootPaths: ["/repo"] }), /project assignment mismatch/);
  assert.deepEqual(calls.map(([name]) => name), ["create"]);
});

test("the browser leaves draft mode after a partial failure, preserving the selected project's metadata", () => {
  const helper = appSource.slice(appSource.indexOf("function recoverCreatedDraft("), appSource.indexOf("\nfunction pluginMentionMatch("));
  const selection = appSource.slice(appSource.indexOf("function selectComposerThread("), appSource.indexOf("\nfunction t("));
  const state = { composerDrafts: new Map(), selectedId: "draft", draftThread: { id: "draft", cwd: "/repo", projectId: "p", projectName: "Project" } };
  const recover = vm.runInNewContext(`${selection}\n${helper}\nrecoverCreatedDraft`, {
    state, els: { composerInput: { value: "unsent prompt" } }, closePluginMentionMenu() {}, closeSkillMentionMenu() {}, autoResizeComposerInput() {}, DRAFT_THREAD_ID: "draft", clearDraftThread: () => { state.draftThread = null; }, renderThreads() {}, refreshSoon() {}
  });
  assert.equal(recover({ threadId: "created-thread" }), true);
  assert.equal(state.selectedId, "created-thread");
  assert.equal(state.draftThread, null);
  assert.equal(state.selectedThread.projectId, "p");
  assert.equal(state.selectedThread.cwd, "/repo");
  assert.equal(recover({ threadId: "another-thread" }), false);
  assert.equal(state.selectedId, "created-thread");
});
