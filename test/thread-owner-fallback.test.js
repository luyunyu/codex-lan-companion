import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
const sendSource = source.slice(source.indexOf("async function sendToCodex("), source.indexOf("\nfunction conversationIdFromStartConversation("));
const ownerSource = source.slice(source.indexOf("function isNoOpenOwnerError("), source.indexOf("\nfunction isIpcTimeoutError("));

function fixture({ resumeError = new Error("thread already has an active writer"), ipcError, changedHome = false, allowWrite = true } = {}) {
  const calls = [];
  const notices = [];
  let refreshes = 0;
  const context = {
    ALLOW_WRITE: allowWrite,
    refreshCodexHomeContext: async () => ({ home: changedHome && ++refreshes > 1 ? "/other" : "/account" }),
    codexPaths: () => ({ home: "/account" }),
    normalizeSendImages: (images) => images,
    desktopUserInput: (text) => [{ type: "text", text }],
    findThread: async () => ({ id: "thread" }),
    isAppServerThread: async () => true,
    getLocalAppServerClient: async () => ({
      resumeThread: async () => { calls.push("resume"); throw resumeError; },
      close: async () => { calls.push("close"); }
    }),
    getCodexIpcClient: () => ({
      startTurn: async () => {
        calls.push("desktop-send");
        if (ipcError) throw ipcError;
        return { result: { result: { turn: { id: "turn" } } } };
      }
    }),
    logInfo: () => calls.push("log"),
    recordNotice: (id, notice) => notices.push(notice)
  };
  return { calls, notices, resumeError, send: vm.runInNewContext(`${ownerSource}\n${sendSource}\nsendToCodex`, context) };
}

test("writer conflict with an unavailable Desktop owner returns an actionable conflict without retries", async () => {
  for (const message of ["no-client-found", "thread-role-timeout: unavailable"]) {
    const ipcError = new Error(message);
    const { send, calls, notices, resumeError } = fixture({ ipcError });
    await assert.rejects(send("Hello", "thread"), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /Codex remote/);
      assert.equal(error.cause.errors[0], resumeError);
      assert.equal(error.cause.errors[1], ipcError);
      return true;
    });
    assert.deepEqual(calls, ["resume", "close", "desktop-send", "log"]);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].source, "send");
  }
});

test("writer conflict still permits an available Desktop owner to send once", async () => {
  const { send, calls, notices } = fixture();
  const result = await send("Hello", "thread");
  assert.equal(result.mode, "desktop-ipc");
  assert.equal(result.turnId, "turn");
  assert.deepEqual(calls, ["resume", "close", "desktop-send"]);
  assert.equal(notices.length, 0);
});

test("unrelated resume errors never fall back to Desktop", async () => {
  const resumeError = new Error("invalid configuration");
  const { send, calls } = fixture({ resumeError });
  await assert.rejects(send("Hello", "thread"), (error) => error === resumeError);
  assert.deepEqual(calls, ["resume", "close"]);
});

test("uncertain Desktop failures are propagated without a second send", async () => {
  const ipcError = new Error("thread-follower-start-turn timed out");
  const { send, calls } = fixture({ ipcError });
  await assert.rejects(send("Hello", "thread"), (error) => error === ipcError);
  assert.deepEqual(calls, ["resume", "close", "desktop-send"]);
});

test("account changes during resume prevent the Desktop fallback", async () => {
  const { send, calls } = fixture({ changedHome: true });
  await assert.rejects(send("Hello", "thread"), (error) => error.status === 409 && /home changed/.test(error.message));
  assert.deepEqual(calls, ["resume", "close"]);
});

test("read-only mode prevents both resume and Desktop delivery", async () => {
  const { send, calls } = fixture({ allowWrite: false });
  await assert.rejects(send("Hello", "thread"), (error) => error.status === 403);
  assert.deepEqual(calls, []);
});
