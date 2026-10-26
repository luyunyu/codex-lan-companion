const REPLY_OPEN = "<send_user_message_question_reply>";
const REPLY_CLOSE = "</send_user_message_question_reply>";

function object(value) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function userInputRequest(payload) {
  const name = String(payload?.name || payload?.method || payload?.type || "");
  const async = /(?:^|[./])request_user_input_async$/.test(name);
  const blocking = /(?:^|[./])request_user_input$/.test(name) || name === "item/tool/requestUserInput";
  const agentQuestions = ["agentMessage", "agent_message"].includes(payload?.type) && Array.isArray(payload.questions);
  if (!async && !blocking && !agentQuestions) return null;
  const params = object(payload.arguments || payload.params || payload);
  // Desktop converts async function calls to agentMessage items keyed by call_id.
  const sourceId = (async ? payload.call_id ?? payload.callId : null) ?? payload.id ?? payload.call_id ?? payload.requestId ?? payload.request_id ?? params.itemId;
  if (sourceId == null || !Array.isArray(params.questions) || !params.questions.length) return null;
  const mode = async || agentQuestions ? "async" : "blocking";
  const questions = params.questions.map((question, index) => {
    const title = question?.question || question?.title;
    if (typeof title !== "string" || !title.trim()) return null;
    const id = mode === "async" ? JSON.stringify(["request_user_input_async", String(sourceId), index]) : question.id;
    if (typeof id !== "string" || !id) return null;
    const options = (Array.isArray(question.options) ? question.options : []).map((option) => {
      const label = typeof option === "string" ? option : option?.label;
      return typeof label === "string" && label.trim()
        ? { label, description: typeof option?.description === "string" ? option.description : "" } : null;
    }).filter(Boolean);
    return { id, title, header: typeof question.header === "string" ? question.header : "", options, isSecret: question.isSecret === true };
  });
  if (questions.some((question) => !question)) return null;
  return { mode, questions, sourceId: String(sourceId), callId: payload.call_id || payload.callId || "",
    ...(mode === "async" && payload.id != null && String(payload.id) !== String(sourceId) ? { legacySourceId: String(payload.id) } : {}) };
}

export function userInputAnswered(request, answers) {
  return request.questions.every((question, index) => answers.has(question.id)
    || (request.legacySourceId && answers.has(JSON.stringify(["request_user_input_async", request.legacySourceId, index]))));
}

export function validateUserInputAnswers(request, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)
    || Object.keys(answers).length !== request.questions.length) {
    throw Object.assign(new Error("Answer every question in the current request."), { status: 400 });
  }
  return Object.fromEntries(request.questions.map((question) => {
    const answer = answers[question.id];
    if (typeof answer !== "string" || !answer.trim() || answer.length > 12000) {
      throw Object.assign(new Error("Each answer must contain 1–12000 characters."), { status: 400 });
    }
    return [question.id, answer.trim()];
  }));
}

export function userInputReplyText(request, answers) {
  return `${REPLY_OPEN}\n${JSON.stringify(request.questions.map((question) => ({
    questionItemId: question.id, question: question.title, answer: answers[question.id]
  })))}\n${REPLY_CLOSE}`;
}

export function answeredUserInputIds(text) {
  if (typeof text !== "string") return [];
  const start = text.indexOf(REPLY_OPEN);
  const end = text.lastIndexOf(REPLY_CLOSE);
  if (start < 0 || end < start) return [];
  try {
    const value = JSON.parse(text.slice(start + REPLY_OPEN.length, end));
    return (Array.isArray(value) ? value : [value]).filter((item) => typeof item?.answer === "string")
      .map((item) => item.questionItemId).filter((id) => typeof id === "string");
  } catch { return []; }
}

function applyStatePatch(value, patch, depth = 0) {
  if (!Array.isArray(patch.path) || patch.path.length > 32 || !["add", "replace", "remove"].includes(patch.op)) throw new Error("Unsupported Desktop patch");
  if (depth === patch.path.length) return patch.op === "remove" ? null : patch.value;
  const key = patch.path[depth];
  if (!value || typeof value !== "object" || ["__proto__", "prototype", "constructor"].includes(String(key))) throw new Error("Invalid Desktop patch path");
  const copy = Array.isArray(value) ? value.slice() : { ...value };
  if (Array.isArray(copy) && (!Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) > copy.length)) throw new Error("Invalid Desktop array index");
  if (depth === patch.path.length - 1) {
    if (patch.op !== "add" && !Object.hasOwn(value, key)) throw new Error("Missing Desktop patch target");
    if (Array.isArray(copy) && patch.op !== "replace") copy.splice(Number(key), patch.op === "remove" ? 1 : 0, ...(patch.op === "add" ? [patch.value] : []));
    else if (patch.op === "remove") delete copy[key];
    else copy[key] = patch.value;
  } else {
    if (!Object.hasOwn(value, key)) throw new Error("Missing Desktop patch parent");
    copy[key] = applyStatePatch(value[key], patch, depth + 1);
  }
  return copy;
}

