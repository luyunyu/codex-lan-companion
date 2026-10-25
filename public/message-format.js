import { Marked, Renderer } from "./vendor/marked.js";
import { referenceFromLink } from "./mention-format.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

export function isVisibleMessage(message) {
  return ["user", "assistant", "interaction", "notice"].includes(message?.role);
}

export function assistantMessageStyle(message) {
  if (message?.role !== "assistant") return "";
  if (message.kind === "reasoning" || message.phase === "analysis") return "reasoning";
  if (message.phase === "commentary") return "progress";
  return "answer";
}

function safeLink(href) {
  if (/^#[^\s]*$/.test(href)) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

// Raw HTML stays text; only our renderers can emit links or images.
export function renderMarkdown(text, { renderPlugin, renderSkill, renderLocalImage } = {}) {
  const markdown = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, title, tokens, text }) {
        if (/^plugin:\/\/[^\s]+$/.test(href) && renderPlugin) return renderPlugin(text, href);
        const reference = referenceFromLink(text, href);
        if (reference?.type === "skill" && renderSkill) return renderSkill(reference.label, reference.path);
        const label = this.parser.parseInline(tokens);
        const url = safeLink(href);
        if (!url) return label;
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ""}>${label}</a>`;
      },
      image({ href, text }) {
        // Serve generated images through the authenticated endpoint. No remote tracking images.
        if (/^\/[^\r\n]*\/generated_images\/[^\r\n]+\.(?:png|jpe?g|webp|svg)$/i.test(href) && renderLocalImage) {
          return renderLocalImage(text, href);
        }
        return escapeHtml(text);
      },
      table(token) {
        return `<div class="markdown-table">${Renderer.prototype.table.call(this, token)}</div>`;
      }
    }
  });
  return markdown.parse(String(text ?? ""));
}
