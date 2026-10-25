import { stat } from "node:fs/promises";
import { readRolloutWindow } from "./rollout-history.js";
import { AppServerThreadClient } from "./app-server-thread.js";

// Discover capabilities without starting or resuming a conversation.
export async function readModelCatalog(options, { Client = AppServerThreadClient } = {}) {
  const client = new Client({ ...options, timeoutMs: 15000 });
  try {
    await client.initialize();
    const models = [];
    let cursor = null;
    const seen = new Set();
    do {
      const result = await client.request("model/list", { cursor, limit: 100 });
      if (!Array.isArray(result?.data)) throw new Error("Codex returned an invalid model catalog.");
      for (const model of result.data) {
        if (model.hidden || typeof model.model !== "string") continue;
        models.push({ model: model.model, displayName: model.displayName || model.model,
          isDefault: Boolean(model.isDefault), defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: (model.supportedReasoningEfforts || [])
            .filter((entry) => typeof entry.reasoningEffort === "string")
            .map((entry) => entry.reasoningEffort) });
      }
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Codex repeated a model catalog cursor.");
      seen.add(cursor);
    } while (cursor);
    return models;
  } finally {
    await client.close();
  }
}

export function validateModelSettings({ model, effort } = {}, models) {
  if (model == null && effort == null) return {};
  const selected = models.find((entry) => entry.model === model);
  if (!selected || (effort != null && !selected.supportedReasoningEfforts.includes(effort))) {
    throw Object.assign(new Error("The selected model or reasoning effort is unavailable. Refresh the model list before sending."), { status: 400 });
  }
  const resolvedEffort = effort ?? selected.defaultReasoningEffort;
  return { model: selected.model, ...(resolvedEffort != null ? { effort: resolvedEffort } : {}) };
}

// Ignore absent live fields instead of erasing usable rollout metadata. Never
// carry a fallback effort across a model change reported by a newer source.
export function mergeModelSettings(fallback = {}, latest = {}) {
  const nonempty = (value) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const mode = latest.collaborationMode?.settings || latest.collaboration_mode?.settings;
  const model = nonempty(mode?.model) || nonempty(latest.model);
  const effort = nonempty(mode?.reasoning_effort) || nonempty(latest.reasoningEffort)
    || nonempty(latest.effort) || nonempty(latest.reasoning_effort);
  const result = { ...fallback };
  if (model && fallback.model && model !== fallback.model) delete result.effort;
  if (model) result.model = model;
  if (effort) result.effort = effort;
  return result;
}

// Search recent complete records in bounded windows, retaining only metadata.
// A long turn can put its context far behind the last message window.
export async function readRolloutModelSettings(file, { maxScanBytes = 8 * 1024 * 1024 } = {}) {
  if (!file) return {};
  const { size } = await stat(file);
  let before = size;
  while (before > 0 && size - before < maxScanBytes) {
    const { entries, startOffset } = await readRolloutWindow(file, {
      size, before: String(before), maxBytes: Math.min(512 * 1024, maxScanBytes - (size - before)),
      mapLine: (line) => {
        try {
          const entry = JSON.parse(line);
          return entry.type === "turn_context" ? mergeModelSettings({}, entry.payload || {}) : null;
        } catch { return null; }
      }
    });
    if (entries.length) return entries.at(-1).line;
    if (startOffset >= before) break;
    before = startOffset;
  }
  return {};
}
