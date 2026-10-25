import { promises as fs } from "node:fs";
import path from "node:path";

// Stop at the nearest repository/worktree boundary. Outside Git, use only cwd.
export async function projectSkillRoots(cwd) {
  if (!cwd || !path.isAbsolute(cwd)) return [];
  const directories = [];
  let directory = path.resolve(cwd);
  while (true) {
    directories.push(directory);
    try {
      await fs.lstat(path.join(directory, ".git"));
      return directories.flatMap((dir) => [path.join(dir, ".agents", "skills"), path.join(dir, ".codex", "skills")]);
    } catch (error) {
      if (error.code !== "ENOENT") break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return [path.join(cwd, ".agents", "skills"), path.join(cwd, ".codex", "skills")];
}

export async function findSkillFiles(dir, depth = 0, ancestors = new Set()) {
  if (depth > 8) return [];
  try {
    const realDir = await fs.realpath(dir);
    if (ancestors.has(realDir)) return [];
    const branch = new Set([...ancestors, realDir]);
    const files = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      try {
        const stat = entry.isSymbolicLink() ? await fs.stat(entryPath) : entry;
        if (stat.isFile() && entry.name === "SKILL.md") files.push(entryPath);
        else if (stat.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
          files.push(...(await findSkillFiles(entryPath, depth + 1, branch)));
        }
      } catch {
        // Skip broken links or entries removed during discovery.
      }
    }
    return files;
  } catch {
    return [];
  }
}
