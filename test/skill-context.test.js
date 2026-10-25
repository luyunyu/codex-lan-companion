import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const loading = source.slice(source.indexOf("function syncSkillContext("), source.indexOf("\nasync function postJson("));
const composer = source.slice(source.indexOf("function renderComposerMode("), source.indexOf("\nasync function loadConfig("));

function fixture() {
  const state = {
    selectedId: "a", threads: [{ id: "a", cwd: "/a" }, { id: "b", cwd: "/b" }],
    codexHomeVersion: 1, skills: [], selectedSkills: [], selectedPlugins: [],
    skillsContext: "", skillsLoaded: false, skillsLoading: false,
    config: { allowWrite: true }
  };
  const pending = [];
  const element = () => ({ classList: { toggle() {} }, setAttribute() {}, value: "", textContent: "" });
  const context = {
    state, DRAFT_THREAD_ID: "draft", els: new Proxy({}, { get: () => element() }),
    closeSkillMentionMenu: () => { state.skillMenuOpen = false; },
    closePluginMentionMenu() {}, closeImagePickerMenu() {}, renderSkillMentionMenu() {}, renderModelControls() {},
    applyHomeContext: () => false, lockApp() {}, t: (key) => key,
    hasComposerPayload: () => Boolean(state.selectedSkills.length), autoResizeComposerInput() {},
    isSubagentView: () => false, filePicker: { sync() {} },
    fetchJson: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject }))
  };
  const api = vm.runInNewContext(`${loading}\n${composer}\n({ loadSkills, syncSkillContext, renderComposerMode })`, context);
  return { state, pending, ...api };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("switching conversations refreshes skills and ignores late responses", async () => {
  const ui = fixture();
  ui.renderComposerMode();
  assert.equal(ui.pending[0].url, "/api/skills?threadId=a");
  ui.state.selectedId = "b";
  ui.renderComposerMode();
  assert.equal(ui.pending[1].url, "/api/skills?threadId=b");
  ui.pending[0].resolve({ skills: [{ name: "old" }] });
  await flush();
  assert.equal(ui.state.skills.length, 0);
  assert.equal(ui.state.skillsLoading, true);
  ui.pending[1].resolve({ skills: [{ name: "current" }] });
  await flush();
  assert.equal(ui.state.skills[0].name, "current");
  assert.equal(ui.state.skillsLoading, false);
  ui.renderComposerMode();
  assert.equal(ui.pending.length, 2);
  ui.state.selectedId = "a";
  ui.renderComposerMode();
  assert.equal(ui.pending[2].url, "/api/skills?threadId=a");
  ui.pending[2].resolve({ skills: [] });
  await flush();
});

test("late failures do not clear the new project's results; cwd and account changes invalidate cache", async () => {
  const ui = fixture();
  ui.renderComposerMode();
  ui.state.selectedId = "b";
  ui.renderComposerMode();
  ui.pending[1].resolve({ skills: [{ name: "current" }] });
  await flush();
  ui.pending[0].reject(new Error("old request failed"));
  await flush();
  assert.equal(ui.state.skills[0].name, "current");
  ui.state.threads[1].cwd = "/b/worktree";
  ui.renderComposerMode();
  assert.equal(ui.pending.length, 3);
  ui.state.codexHomeVersion = 2;
  ui.renderComposerMode();
  assert.equal(ui.pending.length, 4);
  ui.pending[2].resolve({ skills: [{ name: "old-account" }] });
  ui.pending[3].resolve({ skills: [{ name: "new-account" }] });
  await flush();
  assert.equal(ui.state.skills[0].name, "new-account");
});

test("drafts request the server's creation directory", async () => {
  const ui = fixture();
  ui.state.selectedId = "draft";
  ui.renderComposerMode();
  assert.equal(ui.pending[0].url, "/api/skills");
  ui.pending[0].resolve({ skills: [] });
  await flush();

});
