import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { subagentInfo, childThreads, SessionMetadataReader } from "../lib/subagent-threads.js";
import { ThreadStatusReader } from "../lib/thread-status.js";

const spawnSource = (parentId, nickname = "Worker") => ({ subagent: { thread_spawn: { parent_thread_id: parentId, agent_nickname: nickname } } });

test("subagent identity uses metadata, supports both representations and never guesses from titles", () => {
  assert.equal(subagentInfo({ title: "Untitled", source: "user" }).isSubagent, false);
  assert.equal(subagentInfo({ threadSource: "malformed" }).isSubagent, false);
  assert.equal(subagentInfo({ threadSource: "subagent" }).isSubagent, true);
  assert.equal(subagentInfo({ source: { subagent: { other: "explorer" } } }).isSubagent, true);
  assert.equal(subagentInfo({ threadSource: "session-index", source: JSON.stringify(spawnSource("parent")) }).parentId, "parent");
  const rows = [
    { id: "a", title: "Untitled", threadSource: JSON.stringify(spawnSource("parent", "Alpha")) },
    { id: "b", title: "Untitled", source: spawnSource("parent", "Beta"), archived: true },
    { id: "grandchild", source: spawnSource("a") },
    { id: "other-parent", source: spawnSource("elsewhere") },
    { id: "user", title: "Untitled" }
  ];
  assert.deepEqual(childThreads(rows, "parent").map((row) => [row.id, row.title]), [["a", "Alpha"], ["b", "Beta"]]);
  assert.deepEqual(childThreads(rows, null), []);
});

test("header fallback reads bounded metadata, ignores message bodies and invalidates replacement files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "companion-agent-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "session.jsonl");
  const header = (source) => JSON.stringify({ type: "session_meta", payload: { source, privateField: "DO_NOT_RETURN" } }) + "\n";
  const reader = new SessionMetadataReader({ maxBytes: 1024 });
  await fs.writeFile(file, header(spawnSource("parent")) + "x".repeat(4096));
  assert.equal(subagentInfo(await reader.read(file)).parentId, "parent");
  assert.doesNotMatch(JSON.stringify(await reader.read(file)), /DO_NOT_RETURN/);
  await fs.rename(file, file + ".old");
  await fs.writeFile(file, header("user"));
  assert.equal(subagentInfo(await reader.read(file)).isSubagent, false);
  reader.clear();
  assert.equal(reader.cache.size, 0);
  await fs.writeFile(file, "x".repeat(1024) + "\n" + header(spawnSource("hidden")));
  assert.deepEqual(await reader.read(file), {});
  assert.deepEqual(await reader.read(file + ".missing"), {});
});

test("completion counts require a completion event and reset when an agent starts again", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "companion-agent-status-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "session.jsonl");
  const reader = new ThreadStatusReader({ staleMs: 1000 });
  const event = (type) => JSON.stringify({ type: "event_msg", timestamp: new Date().toISOString(), payload: { type, turn_id: "turn" } }) + "\n";
  await fs.writeFile(file, "");
  assert.equal((await reader.read(file)).completed, false);
  await fs.appendFile(file, event("task_started"));
  assert.equal((await reader.read(file, Date.now() + 2000)).completed, false);
  await fs.appendFile(file, event("task_complete"));
  assert.equal((await reader.read(file)).completed, true);
  await fs.appendFile(file, event("task_started"));
  assert.equal((await reader.read(file)).completed, false);
  await fs.appendFile(file, event("turn_aborted"));
  assert.equal((await reader.read(file)).completed, false);
});

const app = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const navigation = app.slice(app.indexOf("function isSubagentView("), app.indexOf('\nels.subagentButton.addEventListener('));
test("child navigation is nested, clears the child composer and restores the parent's input, attachments and history", () => {
  const state = {
    composerDrafts: new Map(), selectedId: "parent", selectedThread: { id: "parent" }, threadNavigation: [],
    subagents: [{ id: "child", title: "Worker", status: { running: true } }],
    subagentMenuOpen: false, lastMessagesData: { messages: [{ content: "parent message" }] },
    messageHistory: { expanded: true }, messagesSignature: "parent-signature",
    imageAttachments: [{ id: "image" }], selectedPlugins: [{ uri: "plugin" }], selectedSkills: [{ path: "skill" }]
  };
  const element = () => ({ setAttribute() {} });
  const els = { parentThreadButton: element(), subagentButton: element(), subagentCounts: element(), subagentMenu: element(), messageList: { scrollTop: 123 }, composerInput: { value: "unsent prompt" } };
  const requests = [];
  const selection = app.slice(app.indexOf("function selectComposerThread("), app.indexOf("\nfunction t("));
  const api = vm.runInNewContext(`${selection}\n${navigation}\n({ openSubagent, returnToParent, renderSubagents, isSubagentView, closeSubagentMenuOnOutsideClick })`, {
    syncUserInputDialog() {},
    state, els, escapeHtml: (s) => String(s).replaceAll("<", "&lt;"), t: (key, values) => key === "subagentCounts" ? `${values.running}/${values.completed}` : key.endsWith("Count") ? String(values.count) : key,
    clearSelectedPlugins: () => { state.selectedPlugins = []; }, clearSelectedSkills: () => { state.selectedSkills = []; },
    closePluginMentionMenu() {}, closeSkillMentionMenu() {}, autoResizeComposerInput() {}, closeImagePickerMenu() {}, closeAccountPanel() {}, renderImageAttachments() {}, renderThreads() {}, renderMessages() {}, renderComposerMode() {}, renderSelectedPlugins() {}, renderSelectedSkills() {},
    loadMessages: async (force, id) => { requests.push([force, id]); }, handleUnauthorized() {}
  });
  api.renderSubagents();
  assert.equal(els.subagentCounts.innerHTML, "<span>1</span><span>0</span>");
  state.subagents[0].status = { running: null };
  api.renderSubagents();
  assert.equal(els.subagentCounts.innerHTML, "<span>0</span><span>0</span><span>1</span>");
  state.subagents[0].status = { running: true };
  state.subagentMenuOpen = true;
  // A click on the count span survives the render that replaces that span.
  api.closeSubagentMenuOnOutsideClick({ composedPath: () => [{}, els.subagentButton] });
  assert.equal(state.subagentMenuOpen, true);
  api.closeSubagentMenuOnOutsideClick({ composedPath: () => [] });
  assert.equal(state.subagentMenuOpen, false);
  const history = state.messageHistory;
  api.openSubagent(state.subagents[0]);
  assert.equal(api.isSubagentView(), true);
  assert.equal(state.selectedId, "child");
  assert.equal(els.composerInput.value, "");
  assert.equal(state.imageAttachments.length, 0);
  assert.equal(els.parentThreadButton.hidden, false);
  api.openSubagent({ id: "grandchild" });
  api.returnToParent();
  assert.equal(state.selectedId, "child");
  api.returnToParent();
  assert.equal(state.selectedId, "parent");
  assert.equal(api.isSubagentView(), false);
  assert.equal(els.composerInput.value, "unsent prompt");
  assert.equal(els.messageList.scrollTop, 123);
  assert.equal(state.imageAttachments[0].id, "image");
  assert.equal(state.selectedSkills[0].path, "skill");
  assert.equal(state.selectedPlugins[0].uri, "plugin");
  assert.equal(state.messageHistory, history);
  assert.equal(els.parentThreadButton.hidden, true);
  assert.deepEqual(requests, [[true, "child"], [true, "grandchild"], [false, "child"], [false, "parent"]]);
});
