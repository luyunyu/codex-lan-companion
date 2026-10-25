import { Marked } from "./vendor/marked.js";

export function referenceFromLink(label, href) {
  let path;
  try {
    path = decodeURI(href);
  } catch {
    return null;
  }
  if (/[\r\n\0]/.test(path)) return null;
  if (label.startsWith("$") && /^(?:\/|[A-Za-z]:[\\/]).*[\\/]SKILL\.md$/i.test(path)) {
    return { type: "skill", name: label.slice(1), path, label };
  }
  if (label.startsWith("@") && /^plugin:\/\/[^\s<>]+$/.test(path)) {
    return { type: "mention", name: label.slice(1), path, label };
  }
  return null;
}

export function referenceMarkdown(reference) {
  const label = reference.label.replace(/[\\[\]]/g, "\\$&");
  const path = encodeURI(reference.path).replace(/[()<>"']/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${label}](${path})`;
}

// Walk Markdown tokens so links in code blocks and inline code cannot activate skills.
export function referencesFromMarkdown(text) {
  const references = [];
  const seen = new Set();
  const parser = new Marked();
  parser.walkTokens(parser.lexer(String(text || "")), (token) => {
    if (token.type !== "link") return;
    const reference = referenceFromLink(token.text, token.href);
    if (!reference || !reference.name) return;
    const key = `${reference.type}:${reference.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ type: reference.type, name: reference.name, path: reference.path });
  });
  return references;
}

export function composerMarkdown(text, mentions = []) {
  let result = "";
  let offset = 0;
  for (const mention of mentions) {
    result += text.slice(offset, mention.start) + referenceMarkdown(mention);
    offset = mention.end;
  }
  return result + text.slice(offset);
}
