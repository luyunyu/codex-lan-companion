import assert from "node:assert/strict";
import { test } from "node:test";
import { readNativeSkills, assertAvailableSkillReferences } from "../lib/native-skills.js";

const available = { name: "sample", path: "/fixture/sample/SKILL.md", enabled: true, scope: "user" };

test("native discovery uses only skills/list, excludes disabled skills and always closes", async () => {
  const calls = [];
  class Client {
    constructor(options) { calls.push(["client", options]); }
    async initialize() { calls.push(["initialize"]); }
    async request(method, params) {
      calls.push([method, params]);
      return { data: [{ cwd: "/fixture", skills: [available, { ...available, name: "disabled", enabled: false }] }] };
    }
    async close() { calls.push(["close"]); }
  }
  const result = await readNativeSkills({ cli: "/mock/codex", cwd: "/fixture", home: "/account" }, { Client });
  assert.deepEqual(result, [available]);
  assert.deepEqual(calls.map(([method]) => method), ["client", "initialize", "skills/list", "close"]);
  assert.deepEqual(calls[2][1], { cwds: ["/fixture"], forceReload: true });
});

test("unknown directories show global skills only; native errors do not fall back to cache scans", async () => {
  let closed = 0;
  class Client {
    async initialize() {}
    async request() { return { data: [{ cwd: "/account", skills: [available, { ...available, scope: "repo", name: "project" }] }] }; }
    async close() { closed++; }
  }
  const options = { cli: "/mock/codex", cwd: "", home: "/account" };
  assert.deepEqual(await readNativeSkills(options, { Client }), [available]);
  Client.prototype.request = async () => { throw new Error("catalog unavailable"); };
  await assert.rejects(readNativeSkills(options, { Client }), /catalog unavailable/);
  assert.equal(closed, 2);
});

test("stale cached references fail before send while exact native references and code examples remain valid", () => {
  const text = `Use [$sample](${available.path})`;
  assert.doesNotThrow(() => assertAvailableSkillReferences(text, [available]));
  assert.throws(() => assertAvailableSkillReferences(text, []), { status: 409 });
  assert.throws(() => assertAvailableSkillReferences(text, [{ ...available, path: "/old/sample/SKILL.md" }]), { status: 409 });
  assert.doesNotThrow(() => assertAvailableSkillReferences(`\`${text}\``, []));
});

test("send guards reject a stale skill before Desktop IPC or conversation creation", async () => {
  const { readFile } = await import("node:fs/promises");
  const { default: vm } = await import("node:vm");
  const { desktopUserInput } = await import("../lib/desktop-user-input.js");
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const sendSource = source.slice(source.indexOf("async function sendToCodex("), source.indexOf("\nasync function startNewCodexThread("));
  const calls = [];
  const send = vm.runInNewContext(`${sendSource}\nsendToCodex`, {
    ALLOW_WRITE: true,
    refreshCodexHomeContext: async () => ({}), normalizeSendImages: () => [],
    desktopUserInput, assertAvailableSkillReferences,
    getSkills: async (...args) => { calls.push(args); return { skills: [] }; },
    getCodexIpcClient: () => { throw new Error("must not send"); },
    startNewCodexThread: () => { throw new Error("must not create"); },
    getThreads: async () => [{ id: "default-thread" }]
  });
  const text = "[$stale](/fixture/stale/SKILL.md)";
  await assert.rejects(send(text, "thread"), { status: 409 });
  await assert.rejects(send(text, null, [], { newThread: true, projectId: "project" }), { status: 409 });
  await assert.rejects(send(text, undefined), { status: 409 });
  assert.deepEqual(calls, [["thread", ""], [null, "project"], ["default-thread", ""]]);
});
