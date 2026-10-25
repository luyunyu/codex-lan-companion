import { desktopUserInput } from "../lib/desktop-user-input.js";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { projectCatalog, withThreadProjects, threadPage } from "../lib/thread-projects.js";

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("modern projects deduplicate migrated legacy roots and retain empty projects", () => {
  const catalog = projectCatalog({
    "local-projects": { old: { id: "old", name: "Legacy", rootPaths: ["/repo"] } },
    "app-server-project-id-by-legacy-project-id-by-host": { "local:/home": { old: "new" } },
    "electron-saved-workspace-roots": ["/repo", "/other"]
  }, [{ id: "new", name: "Renamed" }, { id: "empty", name: "Empty" }], [{ project_id: "new", path: "/repo" }]);
  assert.deepEqual(catalog.projects.map((row) => row.id), ["new", "empty"]);
  assert.equal(catalog.aliases.get("old"), "new");
  assert.equal(catalog.projects[0].name, "Renamed");
  const emptyModern = projectCatalog({ "electron-saved-workspace-roots": ["/stale"] }, [], [], { databaseAvailable: true });
  assert.equal(emptyModern.projects.length, 0);
  assert.equal(projectCatalog({ "electron-saved-workspace-roots": ["/legacy"] }).projects[0].rootPaths[0], "/legacy");
});

test("membership overrides cwd, projectless stays projectless, legacy matching uses path boundaries", () => {
  const catalog = projectCatalog({
    "local-projects": { old: { id: "old", name: "Repo", rootPaths: ["/repo"] }, nested: { id: "nested", name: "Nested", rootPaths: ["/repo/nested"] } },
    "thread-project-assignments": { assigned: { projectKind: "local", projectId: "old" } },
    "projectless-thread-ids": ["none", "modern-none"]
  });
  const rows = withThreadProjects([
    { id: "assigned", cwd: "/worktrees/test" }, { id: "none", cwd: "/repo" },
    { id: "nested", cwd: "/repo/nested/sub" }, { id: "boundary", cwd: "/repository" },
    { id: "modern", cwd: "/repo" }, { id: "modern-none", cwd: "/repo" }
  ], catalog, new Map([["modern", "nested"], ["modern-none", null]]));
  assert.deepEqual(rows.map((row) => row.projectId), ["old", null, "nested", null, "nested", null]);
});

test("NULL SQLite memberships fall back to Desktop assignments and workspace hints", () => {
  const catalog = projectCatalog({
    "local-projects": { old: { id: "old", name: "Legacy name", rootPaths: ["/repo"] } },
    "app-server-project-id-by-legacy-project-id-by-host": { "local:/home": { old: "new" } },
    "thread-project-assignments": { assigned: { projectKind: "local", projectId: "old" } },
    "thread-workspace-root-hints": { hinted: "/repo" },
    "projectless-thread-ids": ["none"]
  }, [{ id: "new", name: "Project" }], [{ project_id: "new", path: "/repo" }]);
  const rows = [
    { id: "assigned", cwd: "/worktrees/task" },
    { id: "hinted", cwd: "/worktrees/task" },
    { id: "cwd", cwd: "/repo/src" },
    { id: "none", cwd: "/repo" },
    { id: "unknown", cwd: "/outside" },
    { id: "stale", cwd: "/repo" }
  ];
  const memberships = new Map(rows.map((row) => [row.id, null]));
  memberships.set("stale", "deleted-project");
  const resolved = withThreadProjects(rows, catalog, memberships);
  assert.deepEqual(resolved.map((row) => row.projectId), ["new", "new", "new", null, null, null]);
  assert.equal(resolved[0].projectName, "Project");
  assert.equal(threadPage(resolved, { projectId: "new" }).total, 3);
  assert.equal(threadPage(resolved, { projectId: "__none__" }).total, 3);
});

