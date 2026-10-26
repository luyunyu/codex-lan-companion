import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const render = source.slice(source.indexOf("function renderContextUsage("), source.indexOf("function renderAccount("));

test("context details clear across conversations, preserve zero usage and format ISO report times", () => {
  const element = () => ({ attributes: {}, classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; } });
  const els = { contextSummary: element(), contextPanel: element() };
  const state = { selectedId: "a", locale: "en", contextExpanded: true };
  const times = [];
  const ui = vm.runInNewContext(`${render}\n({renderContextUsage, closeContextPanel})`, {
    state, els, Intl, t: (key, values) => values ? `${key} ${values.time}` : key,
    escapeHtml: String, formatResetTime: (value) => { times.push(value); return Number.isFinite(value) ? "report time" : ""; }
  });
  const data = { thread: { id: "a" }, contextUsage: { usedTokens: 0, contextWindow: 100000, usedPercent: 0, updatedAt: "2026-10-26T01:00:00Z" } };
  state.lastMessagesData = data;
  ui.renderContextUsage();
  assert.equal(els.contextSummary.textContent, "contextLabel 0%");
  assert.match(els.contextPanel.innerHTML, /100,000/);
  assert.match(els.contextPanel.innerHTML, /updated report time/);
  assert.equal(times.at(-1), Date.parse(data.contextUsage.updatedAt));
  state.selectedId = "b";
  ui.renderContextUsage();
  assert.equal(els.contextSummary.textContent, "contextLabel —");
  assert.match(els.contextPanel.innerHTML, /contextUnavailable/);
  assert.doesNotMatch(els.contextPanel.innerHTML, /100,000/);
  ui.closeContextPanel();
  assert.equal(els.contextPanel.hidden, true);
  assert.equal(els.contextSummary.attributes["aria-expanded"], "false");
});
