import assert from "node:assert/strict";
import { test } from "node:test";
import { installUserInputDialog } from "../public/user-input-dialog.js";

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const message = { requestId: "request", requiresDesktopAction: true, canRespond: true,
  inputRequest: { questions: [{ id: "scope", title: "Pick <scope>", options: [{ label: "Small", description: "One module" }, { label: "Large", description: "" }] }, { id: "detail", title: "Add details", options: [] }] } };

// Model just the dialog's events/controls. Native focus, viewport and rendering need a browser.
function fixture(submit = async () => {}, preferences = {}) {
  const listeners = {};
  let submitted = 0;
  let resetCount = 0;
  const button = { disabled: false, textContent: "" };
  const error = { textContent: "" };
  const fields = message.inputRequest.questions.map((question, index) => {
    const custom = { checked: false, disabled: false };
    const field = { dataset: { questionIndex: String(index) }, querySelector: (selector) => selector === "textarea" ? textarea : custom };
    const textarea = { value: "", disabled: false, focused: false, focus() { this.focused = true; }, setSelectionRange() {},
      closest: () => field, matches: (selector) => selector === "textarea" };
    const radio = (value) => ({ value, closest: () => field, matches: (selector) => selector === 'input[type="radio"]' });
    return { field, textarea, custom, radio };
  });
  const dialog = {
    open: false, html: "", renders: 0,
    set innerHTML(value) { this.html = value; this.renders++; }, get innerHTML() { return this.html; },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    querySelector: (selector) => selector === ".user-input-submit" ? button : error,
    querySelectorAll: () => [button, ...fields.flatMap(({ textarea, custom }) => [textarea, custom])],
    showModal() { this.open = true; }, close() { this.open = false; }
  };
  const controller = installUserInputDialog({ dialog, t: (key, values = {}) => key + (values.message || ""), escapeHtml, submit,
    onSubmitted: () => { submitted++; }, onUnauthorized: () => { resetCount++; }, ...preferences });
  const event = (target) => ({ target, preventDefault() {} });
  return { dialog, fields, button, error, controller, listeners, event,
    submitted: () => submitted, resetCount: () => resetCount,
    quote: (index, optionIndex) => listeners.click(event({ closest: (selector) => selector === ".user-input-quote" ? {
      dataset: { optionIndex: String(optionIndex) }, closest: () => fields[index].field
    } : null })),
    type: (index, text) => { fields[index].textarea.value = text; listeners.input(event(fields[index].textarea)); },
    choose: (index, value) => listeners.change(event(fields[index].radio(value))),
    clickAction: (action) => listeners.click(event({ closest: (selector) => selector === `.user-input-${action}` ? {} : null }))
  };
}

test("dialog escapes questions, preserves edits/focus across polls, quotes options and submits all answers", async () => {
  let body;
  const ui = fixture(async (value) => { body = value; });
  ui.controller.sync("account:thread", [message], true);
  assert.equal(ui.dialog.open, true);
  assert.match(ui.dialog.html, /Pick &lt;scope&gt;/);
  assert.equal(ui.button.disabled, true);
  ui.choose(0, "0");
  assert.equal(body, undefined, "choosing a radio never submits");
  ui.type(0, "Existing detail");
  ui.quote(0, 1);
  assert.equal(ui.fields[0].textarea.value, "Existing detail\nLarge");
  assert.equal(ui.fields[0].custom.checked, true);
  assert.equal(ui.fields[0].textarea.focused, true);
  ui.type(1, "Keep old records");
  assert.equal(ui.button.disabled, false);
  const renders = ui.dialog.renders;
  ui.controller.sync("account:thread", [structuredClone(message)], true);
  assert.equal(ui.dialog.renders, renders, "polling does not rebuild or blur the dialog");
  await ui.listeners.submit(ui.event(null));
  assert.deepEqual(body, { requestId: "request", answers: { scope: "Existing detail\nLarge", detail: "Keep old records" } });
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.submitted(), 1);
  ui.controller.sync("account:thread", [message], true);
  assert.equal(ui.dialog.open, false, "a stale poll cannot reopen a submitted answer");
});

