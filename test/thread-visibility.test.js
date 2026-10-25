import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { subagentInfo, sidebarThreadPage } from "../lib/subagent-threads.js";
import { threadPage } from "../lib/thread-projects.js";

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function isArchivedThread("), source.indexOf("\nasync function getAccountInfo("));
const loader = source.slice(source.indexOf("async function loadThreadsUncached("), source.indexOf("\nasync function findThread("));
const guardian = JSON.stringify({ subagent: { other: "guardian" } });

test("Guardian detection uses source metadata and never the conversation title", () => {
  const isGuardianThread = vm.runInNewContext(`${helpers}\nisGuardianThread`);
  assert.equal(isGuardianThread({ threadSource: guardian }), true);
  assert.equal(isGuardianThread({ source: { subagent: { other: "guardian" } } }), true);
  assert.equal(isGuardianThread({ threadSource: "guardian_review" }), true);
  assert.equal(isGuardianThread({ title: "Guardian review", threadSource: "user" }), false);
  assert.equal(isGuardianThread({ threadSource: '{"subagent":{"other":"explorer"}}' }), false);
  assert.equal(isGuardianThread({ threadSource: "malformed metadata" }), false);
});

function fixture({ database = true, stateRows = [], indexRows = [], ipcRows = [], guardianIds = [] } = {}) {
  const context = {
    Date, Set, Map, Number, String,
    subagentInfo,
    threadsCache: null,
    SLOW_POLL_REQUEST_MS: 5000,
    THREADS_STALE_CACHE_MS: 60000,
    refreshCodexHomeContext: async () => ({ home: "/test" }),
    codexPaths: () => ({ stateDb: "/test/state.sqlite", sessionIndex: "/test/index" }),
    existsSync: () => database,
    readSessionIndexTitleMap: async () => new Map(),
    readSessionIndexRows: async () => indexRows,
    runSqlJson: async (sql) => sql.includes("json_valid(source)") ? guardianIds.map((id) => ({ id })) : stateRows,
    filterRowsForCurrentAccount: async (rows) => ({ rows }),
    hydrateThreadSources: async (rows) => rows,
    displayThreadTitle: (row) => row.title,
    codexIpcClient: { getDesktopConversationRows: () => ipcRows },
    logInfo: () => {},
    logError: () => {}
  };
  return vm.runInNewContext(`${helpers}\n${loader}\nloadThreadsUncached`, context);
}

test("internal threads stay excluded across state, index, IPC and preserved selections", async () => {
  const load = fixture({
    stateRows: [
      { id: "user", title: "Guardian review", threadSource: "user" },
      { id: "guardian", title: "Review", threadSource: guardian },
      { id: "archived", archived: 1 }
    ],
    indexRows: [{ id: "old-guardian" }, { id: "guardian" }, { id: "archived" }, { id: "indexed-user" }],
    ipcRows: [
      { id: "old-guardian", rolloutPath: "/test/old.jsonl" },
      { id: "ipc-guardian", threadSource: "guardian_review", rolloutPath: "/test/guardian.jsonl" },
      { id: "ipc-user", rolloutPath: "/test/user.jsonl" }
    ],
    guardianIds: ["guardian", "old-guardian"]
  });
  const rows = await load({ preserveIds: ["guardian", "old-guardian"] });
  assert.deepEqual(Array.from(rows, (row) => row.id).sort(), ["indexed-user", "ipc-user", "user"]);
});

test("index fallback retains child metadata while the sidebar hides every subagent", async () => {
  const load = fixture({ database: false, indexRows: [
    { id: "guardian", threadSource: guardian },
    { id: "explorer", threadSource: { subagent: { other: "explorer" } } },
    { id: "user", title: "Guardian review" }
  ] });
  const rows = await load();
  assert.deepEqual(Array.from(rows, (row) => row.id).sort(), ["explorer", "user"]);
  const page = sidebarThreadPage(rows, { selectedId: "explorer" }, threadPage);
  assert.deepEqual(Array.from(page.threads, (row) => row.id), ["user"]);
  assert.equal(page.selectedThread.id, "explorer");
});

test("archived children remain reachable from the parent but never enter sidebar totals or search", async () => {
  const child = { id: "child", title: "Untitled", archived: 1, threadSource: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: "parent" } } }) };
  const load = fixture({ stateRows: [child, { id: "parent", title: "Untitled" }, { id: "archived", archived: 1 }], indexRows: [{ id: "child" }] });
  const rows = await load({ preserveIds: ["child"] });
  assert.equal(rows.find((row) => row.id === "child").threadSource, child.threadSource);
  const page = sidebarThreadPage(rows, { query: "Untitled", selectedId: "child" }, threadPage);
  assert.equal(page.total, 1);
  assert.deepEqual(Array.from(page.threads, (row) => row.id), ["parent"]);
  assert.equal(page.selectedThread.id, "child");
});
