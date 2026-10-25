import { AppServerThreadClient } from "./app-server-thread.js";
import { referencesFromMarkdown } from "../public/mention-format.js";

// Read metadata only: never start/resume a conversation or submit a model turn.
export async function readNativeSkills({ cli, home, cwd }, { Client = AppServerThreadClient } = {}) {
  const client = new Client({ cli, home, cwd: cwd || home, timeoutMs: 15000 });
  try {
    await client.initialize();
    const result = await client.request("skills/list", { cwds: [cwd || home], forceReload: true });
    if (!Array.isArray(result?.data) || !result.data.length) throw new Error("Codex returned no skill catalog.");
    const entries = result.data.filter((entry) => entry.cwd === (cwd || home));
    if (!entries.length || entries.some((entry) => !Array.isArray(entry.skills))) throw new Error("Codex returned an invalid skill catalog.");
    return entries.flatMap((entry) => entry.skills).filter((skill) => skill.enabled !== false
      && typeof skill.name === "string" && typeof skill.path === "string"
      && (cwd || !["repo", "project"].includes(skill.scope)));
  } finally {
    await client.close();
  }
}

export function assertAvailableSkillReferences(text, skills) {
  const available = new Set(skills.map((skill) => JSON.stringify([skill.name, skill.path])));
  for (const reference of referencesFromMarkdown(text)) {
    if (reference.type !== "skill") continue;
    if (!available.has(JSON.stringify([reference.name, reference.path]))) {
      const error = new Error(`Skill "${reference.name}" is not enabled in Codex for this conversation. Refresh the skill list and select an available skill. No message was sent.`);
      error.status = 409;
      throw error;
    }
  }
}
