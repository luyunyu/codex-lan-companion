import assert from "node:assert/strict";
import { test } from "node:test";
import { installFilePicker } from "../public/file-picker.js";

// Minimal DOM for picker event/state tests; native gestures need a browser.
function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  class Element {
    constructor(tag = "div") {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.className = "";
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.scrollLeft = this.scrollTop = 0;
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    emit(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => {
        const matches = selector === "button" ? child.tag === "button" : child.className.split(" ").includes(selector.slice(1));
        return [...(matches ? [child] : []), ...child.querySelectorAll(selector)];
      });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    focus() {}
  }
  const document = new Element();
  document.createElement = (tag) => new Element(tag);
  const button = new Element("button");
  button.ownerDocument = document;
  const label = new Element();
  label.className = "plugin-picker-label";
  button.append(label);
  const panel = new Element();
  const inserted = [];
  const input = { selectionStart: 2, selectionEnd: 4, disabled: false,
    insertText: (...args) => inserted.push(args) };
  let context = { threadId: "fixture" };
  const requests = [];
  const picker = installFilePicker({ button, panel, input, getContext: () => context,
    onOpen() {}, t: (key) => key, fetchJson: async (url) => {
      requests.push(url);
      return { roots: ["/repo"], root: 0, directory: "", absolutePath: "/repo", entries: [
        { name: "src", path: "src", absolutePath: "/repo/src", directory: true },
        { name: "file.js", path: "file.js", absolutePath: "/repo/file.js", directory: false }
      ] };
    } });
  return { button, panel, document, input, inserted, requests, picker,
    changeContext: () => { context = { threadId: "other" }; },
    async open() { button.emit("click"); await Promise.resolve(); },
    rows: () => panel.querySelectorAll(".file-entry"),
    down(row) { row.emit("pointerdown", { button: 0, isPrimary: true, pointerId: 1, clientX: 20, clientY: 20 }); }
  };
}

test("folder hold inserts at the saved selection once and suppresses navigation", async (t) => {
  const ui = fixture(t);
  await ui.open();
  const folder = ui.rows()[0];
  ui.down(folder);
  t.mock.timers.tick(499);
  assert.deepEqual(ui.inserted, []);
  t.mock.timers.tick(1);
  assert.deepEqual(ui.inserted, [["/repo/src", 2, 4]]);
  assert.equal(ui.panel.hidden, true);
  folder.emit("click");
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.inserted.length, 1);
});

for (const cancel of ["release", "move", "pointercancel", "scroll", "close", "context", "disabled"]) {
  test(`folder hold does not select after ${cancel}`, async (t) => {
    const ui = fixture(t);
    await ui.open();
    ui.down(ui.rows()[0]);
    if (cancel === "release") ui.document.emit("pointerup");
    if (cancel === "move") ui.document.emit("pointermove", { pointerId: 1, clientX: 35, clientY: 20 });
    if (cancel === "pointercancel") ui.document.emit("pointercancel");
    if (cancel === "scroll") ui.panel.emit("scroll");
    if (cancel === "close") ui.picker.close();
    if (cancel === "context") ui.changeContext();
    if (cancel === "disabled") ui.input.disabled = true;
    t.mock.timers.tick(600);
    assert.deepEqual(ui.inserted, []);
  });
}

test("short click still opens folders and regular files still insert paths", async (t) => {
  const ui = fixture(t);
  await ui.open();
  const folder = ui.rows()[0];
  ui.down(folder);
  t.mock.timers.tick(100);
  ui.document.emit("pointerup");
  folder.emit("click");
  await Promise.resolve();
  assert.equal(ui.requests.length, 2);
  assert.match(ui.requests[1], /directory=src/);
  assert.deepEqual(ui.inserted, []);
  ui.rows()[1].emit("click");
  assert.deepEqual(ui.inserted, [["/repo/file.js", 2, 4]]);
});

test("Shift+Enter selects a folder without entering it", async (t) => {
  const ui = fixture(t);
  await ui.open();
  ui.rows()[0].emit("keydown", { key: "Enter", shiftKey: true, preventDefault() {} });
  assert.deepEqual(ui.inserted, [["/repo/src", 2, 4]]);
  assert.equal(ui.requests.length, 1);
});
