import path from "node:path";

export function projectCatalog(globalState = {}, databaseProjects = [], databaseRoots = [], { databaseAvailable = databaseProjects.length > 0 } = {}) {
  const projects = new Map();
  const aliases = new Map();
  const migrations = globalState["app-server-project-id-by-legacy-project-id-by-host"] || {};
  const localMigration = Object.entries(migrations).filter(([key]) => key.startsWith("local:"));
  const migratedId = (id) => localMigration.map(([, mapping]) => mapping?.[id]).find(Boolean) || id;
  for (const row of databaseProjects) {
    projects.set(row.id, { id: row.id, name: row.name, rootPaths: databaseRoots.filter((root) => root.project_id === row.id).map((root) => root.path).filter((root) => path.isAbsolute(root)) });
  }
  for (const row of Object.values(globalState["local-projects"] || {})) {
    if (!row?.id) continue;
    const id = migratedId(row.id);
    aliases.set(row.id, id);
    if (!databaseAvailable && !projects.has(id)) projects.set(id, { id, name: row.name || row.id, rootPaths: (row.rootPaths || []).filter((root) => typeof root === "string" && path.isAbsolute(root)) });
  }
  for (const root of databaseAvailable ? [] : globalState["electron-saved-workspace-roots"] || []) {
    if (typeof root !== "string" || !path.isAbsolute(root)) continue;
    if ([...projects.values()].some((project) => project.rootPaths.includes(root))) continue;
    const id = `root:${root}`;
    projects.set(id, { id, name: globalState["electron-workspace-root-labels"]?.[root] || path.basename(root) || root, rootPaths: [root] });
  }
  return { projects: [...projects.values()], aliases, globalState };
}

export function withThreadProjects(rows, catalog, memberships = new Map()) {
  const { projects, aliases, globalState } = catalog;
  const byId = new Map(projects.map((project) => [project.id, project]));
  const projectless = new Set(globalState["projectless-thread-ids"] || []);
  return rows.map((row) => {
    let project = null;
    // A populated SQLite membership is authoritative. NULL can mean that
    // Desktop still stores membership in global state during migration.
    const databaseProjectId = memberships.get(row.id);
    if (databaseProjectId) {
      project = byId.get(databaseProjectId);
    } else if (!projectless.has(row.id)) {
      const assignment = globalState["thread-project-assignments"]?.[row.id];
      if (assignment) {
        if (assignment.projectKind === "local") project = byId.get(aliases.get(assignment.projectId) || assignment.projectId);
      } else {
        const cwd = globalState["thread-workspace-root-hints"]?.[row.id] || row.cwd || "";
        project = projects.flatMap((item) => item.rootPaths.map((root) => ({ item, root })))
          .filter(({ root }) => cwd === root || cwd.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`))
          .sort((a, b) => b.root.length - a.root.length)[0]?.item;
      }
    }
    return { ...row, projectId: project?.id || null, projectName: project?.name || "" };
  });
}

export function threadPage(rows, { offset = 0, limit = 50, query = "", projectId = "", selectedId = "" } = {}) {
  const start = Number.isFinite(Number(offset)) ? Math.max(0, Math.trunc(Number(offset))) : 0;
  const size = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 50));
  const search = String(query || "").trim().toLowerCase();
  const filtered = rows.filter((row) => (!projectId || (projectId === "__none__" ? !row.projectId : row.projectId === projectId))
    && (!search || `${row.title || ""} ${row.preview || ""} ${row.cwd || ""} ${row.projectName || ""}`.toLowerCase().includes(search)));
  const threads = filtered.slice(start, start + size);
  return { threads, total: filtered.length, offset: start, nextOffset: start + threads.length,
    hasMore: start + threads.length < filtered.length, selectedThread: rows.find((row) => row.id === selectedId) || null };
}