test("pagination searches the full list, caps responses, and returns selection outside the page", () => {
  const rows = Array.from({ length: 123 }, (_, i) => ({ id: String(i), title: `Thread ${i}`, projectId: i % 2 ? "a" : null, projectName: i % 2 ? "Alpha" : "" }));
  const first = threadPage(rows, { selectedId: "122" });
  assert.equal(first.threads.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(first.selectedThread.id, "122");
  const last = threadPage(rows, { offset: 100 });
  assert.equal(last.threads.length, 23);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, 123);
  assert.equal(threadPage(rows, { query: "Thread 122" }).threads[0].id, "122");
  assert.equal(threadPage(rows, { query: "Alpha", projectId: "a" }).total, 61);
  assert.equal(threadPage(rows, { projectId: "__none__" }).total, 62);
  assert.equal(threadPage(rows, { offset: -2, limit: 100000, query: null }).threads.length, 100);
});

test("Desktop creation passes the selected project's roots and explicit membership", async () => {
  const start = source.slice(source.indexOf("  async startConversation("), source.indexOf("\n}\n\nfunction getCodexIpcClient"));
  let sent;
  const client = vm.runInNewContext(`new (class { ${start} })`, { process: { cwd: () => "/server" }, desktopUserInput });
  client.ensureReady = async () => {};
  client.request = async (method, params) => { sent = { method, params }; };
  await client.startConversation("Hello", [], { id: "p", rootPaths: ["/repo", "/shared"] });
  assert.equal(sent.method, "start-conversation");
  assert.equal(sent.params.cwd, "/repo");
  assert.deepEqual(Array.from(sent.params.workspaceRoots), ["/repo", "/shared"]);
  assert.equal(sent.params.projectAssignment.projectId, "p");
  await client.startConversation("Hello");
  assert.equal(sent.params.cwd, "/server");
  assert.equal(sent.params.projectAssignment, undefined);
  await client.startConversation("[$sample](/fixture/sample/SKILL.md)", [], { id: "p", rootPaths: ["/repo"] });
  assert.equal(sent.params.input[1].type, "skill");
  assert.equal(sent.params.input[1].path, "/fixture/sample/SKILL.md");
  await client.startConversation("Hello", [], { id: "root:/repo", rootPaths: ["/repo"] });
  assert.equal(sent.params.cwd, "/repo");
  assert.equal(sent.params.projectAssignment, undefined);
});

test("unsupported Desktop creation falls back with the selected project and account home", async () => {
  const create = source.slice(source.indexOf("async function startNewCodexThread("), source.indexOf("\nasync function startNewCodexThreadViaAppServer("));
  const fallbacks = [];
  let message = "no-client-found";
  const start = vm.runInNewContext(`${create}\nstartNewCodexThread`, {
    codexPaths: () => ({ home: "/home" }),
    getCodexIpcClient: () => ({ ensureReady: async () => {}, protocol: { detected: false }, startConversation: async () => { throw new Error(message); } }),
    startNewCodexThreadViaAppServer: async (...args) => { fallbacks.push(args); return { threadId: "new" }; }
  });
  const project = { id: "p", rootPaths: ["/repo"], codexHome: "/home" };
  assert.equal((await start("Hello", project)).threadId, "new");
  assert.deepEqual(JSON.parse(JSON.stringify(fallbacks[0])), ["Hello", project, "/home", {}]);
  assert.equal((await start("Hello")).threadId, "new");
  assert.equal(fallbacks.length, 2);
  message = "start-conversation timed out";
  await assert.rejects(start("Hello", project), /timed out/);
  message = "Project not found";
  await assert.rejects(start("Hello", project), /Project not found/);
  await assert.rejects(start("Hello", { ...project, codexHome: "/other" }), /home changed/);
  assert.equal(fallbacks.length, 2);
});

