import { execa } from "execa";
import { heuristicTags } from "../index/tags.js";
import { expandGraph } from "../index/graph.js";
const FILE_EXT_PATTERN = /\b([\w./-]+\.[a-z]{2,6})\b/gi;
const SYMBOL_PATTERN = /\b([A-Z][a-zA-Z0-9]{2,}(?:\.[A-Z][a-zA-Z0-9]{2,})*)\b/g;
const IDENTIFIER_PATTERN = /\b([a-zA-Z_$][\w.$]{2,})\b/g;
function extractFileHints(task) {
    const hints = [];
    let m;
    FILE_EXT_PATTERN.lastIndex = 0;
    while ((m = FILE_EXT_PATTERN.exec(task)) !== null) {
        hints.push(m[1]);
    }
    return dedupeStrings(hints);
}
function extractSymbolHints(task) {
    const hints = [];
    let m;
    SYMBOL_PATTERN.lastIndex = 0;
    while ((m = SYMBOL_PATTERN.exec(task)) !== null) {
        hints.push(m[1]);
    }
    return dedupeStrings(hints);
}
function extractKeywords(task) {
    const raw = dedupeStrings(task.split(/[^A-Za-z0-9_$.]+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase())));
    const symbolHints = extractSymbolHints(task);
    const fileHints = extractFileHints(task);
    const all = new Set();
    for (const w of raw)
        all.add(w);
    for (const s of symbolHints)
        all.add(s);
    for (const f of fileHints)
        all.add(f);
    return [...all].slice(0, 16);
}
function findLikelyFiles(db, keywords, fileHints) {
    const results = new Set();
    for (const hint of fileHints) {
        const lower = hint.toLowerCase();
        const rows = db.prepare("SELECT path FROM files WHERE lower(path) LIKE ? OR lower(path) = ? LIMIT 5").all(`%${lower}%`, lower);
        for (const r of rows)
            results.add(r.path);
    }
    for (const kw of keywords.slice(0, 8)) {
        if (kw.length < 3)
            continue;
        const rows = db.prepare("SELECT path FROM files WHERE lower(path) LIKE ? LIMIT 3").all(`%${kw.toLowerCase()}%`);
        for (const r of rows)
            results.add(r.path);
    }
    for (const kw of keywords.slice(0, 8)) {
        if (kw.length < 3)
            continue;
        const rows = db.prepare("SELECT path FROM files WHERE summary IS NOT NULL AND lower(summary) LIKE ? LIMIT 3").all(`%${kw.toLowerCase()}%`);
        for (const r of rows)
            results.add(r.path);
    }
    return [...results].slice(0, 10);
}
function findLikelySymbols(db, keywords, symbolHints) {
    const results = new Set();
    for (const hint of symbolHints) {
        const rows = db.prepare("SELECT name FROM symbols WHERE lower(name) = ? LIMIT 5").all(hint.toLowerCase());
        for (const r of rows)
            results.add(r.name);
    }
    for (const kw of keywords.slice(0, 10)) {
        if (kw.length < 3)
            continue;
        const rows = db.prepare("SELECT name FROM symbols WHERE lower(name) LIKE ? LIMIT 5").all(`%${kw.toLowerCase()}%`);
        for (const r of rows)
            results.add(r.name);
    }
    return [...results].slice(0, 10);
}
function inferTags(task) {
    const idSet = new Set(heuristicTags(task, task));
    const patterns = [
        [1, /\b(auth|login|logout|session|token|jwt|oauth|permission|credential)\b/i],
        [2, /\b(api|endpoint|route|handler|controller|middleware|request|response|express|fastify)\b/i],
        [3, /\b(ui|component|render|screen|page|view|layout|style|modal|button|widget|frontend|react|vue)\b/i],
        [4, /\b(database|sql|query|schema|migration|orm|prisma|sequelize|pg|postgres|mongo|redis|table)\b/i],
        [5, /\b(state|store|redux|context|signal|recoil|pinia|vuex|zustand|mobx)\b/i],
        [7, /\b(config|env|settings|environment|\.json|\.yaml|\.toml|\.ini|options)\b/i],
        [8, /\b(test|spec|mock|stub|fixture|assert|expect|jest|vitest|mocha|coverage)\b/i],
        [9, /\b(build|compile|bundle|webpack|vite|esbuild|package|tsconfig|dist|deploy)\b/i],
        [11, /\b(type|interface|enum|typedef|struct|schema|dto|model)\b/i],
        [13, /\b(fetch|axios|http|websocket|socket|sse|stream|network|client|server)\b/i],
        [16, /\b(error|exception|bug|crash|fail|fix|debug|handle|catch|throw)\b/i],
        [19, /\b(cli|command|terminal|stdin|stdout|argv|args|flag|option|parse)\b/i],
        [22, /\b(secret|encrypt|decrypt|hash|salt|security|vuln|csrf|xss|inject)\b/i],
        [24, /\b(search|find|filter|sort|index|lookup|query|grep|scan)\b/i],
    ];
    for (const [id, pattern] of patterns) {
        if (pattern.test(task))
            idSet.add(id);
    }
    return [...idSet].slice(0, 6);
}
/** Fully algorithmic task classification — no LLM needed. */
export async function classifyTask(args) {
    const task = args.task;
    const keywords = extractKeywords(task);
    const fileHints = extractFileHints(task);
    const symbolHints = extractSymbolHints(task);
    const tagIds = inferTags(task);
    let likelyFiles = [];
    let likelySymbols = [];
    if (args.db) {
        likelyFiles = findLikelyFiles(args.db, keywords, fileHints);
        likelySymbols = findLikelySymbols(args.db, keywords, symbolHints);
    }
    return {
        tagIds,
        keywords: keywords.slice(0, 12),
        likelyFiles: dedupeStrings([...fileHints, ...likelyFiles]).slice(0, 10),
        likelySymbols: dedupeStrings([...symbolHints, ...likelySymbols]).slice(0, 10),
        needsTests: /\btest|spec|coverage\b/i.test(task),
        needsTypes: /\btype|interface|schema|model\b/i.test(task)
    };
}
/** Run ripgrep for the keywords; gracefully fall back to a SQL-driven scan. */
async function ripgrepHits(root, keywords, ignore) {
    const hits = new Map();
    const terms = keywords.filter((k) => k.length >= 3).slice(0, 8);
    if (terms.length === 0)
        return hits;
    const pattern = terms.map((t) => escapeRegex(t)).join("|");
    const args = ["--no-heading", "--count", "--ignore-case", "-e", pattern, "."];
    for (const dir of ignore)
        args.push("--glob", `!${dir}/**`);
    try {
        const { stdout } = await execa("rg", args, { cwd: root, reject: false, timeout: 15_000 });
        for (const line of stdout.split("\n")) {
            const idx = line.lastIndexOf(":");
            if (idx === -1)
                continue;
            const file = line.slice(0, idx).replace(/^\.\//, "");
            const count = Number(line.slice(idx + 1));
            if (file && Number.isFinite(count))
                hits.set(file, count);
        }
    }
    catch {
        // ripgrep not installed; caller relies on other signals.
    }
    return hits;
}
/**
 * Score and rank files for a task using grep hits, tag overlap, summary/symbol
 * matches, graph proximity, related tests and task memory; then expand the
 * import graph around the top seeds.
 */
export async function retrieve(args) {
    const { db, root, config, classification } = args;
    const scores = new Map();
    const files = db.prepare("SELECT id, path, language, is_test, summary FROM files").all();
    const byId = new Map(files.map((f) => [f.id, f]));
    function addReason(fileId, amount, shortReason, detail) {
        const f = byId.get(fileId);
        if (!f)
            return undefined;
        let entry = scores.get(fileId);
        if (!entry) {
            entry = { fileId, path: f.path, language: f.language, isTest: !!f.is_test, score: 0, reasons: [], reasonDetails: [] };
            scores.set(fileId, entry);
        }
        entry.score += amount;
        entry.reasons.push(shortReason);
        (entry.reasonDetails ??= []).push(detail);
        return entry;
    }
    const pathToId = new Map(files.map((f) => [f.path, f.id]));
    // 1. ripgrep exact hits.
    const grep = await ripgrepHits(root, classification.keywords, config.index.ignore);
    for (const [filePath, count] of grep) {
        const id = pathToId.get(filePath);
        if (id == null)
            continue;
        const weight = Math.min(8, count) * 3;
        addReason(id, weight, `grep×${count}`, {
            signal: "grep", weight,
            detail: `ripgrep matched ${count} time(s)`
        });
    }
    // 2. tag overlap.
    if (classification.tagIds.length > 0) {
        const placeholders = classification.tagIds.map(() => "?").join(",");
        const tagRows = db
            .prepare(`SELECT file_id, COUNT(*) AS overlap FROM file_tags WHERE tag_id IN (${placeholders}) GROUP BY file_id`)
            .all(...classification.tagIds);
        for (const row of tagRows) {
            addReason(row.file_id, row.overlap * 2, `tags×${row.overlap}`, {
                signal: "tag", weight: row.overlap * 2,
                detail: `tag overlap ${row.overlap} tag(s)`
            });
        }
    }
    const lowerKeywords = classification.keywords.map((k) => k.toLowerCase());
    // 3. summary match.
    for (const f of files) {
        if (!f.summary)
            continue;
        const summary = f.summary.toLowerCase();
        const matches = lowerKeywords.filter((k) => summary.includes(k)).length;
        if (matches > 0) {
            addReason(f.id, matches * 2, `summary×${matches}`, {
                signal: "summary", weight: matches * 2,
                detail: `summary matched ${matches} keyword(s)`
            });
        }
    }
    // 4. symbol match (name contains keyword or matches likelySymbols).
    const symbolTargets = dedupeStrings([...lowerKeywords, ...classification.likelySymbols.map((s) => s.toLowerCase())]);
    const symbols = db.prepare("SELECT file_id, name, kind, start_line, end_line FROM symbols").all();
    const seedSymbols = [];
    for (const sym of symbols) {
        const lname = sym.name.toLowerCase();
        if (symbolTargets.some((t) => t.length >= 3 && lname.includes(t))) {
            addReason(sym.file_id, 4, `sym:${sym.name}`, {
                signal: "symbol", weight: 4,
                detail: `symbol ${sym.name} matches`
            });
            const f = byId.get(sym.file_id);
            if (f)
                seedSymbols.push({ name: sym.name, path: f.path, kind: sym.kind, startLine: sym.start_line, endLine: sym.end_line });
        }
    }
    // 5. likely files hint.
    for (const hint of classification.likelyFiles) {
        const normalizedHint = hint.toLowerCase();
        for (const f of files) {
            const p = f.path.toLowerCase();
            const exact = p === normalizedHint;
            const basename = p.split("/").pop() ?? "";
            const basenameMatch = basename === normalizedHint;
            const partial = p.includes(normalizedHint);
            if (exact || basenameMatch || partial) {
                const weight = exact ? 12 : basenameMatch ? 10 : 7;
                const kind = exact ? "exact" : basenameMatch ? "basename" : "partial";
                addReason(f.id, weight, "hint", {
                    signal: "file_hint", weight,
                    detail: `file hint ${kind} match "${hint}"`
                });
            }
        }
    }
    // 6. task memory: files from past successful similar tasks.
    for (const fileId of memoryFileBoost(db, classification.keywords)) {
        addReason(fileId, 2, "memory", {
            signal: "memory", weight: 2,
            detail: "task memory boost"
        });
    }
    // 7. graph proximity: expand around current top seeds.
    const seeds = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 5).map((s) => s.fileId);
    const expanded = expandGraph(db, seeds, config.context.graphDepth);
    for (const fileId of expanded) {
        if (!seeds.includes(fileId)) {
            const existing = scores.get(fileId);
            if (!existing || existing.score === 0) {
                addReason(fileId, 1.5, "graph", {
                    signal: "graph", weight: 1.5,
                    detail: "import graph neighbor"
                });
            }
        }
    }
    // 8. related tests.
    if (config.context.includeTests) {
        for (const entry of [...scores.values()]) {
            if (entry.score <= 0 || entry.isTest)
                continue;
            const stem = entry.path.replace(/\.[tj]sx?$/, "").split("/").pop() ?? "";
            for (const f of files) {
                if (f.is_test && stem && f.path.includes(stem)) {
                    addReason(f.id, 1.5, "test-of-seed", {
                        signal: "test", weight: 1.5,
                        detail: `related test for ${stem}`
                    });
                }
            }
        }
    }
    const ranked = [...scores.values()].filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    return { classification, files: ranked, seedSymbols: dedupeSymbols(seedSymbols) };
}
function memoryFileBoost(db, keywords) {
    if (keywords.length === 0)
        return [];
    const like = keywords.map(() => "task_text LIKE ?").join(" OR ");
    const params = keywords.map((k) => `%${k}%`);
    const tasks = db
        .prepare(`SELECT id FROM tasks WHERE success = 1 AND (${like}) ORDER BY created_at DESC LIMIT 5`)
        .all(...params);
    if (tasks.length === 0)
        return [];
    const ids = tasks.map((t) => t.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
        .prepare(`SELECT DISTINCT file_id FROM edits WHERE task_id IN (${placeholders}) AND file_id IS NOT NULL`)
        .all(...ids);
    return rows.map((r) => r.file_id);
}
function dedupeStrings(values) {
    return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
function dedupeSymbols(symbols) {
    const seen = new Set();
    const out = [];
    for (const s of symbols) {
        const key = `${s.path}:${s.name}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const STOP_WORDS = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "add", "use", "should",
    "make", "when", "where", "which", "what", "how", "are", "was", "but", "not", "can", "will", "all"
]);
