import type { SmithDatabase } from "../db/db.js";

export type FileCard = {
  path: string;
  purpose: string;
  exports: string[];
  imports: string[];
  importantFunctions: Array<{
    name: string;
    lines: [number, number];
    summary: string;
  }>;
  stateTouched: string[];
  sideEffects: string[];
  commonEditWarnings: string[];
  lastUpdatedHash: string;
};

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

const WARNING_PATTERNS: Array<[RegExp, string]> = [
  [/config/i, "This file affects configuration. Changes may have broad impact."],
  [/db|database|schema|migration/i, "This file touches database/schema. Back up before editing."],
  [/safety|security|auth/i, "This file is safety/security-sensitive. Review changes carefully."],
  [/layout|theme|css|style/i, "This file affects UI layout/theme. Verify visually after changes."],
  [/\.env|secret|credential|token/i, "Never expose secrets in this file."],
];

export function buildHeuristicFileCard(input: {
  path: string;
  content: string;
  hash: string;
  symbols?: Array<{ name: string; kind: string; startLine: number; endLine: number; signature?: string }>;
  imports?: Array<{ importText: string; specifier: string }>;
  summary?: string;
}): FileCard {
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
      lines: [s.startLine, s.endLine] as [number, number],
      summary: s.signature ?? `${s.kind} ${s.name}`,
    }));

  const stateTouched: string[] = [];
  for (const kw of STATE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      stateTouched.push(kw);
    }
  }

  const sideEffects: string[] = [];
  for (const kw of SIDE_EFFECT_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      sideEffects.push(kw);
    }
  }

  const commonEditWarnings: string[] = [];
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

export function getFileCard(db: SmithDatabase, path: string): FileCard | undefined {
  const row = db
    .prepare(
      `SELECT path, hash, purpose, exports_json, imports_json, important_functions_json,
              state_touched_json, side_effects_json, common_edit_warnings_json
       FROM file_cards WHERE path = ?`
    )
    .get(path) as Record<string, string> | undefined;
  if (!row) return undefined;
  return deserializeFileCard(row);
}

export function upsertFileCard(db: SmithDatabase, card: FileCard): void {
  db.prepare(
    `INSERT INTO file_cards (path, hash, purpose, exports_json, imports_json,
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
       updated_at = excluded.updated_at`
  ).run(
    card.path,
    card.lastUpdatedHash,
    card.purpose,
    JSON.stringify(card.exports),
    JSON.stringify(card.imports),
    JSON.stringify(card.importantFunctions),
    JSON.stringify(card.stateTouched),
    JSON.stringify(card.sideEffects),
    JSON.stringify(card.commonEditWarnings),
    String(Date.now())
  );
}

export function getFileCards(db: SmithDatabase, paths: string[]): FileCard[] {
  if (paths.length === 0) return [];
  const placeholders = paths.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT path, hash, purpose, exports_json, imports_json, important_functions_json,
              state_touched_json, side_effects_json, common_edit_warnings_json
       FROM file_cards WHERE path IN (${placeholders})`
    )
    .all(...paths) as Array<Record<string, string>>;
  return rows.map(deserializeFileCard);
}

export function searchFileCards(
  db: SmithDatabase,
  query: string,
  limit: number
): FileCard[] {
  const like = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT path, hash, purpose, exports_json, imports_json, important_functions_json,
              state_touched_json, side_effects_json, common_edit_warnings_json
       FROM file_cards
       WHERE path LIKE ? OR purpose LIKE ?
       ORDER BY length(path)
       LIMIT ?`
    )
    .all(like, like, limit) as Array<Record<string, string>>;
  return rows.map(deserializeFileCard);
}

function deserializeFileCard(row: Record<string, string>): FileCard {
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

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseImportantFunctions(
  json: string
): Array<{ name: string; lines: [number, number]; summary: string }> {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: unknown) => {
      const obj = item as Record<string, unknown>;
      return {
        name: String(obj.name ?? ""),
        lines: (Array.isArray(obj.lines) && obj.lines.length === 2
          ? [Number(obj.lines[0]), Number(obj.lines[1])]
          : [0, 0]) as [number, number],
        summary: String(obj.summary ?? ""),
      };
    });
  } catch {
    return [];
  }
}
