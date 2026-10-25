import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { stripInjectedUserContext } from "../lib/user-message-content.js";

const agents = "# AGENTS.md instructions for /test/project\n\n<INSTRUCTIONS>\nRepository rules\n</INSTRUCTIONS>";
const environment = "<environment_context>\n<cwd>/test/project</cwd>\n</environment_context>";
const openPage = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
const skill = "<skill>\n<name>fixture-skill</name>\n<path>/test/skills/fixture-skill/SKILL.md</path>\n# Skill instructions\nUse these instructions.\n</skill>";

test("injected instructions and environment-only messages have no display content", () => {
  for (const content of [agents, `${agents}\n${environment}`, environment, `${agents}\n${agents}`, openPage, openPage.replace("null", '"fixture-page"'), `${agents}\n${environment}\n${openPage}`]) {
    assert.equal(stripInjectedUserContext(content), "");
    assert.equal(stripInjectedUserContext(content.replaceAll("\n", "\r\n")), "");
  }
});

test("real prompts following injected envelopes are retained", () => {
  assert.equal(stripInjectedUserContext(`${agents}\n${environment}\n\nFix the chat layout.`), "Fix the chat layout.");
  assert.equal(stripInjectedUserContext(`${agents}\n请修改 AGENTS.md`), "请修改 AGENTS.md");
  assert.equal(stripInjectedUserContext(`${openPage}\n${openPage}\n请修复消息显示`), "请修复消息显示");
});

test("standalone skill instructions are hidden while actual prompts and references survive", () => {
  assert.equal(stripInjectedUserContext(skill), "");
  assert.equal(stripInjectedUserContext(`${skill}\n${skill}`), "");
  assert.equal(stripInjectedUserContext(`${agents}\n${skill}\n${environment}\n${openPage}`), "");
  assert.equal(stripInjectedUserContext(`${skill}\n请使用这个技能修改页面`), "请使用这个技能修改页面");
  assert.equal(stripInjectedUserContext(skill.replaceAll("\n", "\r\n")), "");
  for (const text of ["请使用 $fixture-skill", "请阅读 /test/skills/fixture-skill/SKILL.md", `解释以下示例：\n${skill}`, `\`\`\`xml\n${skill}\n\`\`\``, "<skill>用户写的普通内容</skill>", skill.replace("</skill>", "")]) {
    assert.equal(stripInjectedUserContext(text), text);
  }
});

test("quoted Page context and malformed envelopes remain visible", () => {
  for (const content of [`解释这个标记：${openPage}`, `\`\`\`\n${openPage}\n\`\`\``, '<external_codex_apps_open_page>not JSON</external_codex_apps_open_page>', '<external_codex_apps_open_page>{"other":null}</external_codex_apps_open_page>']) {
    assert.equal(stripInjectedUserContext(content), content);
  }
});

test("ordinary AGENTS.md requests, quoted examples and incomplete envelopes stay visible", () => {
  for (const content of ["请修改 AGENTS.md", "# AGENTS.md\nReview these rules", `Explain this example:\n${agents}`, `\`\`\`\n${agents}\n\`\`\``, "# AGENTS.md instructions for /test\nNo wrapper", "<INSTRUCTIONS>user text</INSTRUCTIONS>"]) {
    assert.equal(stripInjectedUserContext(content), content);
  }
});

test("both rollout user-message sources strip injected context and keep assistant text and attachments", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const helpers = source.slice(source.indexOf("function messageFromEvent("), source.indexOf("\nfunction isTurnEndEvent("));
  const { event, response, displayable } = vm.runInNewContext(`${helpers}\n({ event: messageFromEvent, response: messageFromResponseItem, displayable: hasDisplayableMessageContent })`, {
    stripInjectedUserContext,
    stripCodexDirectives: (text) => text.trim(),
    textFromContent: (content) => content.map((part) => part.text || "").join("\n"),
    imagesFromContent: (content) => content.filter((part) => part.type === "input_image").map((part) => part.image_url)
  });
  assert.equal(displayable(event(null, { type: "user_message", message: agents })), false);
  assert.equal(displayable(response(null, { type: "message", role: "user", content: [{ text: agents }] })), false);
  assert.equal(displayable(event(null, { type: "user_message", message: openPage })), false);
  assert.equal(displayable(response(null, { type: "message", role: "user", content: [{ text: openPage }] })), false);
  const originalEvent = { type: "user_message", message: skill };
  const originalResponse = { type: "message", role: "user", content: [{ text: skill }] };
  const snapshot = JSON.stringify([originalEvent, originalResponse]);
  assert.equal(displayable(event(null, originalEvent)), false);
  assert.equal(displayable(response(null, originalResponse)), false);
  assert.equal(JSON.stringify([originalEvent, originalResponse]), snapshot, "display filtering must not mutate original context payloads");
  assert.equal(response(null, { type: "message", role: "user", content: [{ text: openPage }, { text: "Actual prompt" }] }).content, "Actual prompt");
  assert.equal(event(null, { type: "user_message", message: `${agents}\nActual prompt` }).content, "Actual prompt");
  assert.equal(response(null, { type: "message", role: "user", content: [{ text: agents }, { text: environment }, { text: "Actual prompt" }] }).content, "Actual prompt");
  assert.equal(event(null, { type: "agent_message", message: agents }).content, agents);
  assert.equal(response(null, { type: "message", role: "assistant", content: [{ text: agents }] }).content, agents);
  assert.equal(displayable(event(null, { type: "user_message", message: agents, images: ["data:image/png;base64,fixture"] })), true);
  assert.equal(displayable(response(null, { type: "message", role: "user", content: [{ text: agents }, { type: "input_image", image_url: "data:image/png;base64,fixture" }] })), true);
});
