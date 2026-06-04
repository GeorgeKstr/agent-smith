import path from "node:path";
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json"];
/**
 * Resolve a (possibly extensionless / .js-rewritten) local import specifier to
 * a known relative project path. Returns undefined for bare package imports.
 */
export function resolveLocalImport(fromRelPath, specifier, knownPaths) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/"))
        return undefined;
    const fromDir = path.posix.dirname(toPosix(fromRelPath));
    const base = specifier.startsWith("/")
        ? toPosix(specifier.replace(/^\/+/, ""))
        : path.posix.normalize(path.posix.join(fromDir, toPosix(specifier)));
    const candidates = [];
    // NodeNext rewrites .ts -> .js in import paths; try swapping back.
    const withoutExt = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    candidates.push(base);
    candidates.push(withoutExt);
    for (const ext of SOURCE_EXTS) {
        candidates.push(`${withoutExt}${ext}`);
        candidates.push(`${base}${ext}`);
    }
    for (const ext of SOURCE_EXTS) {
        candidates.push(`${withoutExt}/index${ext}`);
        candidates.push(`${base}/index${ext}`);
    }
    for (const candidate of candidates) {
        const normalized = candidate.replace(/^\.\//, "");
        if (knownPaths.has(normalized))
            return normalized;
    }
    return undefined;
}
function toPosix(p) {
    return p.split(path.sep).join("/");
}
/** Replace the import edges for a single file. */
export function rebuildImports(db, fileId, fromRelPath, imports, knownPaths, pathToId) {
    db.prepare("DELETE FROM imports WHERE from_file_id = ?").run(fileId);
    const insert = db.prepare(`
    INSERT INTO imports (from_file_id, to_file_id, import_text, resolved_path, confidence)
    VALUES (?, ?, ?, ?, ?)
  `);
    for (const imp of imports) {
        const resolved = resolveLocalImport(fromRelPath, imp.specifier, knownPaths);
        const toId = resolved ? pathToId.get(resolved) ?? null : null;
        insert.run(fileId, toId, imp.importText, resolved ?? null, resolved ? 1.0 : 0.4);
    }
}
/**
 * Expand from seed files across the import graph (both directions) up to depth.
 * Returns the set of reachable file IDs including the seeds.
 */
export function expandGraph(db, seedFileIds, depth) {
    const visited = new Set(seedFileIds);
    let frontier = new Set(seedFileIds);
    const outgoing = db.prepare("SELECT to_file_id AS id FROM imports WHERE from_file_id = ? AND to_file_id IS NOT NULL");
    const incoming = db.prepare("SELECT from_file_id AS id FROM imports WHERE to_file_id = ?");
    for (let level = 0; level < depth; level++) {
        const next = new Set();
        for (const fileId of frontier) {
            for (const row of [...outgoing.all(fileId), ...incoming.all(fileId)]) {
                if (row.id != null && !visited.has(row.id)) {
                    visited.add(row.id);
                    next.add(row.id);
                }
            }
        }
        if (next.size === 0)
            break;
        frontier = next;
    }
    return visited;
}
/** Gather the immediate import neighborhood of a file for the `graph` command. */
export function fileNeighbors(db, relPath) {
    const file = db.prepare("SELECT id FROM files WHERE path = ?").get(relPath);
    if (!file)
        return undefined;
    const imports = db
        .prepare("SELECT f.path AS path FROM imports i JOIN files f ON f.id = i.to_file_id WHERE i.from_file_id = ? AND i.to_file_id IS NOT NULL")
        .all(file.id).map((r) => r.path);
    const importedBy = db
        .prepare("SELECT f.path AS path FROM imports i JOIN files f ON f.id = i.from_file_id WHERE i.to_file_id = ?")
        .all(file.id).map((r) => r.path);
    return { path: relPath, imports, importedBy };
}
/** Render a small ASCII node graph for a file's neighborhood. */
export function renderFileGraph(neighbors) {
    const lines = [];
    lines.push(`           ┌─────────────────────────────┐`);
    lines.push(`           │  ${neighbors.path.padEnd(27).slice(0, 27)}│`);
    lines.push(`           └─────────────────────────────┘`);
    lines.push("");
    lines.push(`  imports (${neighbors.imports.length}) ──▶`);
    if (neighbors.imports.length === 0)
        lines.push("     · (none / external only)");
    for (const dep of neighbors.imports.slice(0, 20))
        lines.push(`     ├─▶ ${dep}`);
    lines.push("");
    lines.push(`  imported by (${neighbors.importedBy.length}) ◀──`);
    if (neighbors.importedBy.length === 0)
        lines.push("     · (entry point / unused)");
    for (const dep of neighbors.importedBy.slice(0, 20))
        lines.push(`     ◀─┤ ${dep}`);
    return lines.join("\n");
}
