import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { readModelCatalog, validateModelSettings } from "../lib/model-settings.js";

const models = [{ model: "test-model", supportedReasoningEfforts: ["low", "high"] }];
test("model settings reject unknown model/effort pairs and preserve inheritance", () => {
  assert.deepEqual(validateModelSettings({}, models), {});
  assert.deepEqual(validateModelSettings({ model: "test-model" }, [{ ...models[0], defaultReasoningEffort: "low" }]), { model: "test-model", effort: "low" });
  assert.deepEqual(validateModelSettings({ model: "test-model", effort: "high" }, models), { model: "test-model", effort: "high" });
  for (const settings of [{ model: "unknown" }, { effort: "high" }, { model: "test-model", effort: "ultra" }, { model: {} }]) {
    assert.throws(() => validateModelSettings(settings, models), { status: 400 });
  }
});

test("catalog uses paginated metadata reads, filters hidden models and always closes", async () => {
  const calls = [];
  class Client {
    async initialize() {}
    async request(method, params) {
      calls.push([method, params.cursor]);
      return { data: params.cursor ? [{ model: "hidden", hidden: true }] : [{ model: "test-model", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }], nextCursor: params.cursor ? null : "next" };
    }
    async close() { calls.push(["close"]); }
  }
  const catalog = await readModelCatalog({}, { Client });
  assert.equal(catalog.length, 1);
  assert.deepEqual(catalog[0].supportedReasoningEfforts, ["high"]);
  assert.deepEqual(calls, [["model/list", null], ["model/list", "next"], ["close"]]);
  Client.prototype.request = async () => { throw new Error("offline"); };
  await assert.rejects(readModelCatalog({}, { Client }), /offline/);
  assert.deepEqual(calls.at(-1), ["close"]);
});

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const composer = source.slice(source.indexOf("function renderComposerMode("), source.indexOf("\nasync function loadConfig("));
test("running conversations disable editing and all insert controls, retain stop, and unlock when idle", () => {
  const element = () => ({ classList: { toggle() {} }, setAttribute() {} });
  const els = Object.fromEntries(["composerInput", "attachButton", "pluginPickerButton", "skillPickerButton", "sendButton", "sendStatus"].map((name) => [name, element()]));
  const state = { config: { allowWrite: true }, selectedId: "thread", threadStatus: { thinking: true } };
  let modelDisabled;
  const render = vm.runInNewContext(`${composer}\nrenderComposerMode`, {
    state, els, DRAFT_THREAD_ID: "draft", syncSkillContext: () => false, isSubagentView: () => false,
    hasComposerPayload: () => true, renderModelControls: (disabled) => { modelDisabled = disabled; },
    filePicker: { sync: (disabled) => { els.filePickerButton = { disabled }; } },
    closePluginMentionMenu() {}, closeSkillMentionMenu() {}, closeImagePickerMenu() {}, autoResizeComposerInput() {}, t: (key) => key
  });
  render();
  for (const name of ["composerInput", "attachButton", "pluginPickerButton", "skillPickerButton", "filePickerButton"]) assert.equal(els[name].disabled, true);
  assert.equal(modelDisabled, true);
  assert.equal(els.sendButton.disabled, false);
  state.composerBusy = true;
  render();
  assert.equal(els.sendButton.disabled, true);
  state.composerBusy = false;
  state.threadStatus.thinking = false;
  render();
  assert.equal(els.composerInput.disabled, false);
  assert.equal(els.filePickerButton.disabled, false);
  assert.equal(modelDisabled, false);
  state.config.allowWrite = false;
  render();
  assert.equal(els.composerInput.disabled, true);
  assert.equal(els.sendButton.disabled, true);
});

test("late model responses cannot replace another conversation or account's settings", async () => {
  const functions = source.slice(source.indexOf("function renderModelControls("), source.indexOf('\nels.modelSelect.addEventListener("change"'));
  const state = { selectedId: "a", codexHomeVersion: 1, modelSelections: new Map(), modelCatalog: [] };
  const pending = [];
  const load = vm.runInNewContext(`${functions}\nloadModelControls`, {
    state, DRAFT_THREAD_ID: "draft", renderComposerMode() {}, handleUnauthorized() {},
    fetchJson: () => new Promise((resolve) => pending.push(resolve))
  });
  const first = load("a");
  state.selectedId = "b";
  const second = load("b");
  pending[1]({ models, settings: { model: "b-model" } });
  await second;
  pending[0]({ models: [], settings: { model: "a-model" } });
  await first;
  assert.equal(state.currentModelSettings.model, "b-model");
  const oldAccount = load("b");
  state.codexHomeVersion = 2;
  state.modelCatalog = [];
  state.currentModelSettings = {};
  pending[2]({ models, settings: { model: "old-account" } });
  await oldAccount;
  assert.equal(state.modelCatalog.length, 0);
  assert.deepEqual(state.currentModelSettings, {});
});

