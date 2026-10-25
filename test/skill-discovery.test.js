import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { findSkillFiles, projectSkillRoots } from "../lib/skill-discovery.js";

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "companion-skills-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeSkill(directory, name = "shared") {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, "SKILL.md");
  await fs.writeFile(file, `---\nname: ${name}\ndescription: Test fixture\n---\nInstructions\n`);
  return file;
}

test("project skills include cwd and ancestors but stop at the repository boundary", async (t) => {
  const directory = await temporaryDirectory(t);
  const repo = path.join(directory, "repo");
  const cwd = path.join(repo, "packages", "app");
  await fs.mkdir(path.join(repo, ".git"), { recursive: true });
  await fs.mkdir(cwd, { recursive: true });
  const roots = await projectSkillRoots(cwd);
  assert.deepEqual(roots, [cwd, path.dirname(cwd), repo].flatMap((dir) => [
    path.join(dir, ".agents", "skills"), path.join(dir, ".codex", "skills")
  ]));
  assert.equal(roots.some((root) => root === path.join(directory, ".agents", "skills")), false);
});

test("worktree Git files are boundaries; non-repository and unknown cwd stay isolated", async (t) => {
  const directory = await temporaryDirectory(t);
  const worktree = path.join(directory, "worktree");
  const cwd = path.join(worktree, "src");
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(path.join(worktree, ".git"), "gitdir: /unused/main/.git/worktrees/test\n");
  assert.equal((await projectSkillRoots(cwd)).length, 4);
  const outside = path.join(directory, "outside");
  await fs.mkdir(outside);
  assert.deepEqual(await projectSkillRoots(outside), [path.join(outside, ".agents", "skills"), path.join(outside, ".codex", "skills")]);
  assert.deepEqual(await projectSkillRoots(""), []);
  assert.deepEqual(await projectSkillRoots("relative"), []);
});

test("symlinked skill folders work without looping or failing on broken links", async (t) => {
  const directory = await temporaryDirectory(t);
  const root = path.join(directory, "skills");
  const file = await writeSkill(path.join(directory, "external", "linked"));
  await fs.mkdir(root);
  await fs.symlink(path.dirname(file), path.join(root, "alias"));
  await fs.symlink(root, path.join(path.dirname(file), "cycle"));
  await fs.symlink(path.join(directory, "missing"), path.join(root, "broken"));
  assert.deepEqual(await findSkillFiles(root), [path.join(root, "alias", "SKILL.md")]);
});

const server = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const metadataHelpers = server.slice(server.indexOf("function compactPluginDescription("), server.indexOf("\nfunction skillSourceInfo("));
const sourceHelper = server.slice(server.indexOf("function skillSourceInfo("), server.indexOf("\nfunction mimeTypeForAsset("));
const loader = server.slice(server.indexOf("async function getSkills("), server.indexOf("\nfunction clearHomeScopedCaches("));

test("thread-scoped loading keeps same-name skills distinct, resolves links and isolates projects", async (t) => {
  const directory = await temporaryDirectory(t);
  const home = path.join(directory, "codex");
  const repoA = path.join(directory, "a");
  const repoB = path.join(directory, "b");
  await fs.mkdir(path.join(repoA, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoB, ".git"), { recursive: true });
  const global = await writeSkill(path.join(home, "skills", "shared"));
  const project = await writeSkill(path.join(repoA, ".agents", "skills", "shared"));
  const onlyB = await writeSkill(path.join(repoB, ".codex", "skills", "only-b"), "only-b");
  await writeSkill(path.join(home, "plugins", "cache", "unused", "0.0.1", "skills", "stale"), "stale");
  await fs.symlink(path.dirname(project), path.join(repoA, ".agents", "skills", "alias"));
  const getSkills = vm.runInNewContext(`${metadataHelpers}\n${sourceHelper}\n${loader}\ngetSkills`, {
    fs, path, os: { homedir: () => path.join(directory, "user") }, findSkillFiles, projectSkillRoots,
    process: { cwd: () => repoB }, CODEX_CLI: "/mock/codex",
    readNativeSkills: async ({ cwd }) => [
      { name: "shared", path: global, description: "Global fixture" },
      ...(cwd === repoA ? [{ name: "shared", path: project, description: "Project fixture" }] : []),
      ...(cwd === repoB ? [{ name: "only-b", path: onlyB }] : [])
    ],
    refreshCodexHomeContext: async () => ({ home, version: 1 }),
    getThreads: async () => [{ id: "a", cwd: repoA }, { id: "b", cwd: repoB }, { id: "unknown" }]
  });
  const a = await getSkills("a");
  assert.equal(a.cwd, repoA);
  assert.equal(a.skills.length, 2);
  assert.equal(new Set(a.skills.map((skill) => skill.uri)).size, 2);
  assert.deepEqual(Array.from(a.skills, (skill) => skill.path).sort(), [global, project].sort());
  const realProject = project;
  assert.equal(a.skills.find((skill) => skill.path === realProject).scope, "project");
  const b = await getSkills("b");
  assert.deepEqual(Array.from(b.skills, (skill) => skill.name).sort(), ["only-b", "shared"]);
  assert.equal((await getSkills("unknown")).skills.length, 1);
  assert.equal((await getSkills()).cwd, repoB);
  await assert.rejects(getSkills("other-account"), { status: 404 });
});