test("later retains a draft, read-only closes it, and returning to the request restores it", () => {
  const ui = fixture();
  ui.controller.sync("a:thread", [message], true);
  ui.type(0, "Partial draft");
  ui.listeners.cancel(ui.event(null));
  assert.equal(ui.dialog.open, false);
  ui.controller.sync("a:thread", [message], true);
  assert.equal(ui.dialog.open, false);
  ui.controller.open("request");
  assert.equal(ui.dialog.open, true);
  assert.match(ui.dialog.html, /Partial draft/);
  ui.controller.sync("a:thread", [message], false);
  assert.equal(ui.dialog.open, false);
  ui.controller.open("request");
  assert.equal(ui.dialog.open, false);
  ui.controller.sync("b:other-thread", [], true);
  ui.controller.sync("a:thread", [message], true);
  ui.controller.open("request");
  assert.match(ui.dialog.html, /Partial draft/);
  ui.controller.reset();
  ui.controller.sync("a:thread", [message], true);
  assert.doesNotMatch(ui.dialog.html, /Partial draft/);
});

test("failures retain editable answers for retry and late success cannot close another conversation's dialog", async () => {
  let resolve;
  let failure = true;
  const ui = fixture(async () => { if (failure) throw new Error("offline"); await new Promise((done) => { resolve = done; }); });
  ui.controller.sync("a:thread", [message], true);
  ui.choose(0, "0");
  ui.type(1, "Detail");
  await ui.listeners.submit(ui.event(null));
  assert.equal(ui.dialog.open, true);
  assert.match(ui.error.textContent, /offline/);
  assert.equal(ui.button.disabled, false);
  failure = false;
  const pending = ui.listeners.submit(ui.event(null));
  assert.equal(ui.button.disabled, true);
  ui.listeners.cancel(ui.event(null));
  assert.equal(ui.dialog.open, true, "cannot close during submission");
  ui.controller.sync("b:thread", [{ ...message, requestId: "other" }], true);
  assert.equal(ui.dialog.open, true);
  resolve();
  await pending;
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.submitted(), 0);
  ui.controller.sync("b:thread", [], true);
  assert.equal(ui.dialog.open, false, "expired requests close immediately");
});

test("Close persists the question identity across polls, account resets and page reloads without answering", () => {
  let stored = "";
  let submissions = 0;
  let closed = 0;
  const preferences = { loadClosed: () => stored, saveClosed: (value) => { stored = value; }, onClosed: () => { closed++; } };
  const ui = fixture(async () => { submissions++; }, preferences);
  const asyncMessage = { ...message, inputRequest: { ...message.inputRequest, mode: "async", sourceId: "call-stable" } };
  ui.controller.sync("home-version:thread", [asyncMessage], true, "thread");
  assert.match(ui.dialog.html, /user-input-later[\s\S]*user-input-close/);
  ui.type(0, "Private draft is not saved to the preference");
  ui.clickAction("close");
  assert.equal(ui.dialog.open, false);
  assert.equal(closed, 1);
  assert.equal(submissions, 0);
  assert.doesNotMatch(stored, /Private draft|Pick|Small/);
  assert.equal(ui.controller.isClosed(asyncMessage), true);
  ui.controller.sync("home-version:thread", [asyncMessage], true, "thread");
  ui.controller.open("request");
  assert.equal(ui.dialog.open, false);
  ui.controller.reset();
  ui.controller.sync("new-home-version:thread", [{ ...asyncMessage, requestId: "live-request-id" }], true, "thread");
  assert.equal(ui.dialog.open, false, "raw and live request aliases share the same saved identity");
  const reloaded = fixture(undefined, preferences);
  reloaded.controller.sync("restart:thread", [asyncMessage], true, "thread");
  assert.equal(reloaded.dialog.open, false);
  reloaded.controller.sync("restart:other", [asyncMessage], true, "other-thread");
  assert.equal(reloaded.dialog.open, true, "hiding is scoped to the conversation");
  reloaded.controller.sync("restart:thread", [{ ...asyncMessage, inputRequest: { ...asyncMessage.inputRequest, sourceId: "new-question" } }], true, "thread");
  assert.equal(reloaded.dialog.open, true, "later questions still appear");
});

test("Later remains temporary and a Close preference does not hide a reused blocking ID in a new turn", () => {
  let stored = "";
  const preferences = { loadClosed: () => stored, saveClosed: (value) => { stored = value; } };
  const ui = fixture(undefined, preferences);
  const blocking = { ...message, turnId: "turn-one", inputRequest: { ...message.inputRequest, mode: "blocking", sourceId: "7" } };
  ui.controller.sync("thread", [blocking], true);
  ui.clickAction("later");
  assert.equal(stored, "");
  ui.controller.open("request");
  assert.equal(ui.dialog.open, true);
  ui.clickAction("close");
  ui.controller.sync("thread", [{ ...blocking, turnId: "turn-two" }], true);
  assert.equal(ui.dialog.open, true);
});
