// Codex stores repository and UI context as user-role messages in some rollouts.
// Match injected envelopes at the beginning, rather than mentions in real prompts.
export function stripInjectedUserContext(value) {
  let text = String(value || "");
  const agents = /^\s*# AGENTS\.md instructions for [^\r\n]+\r?\n\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/;
  const environment = /^\s*<environment_context>[\s\S]*?<\/environment_context>\s*/;
  const skill = /^\s*<skill>\s*<name>[^<>\r\n]+<\/name>\s*<path>[^<>\r\n]+[/\\]SKILL\.md<\/path>[\s\S]*?<\/skill>\s*/;
  const openPage = /^\s*<external_codex_apps_open_page>([\s\S]*?)<\/external_codex_apps_open_page>\s*/;
  while (true) {
    const remaining = text.replace(agents, "").replace(environment, "").replace(skill, "").replace(openPage, (match, body) => {
      try {
        const context = JSON.parse(body);
        return context && Object.hasOwn(context, "page_id") && (context.page_id === null || typeof context.page_id === "string") ? "" : match;
      } catch {
        return match;
      }
    });
    if (remaining === text) return text;
    text = remaining;
  }
}
