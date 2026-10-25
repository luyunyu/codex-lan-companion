import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileBrowserRoots, listProjectDirectory } from "../lib/project-files.js";

test("project browsing uses assigned roots and keeps worktrees in their checkout", () => {
  const projects = [{ id: "p", rootPaths: ["/repo", "/shared"] }];
  assert.deepEqual(fileBrowserRoots({ projectId: "p", cwd: "/repo/src" }, projects), ["/repo", "/shared"]);
  assert.deepEqual(fileBrowserRoots({ projectId: "p", cwd: "/worktrees/task" }, projects), ["/worktrees/task"]);
  assert.deepEqual(fileBrowserRoots({ cwd: "/repository" }, projects), ["/repository"]);
  assert.deepEqual(fileBrowserRoots({}, projects), []);
});

test("directory listing is shallow, sorted, bounded, and rejects path and symlink escapes", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "companion-files-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "repo");
  const outside = path.join(temp, "repository");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, "src", "空 格.js"), "fixture");
  await fs.writeFile(path.join(root, "z.js"), "fixture");
  await fs.writeFile(path.join(root, "a.js"), "fixture");
  await fs.symlink(outside, path.join(root, "external"));
  await fs.symlink("src", path.join(root, "internal"));
  await fs.symlink("missing", path.join(root, "broken"));
  const listing = await listProjectDirectory([root]);
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["internal", "src", "a.js", "z.js"]);
  assert.equal(listing.truncated, false);
  const nested = await listProjectDirectory([root], { directory: "internal" });
  assert.equal(nested.entries[0].absolutePath, path.join(root, "internal", "空 格.js"));
  assert.equal(nested.entries[0].directory, false);
  assert.equal((await listProjectDirectory([root], { limit: 2 })).truncated, true);
  assert.equal((await listProjectDirectory([root, outside], { root: "1" })).entries.length, 0);
  for (const directory of ["../repository", "src/../../repository", "external"]) {
    await assert.rejects(listProjectDirectory([root], { directory }), { status: 403 });
  }
  for (const options of [{ directory: outside }, { directory: "\0" }, { root: "-1" }, { root: "1" }]) {
    await assert.rejects(listProjectDirectory([root], options), { status: 400 });
  }
});
