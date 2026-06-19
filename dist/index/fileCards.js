const STATE_KEYWORDS = [
    "useState", "store", "db", "localStorage", "sqlite", "config",
    "session", "context", "signal", "recoil", "pinia", "vuex", "zustand",
    "mobx", "redux", "ref", "state", "setState",
];
const SIDE_EFFECT_KEYWORDS = [
    "fs.", "execa", "fetch", "child_process", "process.env",
    "git", "sqlite", "Database", "fs/promises", "writeFile",
    "readFile", "mkdir", "rm", "unlink",
];
const WARNING_PATTERNS = [
    [/config/i, "This file affects configuration. Changes may have broad impact."],
    [/db|database|schema|migration/i, "This file touches database/schema. Back up before editing."],
    [/safety|security|auth/i, "This file is safety/security-sensitive. Review changes carefully."],
    [/layout|theme|css|style/i, "This file affects UI layout/theme. Verify visually after changes."],
    [/\.env|secret|credential|token/i, "Never expose secrets in this file."],
];
export function buildHeuristicFileCard(input) {
    const { path, content, hash, symbols, imports, summary } = input;
    const lower = content.toLowerCase();
    const allSymbols = symbols ?? [];
    const allImports = imports ?? [];
    const exports = allSymbols
        .filter((s) => /^export/i.test(s.signature ?? "") || s.kind === "class" || s.kind === "function")
        .map((s) => s.name)
        .slice(0, 10);
    const importsList = allImports
        .map((i) => i.specifier)
        .filter(Boolean)
        .slice(0, 10);
    const importantFunctions = allSymbols
        .filter((s) => s.kind === "function" || s.kind === "method" || s.kind === "class")
        .slice(0, 8)
        .map((s) => ({
        name: s.name,
        lines: [s.startLine, s.endLine],
        summary: s.signature ?? `${s.kind} ${s.name}`,
    }));
    const stateTouched = [];
    for (const kw of STATE_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) {
            stateTouched.push(kw);
        }
    }
    const sideEffects = [];
    for (const kw of SIDE_EFFECT_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) {
            sideEffects.push(kw);
        }
    }
    const commonEditWarnings = [];
    for (const [pattern, warning] of WARNING_PATTERNS) {
        if (pattern.test(path) || pattern.test(lower)) {
            commonEditWarnings.push(warning);
        }
    }
    return {
        path,
        purpose: summary ?? `${allSymbols.length > 0 ? `${allSymbols.length} symbols` : "No symbols found"} in ${path}`,
        exports,
        imports: importsList,
        importantFunctions,
        stateTouched: [...new Set(stateTouched)].slice(0, 6),
        sideEffects: [...new Set(sideEffects)].slice(0, 6),
        commonEditWarnings: [...new Set(commonEditWarnings)].slice(0, 4),
        lastUpdatedHash: hash,
    };
}
// ── DB methods ────────────────────────────────────────────────
export function getFileCard(db, path) {
    const row = db
        .prepare(`SELECT path, hash, purpose, exports_json, imports_json, important_functions_json,
              state_touched_json, side_effects_json, common_edit_warnings_json
       FROM file_cards WHERE path = ?`)
        .get(path);
    if (!row)
        return undefined;
    return deserializeFileCard(row);
}
export function upsertFileCard(db, card) {
    db.prepare(`INSERT INTO file_cards (path, hash, purpose, exports_json, imports_json,
       important_functions_json, state_touched_json, side_effects_json,
       common_edit_warnings_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       hash = excluded.hash, purpose = excluded.purpose,
       exports_json = excluded.exports_json, imports_json = excluded.imports_json,
       important_functions_json = excluded.important_functions_json,
       state_touched_json = excluded.state_touched_json,
       side_effects_json = excluded.side_effects_json,
       common_edit_warnings_json = excluded.common_edit_warnings_json,
       updated_at = excluded.updated_at`).run(card.path, card.lastUpdatedHash, card.purpose, JSON.stringify(card.exports), JSON.stringify(card.imports), JSON.stringify(card.importantFunctions), JSON.stringify(card.stateTouched), JSON.stringify(card.sideEffects), JSON.stringify(card.commonEditWarnings), String(Date.now()));
}
export function getFileCards(db, paths) {
    if (paths.length === 0)
        return [];
    const placeholders = paths.map(() => "?").join(",");
    const rows = db
        .prepare(`SELECT path, hash, purpose, exports_json, imports_json, important_functions_json,
              state_touched_json, side_effects_json, common_edit_warnings_json
       FROM file_cards WHERE path IN (${placeholders})`)
        .all(...paths);
    return rows.map(deserializeFileCard);
}
export function searchFileCards(db, query, limit) {
    const like = `%${query}%`;
    const rows = db
        .prepare(`SELECT path, hash, purpose, exports_json, imports_json, important_functions_json,
              state_touched_json, side_effects_json, common_edit_warnings_json
       FROM file_cards
       WHERE path LIKE ? OR purpose LIKE ?
       ORDER BY length(path)
       LIMIT ?`)
        .all(like, like, limit);
    return rows.map(deserializeFileCard);
}
function deserializeFileCard(row) {
    return {
        path: row.path,
        purpose: row.purpose,
        exports: safeParseArray(row.exports_json),
        imports: safeParseArray(row.imports_json),
        importantFunctions: safeParseImportantFunctions(row.important_functions_json),
        stateTouched: safeParseArray(row.state_touched_json),
        sideEffects: safeParseArray(row.side_effects_json),
        commonEditWarnings: safeParseArray(row.common_edit_warnings_json),
        lastUpdatedHash: row.hash,
    };
}
function safeParseArray(json) {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
        return [];
    }
}
function safeParseImportantFunctions(json) {
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed))
            return [];
        return parsed.map((item) => {
            const obj = item;
            return {
                name: String(obj.name ?? ""),
                lines: (Array.isArray(obj.lines) && obj.lines.length === 2
                    ? [Number(obj.lines[0]), Number(obj.lines[1])]
                    : [0, 0]),
                summary: String(obj.summary ?? ""),
            };
        });
    }
    catch {
        return [];
    }
}