// Rebuild the latest available snapshot without mutating the IPC event ring.
// Patches with missing revisions cannot prove that a historical request is live.
export function desktopUserInputState(events) {
  let state = null;
  let revision = null;
  for (const event of events) {
    const root = event.message || event;
    const change = root.params?.change || root.change;
    const snapshot = change?.type === "snapshot" ? change.conversationState : root.params?.conversationState || root.conversationState;
    if (snapshot) {
      state = snapshot;
      revision = change?.revision ?? null;
    } else if (change?.type === "patches") {
      if (!state || (change.baseRevision != null && change.baseRevision !== revision)) {
        state = null;
        revision = null;
        continue;
      }
      try {
        if (!Array.isArray(change.patches)) throw new Error("Invalid Desktop patches");
        for (const patch of change.patches) state = applyStatePatch(state, patch);
        revision = change.revision ?? null;
      } catch {
        state = null;
        revision = null;
      }
    } else if (state && root.method === "item/tool/requestUserInput" && root.id != null) {
      state = { ...state, requests: [...(state.requests || []).filter((item) => String(item.id) !== String(root.id)), root] };
    }
  }
  return state;
}

function desktopTurns(state) {
  const history = state?.turnHistory?.kind === "canonical" ? state.turnHistory.history : null;
  const turns = history ? (history.islands || []).flatMap((island) => (island.entries || []).map((entry) => history.entitiesByKey?.[entry.value])).filter(Boolean) : [];
  for (const turn of state?.turns || []) {
    const index = turns.findIndex((existing) => existing.turnId === turn.turnId);
    if (index >= 0) turns[index] = turn;
    else turns.push(turn);
  }
  return turns;
}

export function desktopPendingAsyncInputIds(state) {
  const turn = desktopTurns(state).at(-1);
  if (turn?.status !== "inProgress") return new Set();
  return new Set((turn.items || []).map(userInputRequest).filter((request) => request?.mode === "async").map((request) => request.sourceId));
}

// Inspect only this conversation's events; historical requests remain in snapshots.
export function userInputResolved(request, requestId, events, snapshot = desktopUserInputState(events)) {
  const answers = new Set();
  let resolvedBySnapshot = false;
  for (const event of events) {
    const root = event.message || event;
    const snapshot = root.params?.conversationState || root.conversationState;
    if (request.mode === "blocking" && Array.isArray(snapshot?.requests)) {
      resolvedBySnapshot = !snapshot.requests.some((item) => String(item.id) === String(requestId) && item.completed !== true);
    }
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 12) return false;
      if (value.method === "item/tool/requestUserInput" && value.completed !== true && String(value.id ?? value.requestId) === String(requestId)) resolvedBySnapshot = false;
      if (String(value.method || "").includes("serverRequest/resolved") && String(value.params?.requestId) === String(requestId)) return true;
      if (value.completed === true && String(value.id ?? value.requestId) === String(requestId)) return true;
      if (["function_call_output", "functionCallOutput"].includes(value.type) && request.mode === "blocking" && (value.call_id || value.callId) === request.callId) return true;
      if (value.type === "userMessage" || (value.type === "steeringUserMessage" && value.status === "accepted")) {
        const parts = value.content || value.input || [];
        const text = Array.isArray(parts) ? parts.map((part) => part.text || "").join("\n") : "";
        for (const id of answeredUserInputIds(text)) answers.add(id);
      }
      for (const child of Object.values(value)) if (visit(child, depth + 1)) return true;
      return false;
    };
    if (visit(root)) return true;
  }
  if (snapshot) {
    if (request.mode === "blocking" && Array.isArray(snapshot.requests)) {
      resolvedBySnapshot = !snapshot.requests.some((item) => String(item.id) === String(requestId) && item.completed !== true);
    }
    const turns = desktopTurns(snapshot);
    const latest = turns.at(-1);
    if (request.mode === "async" && latest) {
      const sources = new Set([request.sourceId, request.legacySourceId].filter(Boolean));
      const owner = turns.findLast((turn) => (turn.items || []).some((item) => sources.has(String(item.id))));
      if (owner && (owner !== latest || (latest.status && latest.status !== "inProgress"))) return true;
    }
    visitSnapshot(snapshot, answers);
  }
  return resolvedBySnapshot || (request.mode === "async" && userInputAnswered(request, answers));

  function visitSnapshot(value, answerIds, depth = 0) {
    if (!value || typeof value !== "object" || depth > 16) return false;
    if ((value.type === "userMessage" || (value.type === "steeringUserMessage" && value.status === "accepted")) && Array.isArray(value.content || value.input)) {
      for (const id of answeredUserInputIds((value.content || value.input).map((part) => part.text || "").join("\n"))) answerIds.add(id);
    }
    for (const child of Object.values(value)) visitSnapshot(child, answerIds, depth + 1);
    return false;
  }
}
