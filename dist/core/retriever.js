import { execa } from "execa";
import { generateWithOllama, extractJson, optionsFromConfig } from "./ollama.js";
import { GLOBAL_TAGS, heuristicTags, tagMapForPrompt } from "./tags.js";
import { expandGraph } from "./graph.js";
const VALID_IDS = new Set(GLOBAL_TAGS.map((t) => t.id));
const CLASSIFY_SYSTEM = `You classify a coding task for a retrieval system.
Reply ONLY with JSON of this exact shape:
{"tagIds":[numbers],"keywords":[strings],"likelyFiles":[strings],"likelySymbols":[strings],"needsTests":bool,"needsTypes":bool}
tagIds must come from the provided tag map. keywords are concrete identifiers/terms to grep for. No prose.`;
/** Classify a task into tags, keywords and hints. Falls back to heuristics. */
export async function classifyTask(args) {
    const fallback = heuristicClassification(args.task);
    if (!args.ollamaReady)
        return fallback;
    const prompt = `TAG MAP: ${tagMapForPrompt()}

TASK: ${args.task}

Return the JSON classification:`;
    const result = await generateWithOllama({
        baseUrl: args.config.ollama.baseUrl,
        model: args.model ?? args.config.models.tagger,
        system: CLASSIFY_SYSTEM,
        prompt,
        options: optionsFromConfig(args.config, { num_predict: 220 })
    });
    if (!result.ok)
        return fallback;
    const parsed = extractJson(result.text);
    if (!parsed)
        return fallback;
    return {
        tagIds: (parsed.tagIds ?? []).map(Number).filter((n) => VALID_IDS.has(n)),
        keywords: dedupeStrings([...(parsed.keywords ?? []), ...fallback.keywords]).slice(0, 12),
        likelyFiles: dedupeStrings(parsed.likelyFiles ?? []).slice(0, 8),
        likelySymbols: dedupeStrings(parsed.likelySymbols ?? []).slice(0, 8),
        needsTests: parsed.needsTests ?? fallback.needsTests,
        needsTypes: parsed.needsTypes ?? fallback.needsTypes
    };
}
function heuristicClassification(task) {
    const keywords = dedupeStrings(task
        .split(/[^A-Za-z0-9_$.]+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()))).slice(0, 10);
    return {
        tagIds: heuristicTags(task, task),
        keywords,
        likelyFiles: [],
        likelySymbols: keywords.filter((k) => /[A-Z]/.test(k) || k.includes(".")),
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
    const ensure = (fileId) => {
        const f = byId.get(fileId);
        if (!f)
            return undefined;
        let entry = scores.get(fileId);
        if (!entry) {
            entry = { fileId, path: f.path, language: f.language, isTest: !!f.is_test, score: 0, reasons: [] };
            scores.set(fileId, entry);
        }
        return entry;
    };
    const pathToId = new Map(files.map((f) => [f.path, f.id]));
    // 1. ripgrep exact hits.
    const grep = await ripgrepHits(root, classification.keywords, config.index.ignore);
    for (const [filePath, count] of grep) {
        const id = pathToId.get(filePath);
        if (id == null)
            continue;
        const entry = ensure(id);
        if (entry) {
            entry.score += Math.min(8, count) * 3;
            entry.reasons.push(`grep×${count}`);
        }
    }
    // 2. tag overlap.
    if (classification.tagIds.length > 0) {
        const placeholders = classification.tagIds.map(() => "?").join(",");
        const tagRows = db
            .prepare(`SELECT file_id, COUNT(*) AS overlap FROM file_tags WHERE tag_id IN (${placeholders}) GROUP BY file_id`)
            .all(...classification.tagIds);
        for (const row of tagRows) {
            const entry = ensure(row.file_id);
            if (entry) {
                entry.score += row.overlap * 2;
                entry.reasons.push(`tags×${row.overlap}`);
            }
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
            const entry = ensure(f.id);
            if (entry) {
                entry.score += matches * 2;
                entry.reasons.push(`summary×${matches}`);
            }
        }
    }
    // 4. symbol match (name contains keyword or matches likelySymbols).
    const symbolTargets = dedupeStrings([...lowerKeywords, ...classification.likelySymbols.map((s) => s.toLowerCase())]);
    const symbols = db.prepare("SELECT file_id, name, kind, start_line, end_line FROM symbols").all();
    const seedSymbols = [];
    for (const sym of symbols) {
        const lname = sym.name.toLowerCase();
        if (symbolTargets.some((t) => t.length >= 3 && lname.includes(t))) {
            const entry = ensure(sym.file_id);
            if (entry) {
                entry.score += 4;
                entry.reasons.push(`sym:${sym.name}`);
                const f = byId.get(sym.file_id);
                if (f)
                    seedSymbols.push({ name: sym.name, path: f.path, kind: sym.kind, startLine: sym.start_line, endLine: sym.end_line });
            }
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
                const entry = ensure(f.id);
                if (entry) {
                    entry.score += exact ? 12 : basenameMatch ? 10 : 7;
                    entry.reasons.push("hint");
                }
            }
        }
    }
    // 6. task memory: files from past successful similar tasks.
    for (const fileId of memoryFileBoost(db, classification.keywords)) {
        const entry = ensure(fileId);
        if (entry) {
            entry.score += 2;
            entry.reasons.push("memory");
        }
    }
    // 7. graph proximity: expand around current top seeds.
    const seeds = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 5).map((s) => s.fileId);
    const expanded = expandGraph(db, seeds, config.context.graphDepth);
    for (const fileId of expanded) {
        if (!seeds.includes(fileId)) {
            const entry = ensure(fileId);
            if (entry && entry.score === 0) {
                entry.score += 1.5;
                entry.reasons.push("graph");
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
                    const testEntry = ensure(f.id);
                    if (testEntry) {
                        testEntry.score += 1.5;
                        testEntry.reasons.push("test-of-seed");
                    }
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
