import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const helper = source.slice(source.indexOf("async function fetchJson("), source.indexOf("\nfunction syncDelay("));

function fixture(body, status = 200) {
  const unauthorized = [];
  const fetchJson = vm.runInNewContext(`${helper}\nfetchJson`, {
    fetch: async () => new Response(body, { status }),
    authHeaders: () => ({}),
    handleUnauthorized: (error) => { if (error.status === 401) unauthorized.push(error); },
    t: (key, values) => `${key}${values ? `:${values.status}` : ""}`
  });
  return { fetchJson, unauthorized };
}

test("a stale server's plain-text file API 404 explains that a restart is needed", async () => {
  const { fetchJson } = fixture("Not found", 404);
  await assert.rejects(fetchJson("/api/project-files?threadId=fixture"), { message: "fileApiUnavailable", status: 404 });
});

test("JSON responses retain data and API errors, including authentication failures", async () => {
  assert.equal((await fixture('{"ok":true}').fetchJson("/api/health")).ok, true);
  const ui = fixture('{"error":"Unauthorized"}', 401);
  await assert.rejects(ui.fetchJson("/api/threads"), { message: "Unauthorized", status: 401 });
  assert.equal(ui.unauthorized.length, 1);
});

test("non-JSON responses preserve HTTP status and still trigger authentication handling", async () => {
  const ui = fixture("Unauthorized", 401);
  await assert.rejects(ui.fetchJson("/api/threads"), { message: "apiInvalidResponse:401", status: 401 });
  assert.equal(ui.unauthorized.length, 1);
  await assert.rejects(fixture("<html>Bad Gateway</html>", 502).fetchJson("/api/threads"), { message: "apiInvalidResponse:502", status: 502 });
});
