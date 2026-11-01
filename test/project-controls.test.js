import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const controls = source.slice(source.indexOf("function visibleThreads("), source.indexOf("\nfunction renderSidebarState("));
const loader = source.slice(source.indexOf("async function loadThreads("), source.indexOf("\nfunction renderTransientSyncError("));

function setup() {
  const select = () => ({
    options: [], currentValue: "", replacements: 0, selections: 0,
    get value() { return this.currentValue; },
    set value(value) { this.currentValue = value; this.selections += 1; },
    replaceChildren(...options) {
      this.options = options;
      this.currentValue = options[0]?.value || "";
      this.replacements += 1;
    },
    setAttribute() {}
  });
  const state = {
    projects: [{ id: "a", name: `A & "B" <C> 'D'`, rootPaths: ["/fixture"] }],
    projectFilter: "a", selectedId: "thread", threads: [], filter: "",
    threadRequestSeq: 0, threadNextOffset: 0, config: { allowWrite: true }
  };
  const els = {
    projectFilter: select(), draftProjectSelect: select(), draftProjectField: {},
    threadCount: {}, threadList: {}
  };
  const pending = [];
  let language = "zh";
  const api = vm.runInNewContext(`${controls}\n${loader}\n({ renderProjectControls, loadThreads })`, {
    state, els, DRAFT_THREAD_ID: "draft", URLSearchParams,
    document: { createElement: () => ({}), querySelector: () => ({}) },
    t: (key) => `${language}:${key}`, escapeHtml: String,
    fetchJson: () => new Promise((resolve) => pending.push(resolve)),
    applyHomeContext: () => false, hasActiveDraft: () => false,
    renderComposerMode() {}, noteSyncSuccess() {}, selectComposerThread() {}
  });
  return { state, els, pending, ...api, setLanguage: (value) => { language = value; } };
}

test("thread polling preserves project option nodes and selection at request start and completion", async () => {
  const { state, els, pending, renderProjectControls, loadThreads } = setup();
  renderProjectControls();
  const sidebarOptions = [...els.projectFilter.options];
  const draftOptions = [...els.draftProjectSelect.options];
  const selections = els.projectFilter.selections;
  for (let i = 0; i < 2; i += 1) {
    const request = loadThreads();
    sidebarOptions.forEach((option, index) => assert.equal(els.projectFilter.options[index], option));
    pending.shift()({
      threads: [{ id: "thread", title: `Update ${i}` }], selectedThread: { id: "thread" },
      projects: structuredClone(state.projects), total: 1, nextOffset: 1, hasMore: false
    });
    await request;
    sidebarOptions.forEach((option, index) => assert.equal(els.projectFilter.options[index], option));
    draftOptions.forEach((option, index) => assert.equal(els.draftProjectSelect.options[index], option));
  }
  assert.equal(els.projectFilter.replacements, 1);
  assert.equal(els.draftProjectSelect.replacements, 1);
  assert.equal(els.projectFilter.selections, selections);
  assert.equal(els.projectFilter.value, "a");
  assert.equal(els.projectFilter.options[2].textContent, state.projects[0].name);
  assert.match(els.threadList.innerHTML, /Update 1/);
});

test("selection, draft visibility and busy state update without rebuilding project options", () => {
  const { state, els, renderProjectControls } = setup();
  renderProjectControls();
  state.projectFilter = "__none__";
  state.selectedId = "draft";
  state.draftThread = { projectId: "a" };
  state.composerBusy = true;
  renderProjectControls();
  assert.equal(els.projectFilter.value, "__none__");
  assert.equal(els.draftProjectSelect.value, "a");
  assert.equal(els.draftProjectField.hidden, false);
  assert.equal(els.draftProjectSelect.disabled, true);
  state.composerBusy = false;
  renderProjectControls();
  assert.equal(els.draftProjectSelect.disabled, false);
  assert.equal(els.projectFilter.replacements, 1);
  assert.equal(els.draftProjectSelect.replacements, 1);
});

test("catalog and language changes still refresh project options and retain unavailable selections", () => {
  const { state, els, renderProjectControls, setLanguage } = setup();
  renderProjectControls();
  state.projects[0].name = "Renamed";
  renderProjectControls();
  assert.equal(els.projectFilter.options[2].textContent, "Renamed");
  assert.equal(els.projectFilter.value, "a");
  state.projects = [{ id: "b", name: "No local roots", rootPaths: [] }];
  renderProjectControls();
  assert.equal(els.projectFilter.options[2].value, "b");
  assert.equal(els.projectFilter.options[3].textContent, "zh:unavailableProject");
  assert.equal(els.projectFilter.value, "a");
  assert.equal(els.draftProjectSelect.options.length, 1);
  setLanguage("en");
  renderProjectControls();
  assert.equal(els.projectFilter.options[0].textContent, "en:allProjects");
  assert.equal(els.projectFilter.options[3].textContent, "en:unavailableProject");
  assert.equal(els.draftProjectSelect.options[0].textContent, "en:defaultDirectory");
  assert.equal(els.projectFilter.value, "a");
});