test("client refreshes only loaded pages and preserves selection across filters", async () => {
  const loader = appSource.slice(appSource.indexOf("async function loadThreads("), appSource.indexOf("\nfunction renderTransientSyncError"));
  const rows = Array.from({ length: 123 }, (_, i) => ({ id: String(i) }));
  const state = { threads: [], projects: [], selectedId: "122", threadNextOffset: 0, threadRequestSeq: 0, filter: "", projectFilter: "" };
  const requests = [];
  const load = vm.runInNewContext(`${loader}\nloadThreads`, {
    state, URLSearchParams, Map, Math, selectComposerThread: (id) => { state.selectedId = id; },
    fetchJson: async (url) => { requests.push(url); return { ...threadPage(rows, Object.fromEntries(new URL(url, "http://test").searchParams)), projects: [] }; },
    renderThreads() {}, renderComposerMode() {}, noteSyncSuccess() {}, applyHomeContext: () => false, hasActiveDraft: () => false,
    DRAFT_THREAD_ID: "draft"
  });
  await load();
  assert.equal(state.threads.length, 50);
  assert.equal(state.selectedId, "122");
  await load({ append: true });
  assert.equal(state.threads.length, 100);
  requests.length = 0;
  await load();
  assert.equal(requests.length, 2);
  assert.equal(state.threads.length, 100);
  assert.equal(state.selectedId, "122");
});

test("saved sidebar project is restored and controls draft defaults without inheriting another conversation", () => {
  const preference = appSource.slice(appSource.indexOf("function initProjectPreference("), appSource.indexOf("\nfunction initAuthToken("));
  const storage = new Map([["project-filter", "b"]]);
  const state = { projectFilter: "", projects: [{ id: "a", rootPaths: ["/a"] }, { id: "b", rootPaths: ["/b"] }], selectedThread: { projectId: "a" } };
  const api = vm.runInNewContext(`${preference}\n({ initProjectPreference, defaultDraftProject })`, {
    state, localStorage: storage, PROJECT_FILTER_STORAGE_KEY: "project-filter", safeStorageGet: (store, key) => store.get(key) || ""
  });
  api.initProjectPreference();
  assert.equal(state.projectFilter, "b");
  assert.equal(api.defaultDraftProject().id, "b");
  storage.set("project-filter", "__none__");
  api.initProjectPreference();
  assert.equal(state.projectFilter, "__none__");
  assert.equal(api.defaultDraftProject(), null);
  storage.set("project-filter", "");
  assert.equal(api.defaultDraftProject(), null);
  storage.set("project-filter", "deleted");
  api.initProjectPreference();
  assert.equal(state.projectFilter, "deleted");
  assert.equal(api.defaultDraftProject(), null);
});

test("initial load, pagination and polling send only the saved project filter", async () => {
  const loader = appSource.slice(appSource.indexOf("async function loadThreads("), appSource.indexOf("\nfunction renderTransientSyncError"));
  const state = { threads: [], projects: [], selectedId: null, threadNextOffset: 0, threadRequestSeq: 0, filter: "", projectFilter: "saved" };
  const requests = [];
  const rows = Array.from({ length: 125 }, (_, i) => ({ id: String(i), projectId: i < 120 ? "saved" : "other" }));
  const load = vm.runInNewContext(`${loader}\nloadThreads`, {
    state, URLSearchParams, Map, Math, selectComposerThread: (id) => { state.selectedId = id; }, DRAFT_THREAD_ID: "draft",
    fetchJson: async (url) => {
      const params = Object.fromEntries(new URL(url, "http://test").searchParams);
      requests.push(params);
      return { ...threadPage(rows, params), projects: [] };
    },
    renderThreads() {}, renderComposerMode() {}, noteSyncSuccess() {}, applyHomeContext: () => false, hasActiveDraft: () => false
  });
  await load();
  await load({ append: true });
  await load();
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.projectId === "saved"));
  assert.equal(state.threadTotal, 120);
  assert.ok(state.threads.every((thread) => thread.projectId === "saved"));
});
