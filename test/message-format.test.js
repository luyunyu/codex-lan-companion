import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { isVisibleMessage, renderMarkdown, assistantMessageStyle } from "../public/message-format.js";
import { stripInjectedUserContext } from "../lib/user-message-content.js";

test("Markdown renders headings, nested lists, quotes, tables and inline formatting", () => {
  const html = renderMarkdown("# Heading\n\n**bold** *italic* ~~removed~~ `inline`\n\n- outer\n  - inner\n\n1. first\n2. second\n\n> quoted\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n- [x] done\n\n---");
  for (const tag of ["h1", "strong", "em", "del", "code", "ul", "ol", "blockquote", "table", "th", "td", "hr"]) {
    assert.match(html, new RegExp(`<${tag}[ >]`));
  }
  assert.equal((html.match(/<ul>/g) || []).length, 3);
  assert.match(html, /class="markdown-table"/);
  assert.match(html, /type="checkbox"/);
});

test("code stays literal, including Markdown, plugin mentions and image references", () => {
  const html = renderMarkdown('```js\nconst x = "<script>";\n**literal**\n[@Example](plugin://example)\n![x](/Users/test/.codex/generated_images/a.png)\n```', {
    renderPlugin: () => { throw new Error("plugin rendered inside code"); },
    renderLocalImage: () => { throw new Error("image rendered inside code"); }
  });
  assert.match(html, /class="language-js"/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /\*\*literal\*\*/);
  assert.doesNotMatch(html, /<strong>|<img/);
  assert.match(renderMarkdown("```js\nunfinished"), /<pre><code/);
});

test("raw HTML and unsafe links cannot become executable markup", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert%281%29) [x](data:text/html,evil) [x](vbscript:evil) [x](jav&#x61;script:evil)\n\n[x](https://example.com/ "\\\" onmouseover=evil")');
  assert.doesNotMatch(html, /<script|<img|href="(?:javascript|data|vbscript):|" onmouseover=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(renderMarkdown("[site](https://example.com) [mail](mailto:test@example.com)"), /href="mailto:test@example.com"/);
  assert.doesNotMatch(renderMarkdown("![remote](https://example.com/tracker.png)"), /<img/);
});

test("plugin mentions and authenticated generated images use explicit renderers", () => {
  const html = renderMarkdown('[@Example](plugin://example)\n\n![preview](/Users/test/.codex/generated_images/a.png)', {
    renderPlugin: (label, uri) => { assert.equal(label, "@Example"); assert.equal(uri, "plugin://example"); return "<span>Plugin</span>"; },
    renderLocalImage: (alt, path) => { assert.equal(alt, "preview"); assert.equal(path, "/Users/test/.codex/generated_images/a.png"); return '<img src="/api/local-image?fixture">'; }
  });
  assert.match(html, /<span>Plugin<\/span>/);
  assert.match(html, /src="\/api\/local-image/);
});

test("only conversation roles, approvals and notices are visible", () => {
  for (const role of ["system", "developer", "deployer", "tool", "unknown", "", undefined]) assert.equal(isVisibleMessage({ role }), false);
  for (const role of ["user", "assistant", "interaction", "notice"]) assert.equal(isVisibleMessage({ role }), true);
});

test("assistant phases distinguish summaries, progress and final answers", () => {
  assert.equal(assistantMessageStyle({ role: "assistant", kind: "reasoning" }), "reasoning");
  assert.equal(assistantMessageStyle({ role: "assistant", phase: "analysis" }), "reasoning");
  assert.equal(assistantMessageStyle({ role: "assistant", phase: "commentary" }), "progress");
  assert.equal(assistantMessageStyle({ role: "assistant", phase: "final_answer" }), "answer");
  assert.equal(assistantMessageStyle({ role: "assistant" }), "answer");
  assert.equal(assistantMessageStyle({ role: "user" }), "");
});

test("response parsing drops internal roles before reading their contents", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const parse = vm.runInNewContext(`${source.slice(source.indexOf("function messageFromResponseItem("), source.indexOf("\nfunction hasDisplayableMessageContent("))}\nmessageFromResponseItem`, {
    textFromContent: (content) => content,
    stripCodexDirectives: (text) => text,
    stripInjectedUserContext,
    imagesFromContent: () => []
  });
  for (const role of ["system", "developer", "deployer", "unknown", undefined]) {
    assert.equal(parse(null, { type: "message", role, get content() { throw new Error("internal content read"); } }), null);
  }
  assert.equal(parse(null, { type: "message", role: "assistant", content: "reply" }).content, "reply");
  assert.equal(parse(null, { type: "message", role: "user", content: "prompt" }).content, "prompt");
});
