import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const selection = source.slice(source.indexOf("function selectComposerThread("), source.indexOf("\nfunction t("));
const home = source.slice(source.indexOf("function applyHomeContext("), source.indexOf("\nasync function loadThreads("));

function fixture() {
  const state = { selectedId: "a", composerDrafts: new Map(), codexHomeVersion: 1 };
  const els = { composerInput: { value: "" }, messageList: {} };
  const noop = () => {};
  const context = {
    state, els, closePluginMentionMenu: noop, closeSkillMentionMenu: noop,
    autoResizeComposerInput: noop, clearDraftThread: noop, renderSubagents: noop,
    initProjectPreference: noop, hasActiveDraft: () => false,
    clearSelectedPlugins: noop, clearSelectedSkills: noop, t: (key) => key, escapeHtml: (value) => value
  };
  return { state, input: els.composerInput, ...vm.runInNewContext(`${selection}\n${home}\n({ selectComposerThread, applyHomeContext })`, context) };
}

test("conversation text drafts remain independent, including whitespace and empty edits", () => {
  const ui = fixture();
  ui.input.value = "  draft A\n";
  ui.selectComposerThread("b");
  assert.equal(ui.input.value, "");
  ui.input.value = "draft B";
  ui.selectComposerThread("a");
  assert.equal(ui.input.value, "  draft A\n");
  ui.selectComposerThread("a");
  assert.equal(ui.input.value, "  draft A\n");
  ui.input.value = "";
  ui.selectComposerThread("b");
  assert.equal(ui.input.value, "draft B");
  ui.selectComposerThread("a");
  assert.equal(ui.input.value, "");
});

test("new conversation and read-only child navigation preserve the parent's draft", () => {
  const ui = fixture();
  ui.input.value = "parent draft";
  ui.selectComposerThread("new");
  assert.equal(ui.input.value, "");
  ui.input.value = "new conversation draft";
  ui.selectComposerThread("a");
  ui.selectComposerThread("child");
  assert.equal(ui.input.value, "");
  ui.selectComposerThread("a");
  assert.equal(ui.input.value, "parent draft");
  ui.selectComposerThread("new");
  assert.equal(ui.input.value, "new conversation draft");
});

test("partial thread creation moves unsent text to the created conversation", () => {
  const ui = fixture();
  ui.input.value = "retry this prompt";
  ui.selectComposerThread("created", { moveDraft: true });
  assert.equal(ui.input.value, "retry this prompt");
  assert.equal(ui.state.composerDrafts.has("a"), false);
  ui.selectComposerThread("other");
  ui.selectComposerThread("created");
  assert.equal(ui.input.value, "retry this prompt");
});

test("home changes clear both stored drafts and the current input", () => {
  const ui = fixture();
  ui.input.value = "account A draft";
  ui.selectComposerThread("b");
  ui.input.value = "account A current input";
  assert.equal(ui.applyHomeContext({ codexHomeVersion: 1 }), false);
  assert.equal(ui.input.value, "account A current input");
  assert.equal(ui.applyHomeContext({ codexHomeVersion: 2 }), true);
  assert.equal(ui.input.value, "");
  assert.equal(ui.state.composerDrafts.size, 0);
  ui.selectComposerThread("a");
  assert.equal(ui.input.value, "");
});


test("rich draft snapshots preserve reference positions and exact skill paths", () => {
  const ui = fixture();
  let mentions = [{ type: "skill", name: "sample", path: "/fixture/sample/SKILL.md", label: "$sample", start: 3, end: 10 }];
  ui.input.value = "用它 $sample";
  ui.input.snapshot = () => ({ text: ui.input.value, mentions: structuredClone(mentions) });
  ui.input.restore = (draft) => { ui.input.value = draft.text; mentions = structuredClone(draft.mentions); };
  const saved = ui.input.snapshot();
  ui.selectComposerThread("b");
  mentions = [];
  ui.input.value = "other thread";
  ui.selectComposerThread("a");
  assert.deepEqual(ui.input.snapshot(), saved);
  ui.selectComposerThread("created", { moveDraft: true });
  assert.deepEqual(ui.input.snapshot(), saved);
  assert.equal(ui.state.composerDrafts.has("a"), false);
});


test("existing inline references never reopen completion while typing after them", () => {
  const matches = source.slice(source.indexOf("function pluginMentionMatch("), source.indexOf("\nfunction filteredPlugins("));
  const input = { value: "$sample @Demo more text", selectionStart: 23, getMentions: () => [{ start: 0, end: 7 }, { start: 8, end: 13 }] };
  const api = vm.runInNewContext(`${matches}\n({ pluginMentionMatch, skillMentionMatch })`, { els: { composerInput: input } });
  assert.equal(api.pluginMentionMatch(), null);
  assert.equal(api.skillMentionMatch(), null);
  input.value += " $new";
  input.selectionStart = input.value.length;
  assert.equal(api.skillMentionMatch().query, "new");
  input.value += " @other";
  input.selectionStart = input.value.length;
  assert.equal(api.pluginMentionMatch().query, "other");
});
