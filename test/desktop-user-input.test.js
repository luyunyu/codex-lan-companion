import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopUserInput } from "../lib/desktop-user-input.js";
import { composerMarkdown, referenceMarkdown, referencesFromMarkdown } from "../public/mention-format.js";
import { renderMarkdown } from "../public/message-format.js";

const skill = { type: "skill", name: "sample", path: "/test/skills/sample/SKILL.md", label: "$sample" };
const plugin = { type: "mention", name: "Demo Plugin", path: "plugin://demo@local", label: "@Demo Plugin" };

test("inline positions survive serialization and Desktop receives native skill and plugin items", () => {
  const plain = "请用 $sample 和 @Demo Plugin 检查";
  const mentions = [
    { ...skill, start: plain.indexOf(skill.label), end: plain.indexOf(skill.label) + skill.label.length },
    { ...plugin, start: plain.indexOf(plugin.label), end: plain.indexOf(plugin.label) + plugin.label.length }
  ];
  const text = composerMarkdown(plain, mentions);
  assert.equal(text, `请用 ${referenceMarkdown(skill)} 和 ${referenceMarkdown(plugin)} 检查`);
  const input = desktopUserInput(text, [{ mimeType: "image/png", data: "fixture" }]);
  assert.deepEqual(input, [
    { type: "text", text, text_elements: [] },
    { type: "skill", name: skill.name, path: skill.path },
    { type: "mention", name: plugin.name, path: plugin.path },
    { type: "image", url: "data:image/png;base64,fixture" }
  ]);
  assert.equal(text.includes("Use the following skills"), false);
});

test("same-name skills retain exact paths, including spaces, quotes, parentheses and unicode", () => {
  const paths = ['/project with spaces/quote"/中文(1)/SKILL.md', "/other/sample/SKILL.md", "/percent%20/sample/SKILL.md"];
  const text = paths.map((path) => referenceMarkdown({ ...skill, path })).join(" ");
  assert.deepEqual(referencesFromMarkdown(text).map((reference) => reference.path), paths);
  assert.equal(desktopUserInput(`${text} ${referenceMarkdown(skill)} ${referenceMarkdown(skill)}`).filter((item) => item.type === "skill").length, 4);
});

test("code examples, unsafe or unrelated links never become native references", () => {
  const link = referenceMarkdown(skill);
  assert.deepEqual(referencesFromMarkdown(`\`${link}\`\n\n\`\`\`\n${link}\n\`\`\`\n[$bad](javascript:alert)\n[$bad](/test/readme.md)\n[other](/test/SKILL.md)`), []);
});

test("sent skill and plugin links render exactly the same visible labels, without exposing paths", () => {
  const labels = [];
  const render = (label) => { labels.push(label); return `<span>${label}</span>`; };
  const html = renderMarkdown(`${referenceMarkdown(skill)} ${referenceMarkdown(plugin)}`, { renderSkill: render, renderPlugin: render });
  assert.deepEqual(labels, [skill.label, plugin.label]);
  assert.equal(html.includes(skill.path), false);
  assert.equal(html.includes("plugin://"), false);
  assert.match(renderMarkdown(`\`${referenceMarkdown(skill)}\``, { renderSkill: () => { throw new Error("must stay code"); } }), /<code>/);
});
