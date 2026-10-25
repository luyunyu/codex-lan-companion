import { composerMarkdown } from "./mention-format.js";

// Keep the textarea-like API used by the page; reference nodes are atomic text.
export function installInlineComposer(input) {
  const document = input.ownerDocument;
  const window = document.defaultView;
  const placeholder = document.querySelector("#composerPlaceholder");
  let savedSelection = [0, 0];
  let composing = false;
  let undoStack = [];
  let redoStack = [];
  let baseline = null;
  let restoringHistory = false;
  const mentionData = new WeakMap();
  const parts = () => {
    const result = [];
    let offset = 0;
    const visit = (node) => {
      if (node.nodeType === 3) {
        result.push({ node, start: offset, end: offset + node.length });
        offset += node.length;
      } else if (mentionData.has(node)) {
        const mention = mentionData.get(node);
        result.push({ node, start: offset, end: offset + node.textContent.length, mention });
        offset += node.textContent.length;
      } else {
        for (const child of node.childNodes) visit(child);
      }
    };
    visit(input);
    return result;
  };
  const text = () => input.textContent || "";
  const ensureTail = () => {
    if (input.lastChild?.nodeName === "BR") return;
    const tail = document.createElement("br");
    tail.dataset.composerTail = "true";
    input.append(tail);
  };
  const selection = () => {
    const selected = window.getSelection();
    if (!selected?.rangeCount) return savedSelection;
    const range = selected.getRangeAt(0);
    if (!input.contains(range.startContainer) || !input.contains(range.endContainer)) return savedSelection;
    const prefix = document.createRange();
    prefix.selectNodeContents(input);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    prefix.setEnd(range.endContainer, range.endOffset);
    savedSelection = [start, prefix.toString().length];
    return savedSelection;
  };
  const point = (offset, end = false) => {
    for (const part of parts()) {
      if (offset > part.end) continue;
      if (!part.mention) return [part.node, Math.max(0, offset - part.start)];
      const index = Array.prototype.indexOf.call(part.node.parentNode.childNodes, part.node);
      return [part.node.parentNode, index + Number(offset > part.start && (end || offset >= part.end))];
    }
    return [input, input.childNodes.length];
  };
  const setSelection = (start, end = start) => {
    const length = text().length;
    start = Math.max(0, Math.min(start, length));
    end = Math.max(start, Math.min(end, length));
    const range = document.createRange();
    range.setStart(...point(start));
    range.setEnd(...point(end, true));
    const selected = window.getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
    savedSelection = [start, end];
  };
  const mentionNode = (mention) => {
    const span = document.createElement("span");
    span.className = "composer-reference";
    span.contentEditable = "false";
    span.textContent = mention.label;
    span.title = mention.path;
    mentionData.set(span, { type: mention.type, name: mention.name, path: mention.path, label: mention.label });
    return span;
  };
  const changed = () => {
    input.dataset.empty = String(!text());
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const replace = (start, end, nodes) => {
    if (baseline) baseline.selection = [...selection()];
    input.focus();
    setSelection(start, end);
    const range = window.getSelection().getRangeAt(0);
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    let length = 0;
    for (const node of nodes) {
      length += node.textContent.length;
      fragment.append(node);
    }
    range.insertNode(fragment);
    input.normalize();
    ensureTail();
    setSelection(start + length);
    changed();
  };
  input.getMentions = () => parts().filter((part) => part.mention).map((part) => ({ ...part.mention, start: part.start, end: part.end }));
  input.snapshot = () => ({ text: text(), mentions: input.getMentions() });
  input.markdown = () => composerMarkdown(text(), input.getMentions());
  input.restore = (snapshot) => {
    input.replaceChildren();
    let offset = 0;
    for (const mention of snapshot.mentions || []) {
      input.append(document.createTextNode(snapshot.text.slice(offset, mention.start)), mentionNode(mention));
      offset = mention.end;
    }
    input.append(document.createTextNode(snapshot.text.slice(offset)));
    ensureTail();
    savedSelection = [snapshot.text.length, snapshot.text.length];
    input.dataset.empty = String(!snapshot.text);
    baseline = { ...input.snapshot(), selection: [...savedSelection] };
    if (!restoringHistory) {
      undoStack = [];
      redoStack = [];
    }
  };
  input.insertMention = (mention, start = selection()[0], end = selection()[1]) => {
    const before = text().slice(0, start);
    const after = text().slice(end);
    const nodes = [];
    if (before && !/\s$/.test(before)) nodes.push(document.createTextNode(" "));
    nodes.push(mentionNode(mention));
    if (!/^\s/.test(after)) nodes.push(document.createTextNode(" "));
    replace(start, end, nodes);
  };
  input.insertText = (value, start = selection()[0], end = selection()[1]) => {
    const before = text().slice(0, start);
    const after = text().slice(end);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = /^\s/.test(after) ? "" : " ";
    replace(start, end, [document.createTextNode(prefix + value + suffix)]);
  };
  Object.defineProperties(input, {
    value: {
      get: text,
      set: (value) => input.restore({ text: String(value || ""), mentions: [] })
    },
    selectionStart: { get: () => selection()[0] },
    selectionEnd: { get: () => selection()[1] },
    disabled: {
      get: () => input.getAttribute("aria-disabled") === "true",
      set: (value) => {
        input.contentEditable = String(!value);
        input.setAttribute("aria-disabled", String(Boolean(value)));
        input.tabIndex = value ? -1 : 0;
      }
    },
    placeholder: {
      get: () => input.dataset.placeholder || "",
      set: (value) => {
        input.dataset.placeholder = value;
        input.setAttribute("aria-label", value);
        if (placeholder) placeholder.textContent = value;
      }
    }
  });
  input.setSelectionRange = setSelection;
  const commitHistory = () => {
    if (composing) return;
    const current = input.snapshot();
    if (baseline && JSON.stringify(current) !== JSON.stringify({ text: baseline.text, mentions: baseline.mentions })) {
      undoStack.push(baseline);
      if (undoStack.length > 100) undoStack.shift();
      redoStack = [];
    }
    baseline = { ...current, selection: [...selection()] };
  };
  const applyHistory = (undo) => {
    const from = undo ? undoStack : redoStack;
    const to = undo ? redoStack : undoStack;
    const previous = from.pop();
    if (!previous) return;
    to.push({ ...input.snapshot(), selection: [...selection()] });
    restoringHistory = true;
    input.restore(previous);
    setSelection(...previous.selection);
    restoringHistory = false;
    changed();
  };
  document.addEventListener("selectionchange", selection);
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; input.dataset.empty = String(!text()); commitHistory(); });
  input.addEventListener("input", () => { ensureTail(); input.dataset.empty = String(!text()); commitHistory(); });
  input.addEventListener("beforeinput", (event) => {
    if (input.disabled || composing || event.isComposing) return;
    if (baseline) baseline.selection = [...selection()];
    if (["historyUndo", "historyRedo"].includes(event.inputType)) {
      event.preventDefault();
      applyHistory(event.inputType === "historyUndo");
      return;
    }
    if (["insertParagraph", "insertLineBreak"].includes(event.inputType)) {
      event.preventDefault();
      replace(...selection(), [document.createTextNode("\n")]);
    }
  });
  input.addEventListener("keydown", (event) => {
    if (input.disabled || event.isComposing || composing) return;
    if ((event.metaKey || event.ctrlKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      applyHistory(event.key.toLowerCase() === "z" && !event.shiftKey);
      return;
    }
    if (!["Backspace", "Delete"].includes(event.key)) return;
    const [start, end] = selection();
    if (start !== end) return;
    const part = parts().find((part) => part.mention && (event.key === "Backspace" ? part.end === start : part.start === start));
    if (!part) return;
    event.preventDefault();
    replace(part.start, part.end, []);
  });
  input.addEventListener("paste", (event) => {
    event.preventDefault();
    if (input.disabled) return;
    const plain = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    replace(...selection(), [document.createTextNode(plain)]);
  });
  // Dropped HTML must never create executable or counterfeit reference nodes.
  input.addEventListener("drop", (event) => { event.preventDefault(); });
  input.value = "";
  return input;
}
