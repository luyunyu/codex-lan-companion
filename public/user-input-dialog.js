export function appendQuotedOption(current, option) {
  return current.trim() ? `${current.trimEnd()}\n${option}` : option;
}

// Dialog state stays outside the polled message DOM so edits and focus survive refreshes.
export function installUserInputDialog({ dialog, t, escapeHtml, submit, onSubmitted, onUnauthorized, loadClosed, saveClosed, onClosed }) {
  let context = "";
  let storageContext = "";
  let pending = [];
  let active = null;
  let busy = false;
  let revision = 0;
  const drafts = new Map();
  const dismissed = new Set();
  const submitted = new Set();
  const closed = new Set();
  try {
    const saved = JSON.parse(loadClosed?.() || "[]");
    if (Array.isArray(saved)) for (const id of saved) if (typeof id === "string") closed.add(id);
  } catch {
    // A missing or damaged browser preference must not prevent answering.
  }
  const key = (message) => JSON.stringify([context, String(message.requestId), message.inputRequest?.mode === "blocking" ? message.turnId || "" : ""]);
  const closedKey = (message) => JSON.stringify([storageContext, message.inputRequest?.mode || "",
    message.inputRequest?.sourceId || String(message.requestId), message.inputRequest?.mode === "blocking" ? message.turnId || "" : ""]);
  const close = () => { if (dialog.open) dialog.close(); active = null; };
  const draftFor = (message) => {
    const id = key(message);
    if (!drafts.has(id)) drafts.set(id, message.inputRequest.questions.map(() => ({ selected: "", custom: "" })));
    return drafts.get(id);
  };
  const updateSubmit = () => {
    const button = dialog.querySelector(".user-input-submit");
    if (button && active) button.disabled = busy || draftFor(active).some((draft) => !(draft.selected === "custom" ? draft.custom.trim() : draft.selected));
  };
  function open(message) {
    active = message;
    const drafts = draftFor(message);
    dialog.innerHTML = `<form class="user-input-form">
      <div class="user-input-heading"><strong id="userInputTitle">${escapeHtml(t("inputTitle"))}</strong><div class="user-input-heading-actions"><button type="button" class="user-input-later">${escapeHtml(t("inputLater"))}</button><button type="button" class="user-input-close" title="${escapeHtml(t("inputCloseHint"))}" aria-label="${escapeHtml(t("inputCloseHint"))}">${escapeHtml(t("inputClose"))}</button></div></div>
      ${message.inputRequest.questions.map((question, index) => {
        const draft = drafts[index];
        return `<fieldset data-question-index="${index}"><legend>${escapeHtml(question.header ? `${question.header}: ${question.title}` : question.title)}</legend>
          ${question.options.map((option, optionIndex) => `<div class="user-input-option"><label><input type="radio" name="question-${index}" value="${optionIndex}" ${draft.selected === String(optionIndex) ? "checked" : ""}><span>${escapeHtml(option.label)}${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span></label><button type="button" class="user-input-quote" data-option-index="${optionIndex}" title="${escapeHtml(t("inputQuoteHint"))}">${escapeHtml(t("inputQuote"))}</button></div>`).join("")}
          <label class="user-input-custom"><span><input type="radio" name="question-${index}" value="custom" ${draft.selected === "custom" ? "checked" : ""}>${escapeHtml(t("inputCustom"))}</span><textarea rows="3" maxlength="12000" ${question.isSecret ? 'class="secret-answer"' : ""} placeholder="${escapeHtml(t("inputCustomHint"))}" aria-label="${escapeHtml(t("inputCustom"))}">${escapeHtml(draft.custom)}</textarea></label>
        </fieldset>`;
      }).join("")}
      <p class="user-input-error" role="alert"></p><button type="submit" class="user-input-submit">${escapeHtml(t("inputSubmit"))}</button>
    </form>`;
    updateSubmit();
    if (!dialog.open) dialog.showModal();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (busy) return;
    if (active) dismissed.add(key(active));
    close();
  });
  dialog.addEventListener("click", (event) => {
    if (busy || !active) return;
    if (event.target.closest(".user-input-later")) { dismissed.add(key(active)); close(); return; }
    if (event.target.closest(".user-input-close")) {
      closed.add(closedKey(active));
      drafts.delete(key(active));
      try { saveClosed?.(JSON.stringify([...closed])); } catch { /* Keep the in-memory preference when storage is unavailable. */ }
      close();
      pending = pending.filter((message) => !closed.has(closedKey(message)));
      onClosed?.();
      return;
    }
    const button = event.target.closest(".user-input-quote");
    if (!button) return;
    const field = button.closest("fieldset");
    const index = Number(field.dataset.questionIndex);
    const option = active.inputRequest.questions[index].options[Number(button.dataset.optionIndex)];
    const draft = draftFor(active)[index];
    draft.custom = appendQuotedOption(draft.custom, option.label);
    draft.selected = "custom";
    field.querySelector('input[value="custom"]').checked = true;
    const input = field.querySelector("textarea");
    input.value = draft.custom;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    updateSubmit();
  });
  function remember(event) {
    const field = event.target.closest("fieldset");
    if (!active || !field || busy) return;
    const draft = draftFor(active)[Number(field.dataset.questionIndex)];
    if (event.target.matches("textarea")) {
      draft.custom = event.target.value;
      draft.selected = "custom";
      field.querySelector('input[value="custom"]').checked = true;
    } else if (event.target.matches('input[type="radio"]')) draft.selected = event.target.value;
    updateSubmit();
  }
  dialog.addEventListener("input", remember);
  dialog.addEventListener("change", remember);
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !active) return;
    const message = active;
    const id = key(message);
    const answers = Object.fromEntries(message.inputRequest.questions.map((question, index) => {
      const draft = draftFor(message)[index];
      return [question.id, draft.selected === "custom" ? draft.custom.trim() : draft.selected !== "" ? question.options[Number(draft.selected)]?.label || "" : ""];
    }));
    if (Object.values(answers).some((answer) => !answer)) return;
    const token = revision;
    busy = true;
    dialog.querySelectorAll("button, input, textarea").forEach((element) => { element.disabled = true; });
    dialog.querySelector(".user-input-submit").textContent = t("inputSending");
    try {
      await submit({ requestId: String(message.requestId), answers });
      if (token !== revision) return;
      submitted.add(id);
      drafts.delete(id);
      close();
      onSubmitted();
    } catch (error) {
      if (token !== revision) return;
      onUnauthorized(error);
      if (token !== revision) return;
      dialog.querySelectorAll("button, input, textarea").forEach((element) => { element.disabled = false; });
      dialog.querySelector(".user-input-submit").textContent = t("inputSubmit");
      dialog.querySelector(".user-input-error").textContent = t("inputFailed", { message: error.message });
    } finally {
      if (token === revision) { busy = false; updateSubmit(); }
    }
  });
  return {
    sync(nextContext, messages, enabled, nextStorageContext = nextContext) {
      if (context !== nextContext) { revision += 1; busy = false; close(); context = nextContext; }
      storageContext = nextStorageContext;
      pending = enabled ? messages.filter((message) => message.inputRequest && message.canRespond && message.requiresDesktopAction && !submitted.has(key(message)) && !closed.has(closedKey(message))) : [];
      if (active && !pending.some((message) => key(message) === key(active))) {
        revision += 1; busy = false; close();
      }
      if (!active) {
        const next = pending.find((message) => !dismissed.has(key(message)));
        if (next) open(next);
      }
    },
    open(requestId) {
      if (busy) return;
      const message = pending.find((message) => String(message.requestId) === requestId);
      if (message) open(message);
    },
    isClosed(message) { return closed.has(closedKey(message)); },
    reset() { revision += 1; busy = false; close(); context = ""; pending = []; drafts.clear(); dismissed.clear(); submitted.clear(); }
  };
}