test("background model settings read the latest turn context without retaining message content", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readRolloutModelSettings } = await import("../lib/model-settings.js");
  const directory = await mkdtemp(join(tmpdir(), "companion-models-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "rollout.jsonl");
  await writeFile(file, [
    { type: "turn_context", payload: { model: "old", effort: "low" } },
    { type: "turn_context", payload: { model: "test-model", effort: "high" } },
    { type: "response_item", payload: { text: "fixture message" } }
  ].map(JSON.stringify).join("\n") + "\nmalformed\n");
  assert.deepEqual(await readRolloutModelSettings(file), { model: "test-model", effort: "high" });
});

test("empty Desktop fields preserve known effort, explicit values win, and model changes discard stale effort", async () => {
  const { mergeModelSettings } = await import("../lib/model-settings.js");
  const previous = { model: "test-model", effort: "high" };
  assert.deepEqual(mergeModelSettings(previous, { model: "test-model", reasoningEffort: null }), previous);
  assert.deepEqual(mergeModelSettings(previous, { model: null, reasoningEffort: "" }), previous);
  assert.deepEqual(mergeModelSettings(previous, { reasoningEffort: "low" }), { model: "test-model", effort: "low" });
  assert.deepEqual(mergeModelSettings(previous, { model: "new-model", reasoningEffort: null }), { model: "new-model" });
  assert.deepEqual(mergeModelSettings({}, { reasoning_effort: "none" }), { effort: "none" });
  assert.deepEqual(mergeModelSettings({}, { collaborationMode: { settings: { model: "new-model", reasoning_effort: "xhigh" } } }), { model: "new-model", effort: "xhigh" });
  assert.deepEqual(previous, { model: "test-model", effort: "high" });
});

test("long turns recover context beyond 512 KiB, stop at the scan limit, and never infer an older effort", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readRolloutModelSettings } = await import("../lib/model-settings.js");
  const directory = await mkdtemp(join(tmpdir(), "companion-effort-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "rollout.jsonl");
  const context = (effort) => JSON.stringify({ type: "turn_context", payload: { model: "test-model", effort } }) + "\n";
  const messages = (JSON.stringify({ type: "response_item", payload: { text: "x".repeat(8192) } }) + "\n").repeat(100);
  await writeFile(file, context("high") + messages);
  assert.deepEqual(await readRolloutModelSettings(file), { model: "test-model", effort: "high" });
  assert.deepEqual(await readRolloutModelSettings(file, { maxScanBytes: 512 * 1024 }), {});
  await writeFile(file, context("high") + context(null) + messages);
  assert.deepEqual(await readRolloutModelSettings(file), { model: "test-model" });
});

test("known effort is shown directly while unknown effort keeps Use current", () => {
  const renderer = source.slice(source.indexOf("function renderModelControls("), source.indexOf("\nasync function loadModelControls("));
  const state = { selectedId: "thread", modelContext: "thread", currentModelSettings: { model: "test-model", effort: "high" }, modelSelections: new Map(), modelCatalog: models };
  const els = { modelSelect: {}, effortSelect: {} };
  const render = vm.runInNewContext(`${renderer}\nrenderModelControls`, {
    state, els, DRAFT_THREAD_ID: "draft", escapeHtml: String,
    t: (key) => key === "inheritSetting" ? "Use current" : key,
    document: { querySelector: () => ({}) }
  });
  render(false);
  assert.match(els.effortSelect.innerHTML, /^<option value="">high<\/option>/);
  assert.equal(els.effortSelect.value, "");
  state.currentModelSettings = { model: "test-model" };
  render(false);
  assert.match(els.effortSelect.innerHTML, /^<option value="">Use current<\/option>/);
});

test("A to B to A navigation discards the original A request", async () => {
  const functions = source.slice(source.indexOf("function renderModelControls("), source.indexOf('\nels.modelSelect.addEventListener("change"'));
  const state = { selectedId: "a", codexHomeVersion: 1, modelSelections: new Map(), modelCatalog: [] };
  const pending = [];
  const load = vm.runInNewContext(`${functions}\nloadModelControls`, {
    state, DRAFT_THREAD_ID: "draft", renderComposerMode() {}, handleUnauthorized() {},
    fetchJson: () => new Promise((resolve) => pending.push(resolve))
  });
  const a = load("a");
  state.selectedId = "b";
  const b = load("b");
  state.selectedId = "a";
  const latest = load("a");
  pending[2]({ models, settings: { effort: "high" } });
  await latest;
  pending[0]({ models, settings: { effort: "low" } });
  pending[1]({ models, settings: { effort: "medium" } });
  await Promise.all([a, b]);
  assert.equal(state.currentModelSettings.effort, "high");
  assert.equal(state.modelsLoading, false);
});
