import { promises as fs } from "node:fs";
import path from "node:path";

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export function fileBrowserRoots(thread, projects) {
  const project = projects.find((item) => item.id === thread.projectId);
  const roots = (project?.rootPaths || []).filter((root) => path.isAbsolute(root));
  // Worktree conversations must browse their checkout, not the main repository.
  if (thread.cwd && path.isAbsolute(thread.cwd) && !roots.some((root) => inside(root, thread.cwd))) return [thread.cwd];
  return roots.length ? roots : thread.cwd && path.isAbsolute(thread.cwd) ? [thread.cwd] : [];
}

export async function listProjectDirectory(roots, { root = "0", directory = "", limit = 2000 } = {}) {
  if (!/^\d+$/.test(String(root)) || !roots[Number(root)] || typeof directory !== "string" || directory.includes("\0") || path.isAbsolute(directory)) {
    throw Object.assign(new Error("Invalid project directory"), { status: 400 });
  }
  const base = path.resolve(roots[Number(root)]);
  const target = path.resolve(base, directory);
  if (!inside(base, target)) throw Object.assign(new Error("Directory is outside the project"), { status: 403 });
  const realBase = await fs.realpath(base);
  const realTarget = await fs.realpath(target);
  if (!inside(realBase, realTarget)) throw Object.assign(new Error("Directory is outside the project"), { status: 403 });
  const entries = [];
  let truncated = false;
  let scanned = 0;
  const handle = await fs.opendir(realTarget);
  for await (const entry of handle) {
    if (++scanned > limit) {
      truncated = true;
      break;
    }
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      const resolved = await fs.realpath(path.join(realTarget, entry.name)).catch(() => null);
      if (!resolved || !inside(realBase, resolved)) continue;
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat || (!stat.isDirectory() && !stat.isFile())) continue;
      isDirectory = stat.isDirectory();
    } else if (!isDirectory && !entry.isFile()) continue;
    entries.push({ name: entry.name, directory: isDirectory, path: path.join(path.relative(base, target), entry.name), absolutePath: path.join(target, entry.name) });
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, "en", { numeric: true }));
  return { roots, root: Number(root), directory: path.relative(base, target), absolutePath: target, entries, truncated };
}
