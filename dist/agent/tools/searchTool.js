import { execa } from "execa";
const MAX_RESULTS = 8;
const MAX_PREVIEW_CHARS = 200;
const ESTIMATED_LINE_COUNT = 200;
export const searchTool = {
    name: "search",
    description: "Search the project for files, text, or symbols. Returns compact leads with suggested read calls.",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Specific search query. Use function names, symbols, component names, or error messages." },
            kind: {
                type: "string",
                enum: ["all", "text", "file", "symbol", "summary"],
                description: "What to search. Defaults to 'all'.",
            },
            maxResults: {
                type: "number",
                description: "Maximum results. Defaults to 8.",
            },
            reason: {
                type: "string",
                description: "Required if a file has already been read. Explain why another search is needed."
            },
        },
        required: ["query"],
    },
    mode: "readonly",
    async handler(rawArgs, ctx) {
        const args = rawArgs;
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query)
            return { ok: false, summary: "No query provided." };
        const kind = typeof args.kind === "string" ? args.kind : "all";
        const maxResults = typeof args.maxResults === "number" && Number.isFinite(args.maxResults)
            ? Math.min(Math.max(1, Math.floor(args.maxResults)), 20)
            : MAX_RESULTS;
        const fileResults = [];
        const symbolResults = [];
        const textResults = [];
        const summaryResults = [];
        if (kind === "all" || kind === "file") {
            const like = `%${query}%`;
            const rows = ctx.db
                .prepare(`SELECT path, language, COALESCE(summary, '') as summary
           FROM files
           WHERE path LIKE ? OR summary LIKE ?
           ORDER BY CASE WHEN path LIKE ? THEN 0 ELSE 1 END, length(path)
           LIMIT ?`)
                .all(like, like, like, Math.ceil(maxResults / 2));
            for (const row of rows) {
                fileResults.push({
                    path: row.path,
                    language: row.language || "?",
                    reason: row.summary ? `contains ${row.summary.slice(0, 100)}` : "name matches query"
                });
            }
        }
        if (kind === "all" || kind === "symbol") {
            const like = `%${query}%`;
            const rows = ctx.db
                .prepare(`SELECT s.name, s.kind, s.start_line, f.path
           FROM symbols s
           JOIN files f ON f.id = s.file_id
           WHERE s.name LIKE ? OR COALESCE(s.signature, '') LIKE ?
           ORDER BY length(s.name), f.path
           LIMIT ?`)
                .all(like, like, Math.ceil(maxResults / 2));
            for (const row of rows) {
                symbolResults.push(row);
            }
        }
        if (kind === "all" || kind === "summary") {
            const like = `%${query}%`;
            const rows = ctx.db
                .prepare(`SELECT path, summary FROM files WHERE summary IS NOT NULL AND summary LIKE ? ORDER BY length(path) LIMIT ?`)
                .all(like, Math.ceil(maxResults / 3));
            for (const row of rows) {
                summaryResults.push(row);
            }
        }
        if (kind === "all" || kind === "text") {
            try {
                const { stdout } = await execa("rg", [
                    "--no-heading",
                    "--line-number",
                    "--max-count=3",
                    "-e",
                    escapeRegex(query),
                    ".",
                ], { cwd: ctx.root, reject: false, timeout: 10_000 });
                const lines = stdout.split("\n").filter(Boolean);
                let added = 0;
                for (const line of lines) {
                    if (added >= Math.ceil(maxResults / 2))
                        break;
                    const colon1 = line.indexOf(":");
                    const colon2 = line.indexOf(":", colon1 + 1);
                    if (colon2 === -1) {
                        textResults.push(line.slice(0, MAX_PREVIEW_CHARS));
                    }
                    else {
                        const file = line.slice(0, colon1);
                        const ln = line.slice(colon1 + 1, colon2);
                        const content = line.slice(colon2 + 1).slice(0, MAX_PREVIEW_CHARS);
                        textResults.push(`${file}:${ln} - ${content}`);
                    }
                    added++;
                }
                for (const t of textResults) {
                    const colon1 = t.indexOf(":");
                    const file = colon1 > 0 ? t.slice(0, colon1) : null;
                    if (file && !fileResults.some((f) => f.path === file)) {
                        fileResults.push({ path: file, language: "?", reason: "contains matching text" });
                    }
                }
            }
            catch {
                // ripgrep not available
            }
        }
        const seenPaths = new Set();
        const mergedFileResults = fileResults.filter((f) => {
            if (seenPaths.has(f.path))
                return false;
            seenPaths.add(f.path);
            return true;
        }).slice(0, maxResults);
        if (mergedFileResults.length === 0 && symbolResults.length === 0 && summaryResults.length === 0) {
            return {
                ok: true,
                summary: `No results found for "${query}" (kind: ${kind}).`,
                nextActions: [
                    "Try a different query or broader kind.",
                    "Use final to report that no relevant file was found."
                ],
            };
        }
        const parts = [];
        let resultNum = 0;
        for (const f of mergedFileResults) {
            resultNum++;
            const startLine = 1;
            const endLine = ESTIMATED_LINE_COUNT;
            parts.push(`${resultNum}. ${f.path} (${f.language})`);
            parts.push(`   Reason: ${f.reason}`);
            parts.push(`   Suggested read:`);
            parts.push(`   <tool_call>`);
            parts.push(`   {"tool":"read","args":{"path":"${f.path}","startLine":${startLine},"endLine":${endLine}}}`);
            parts.push(`   </tool_call>`);
        }
        for (const s of symbolResults.slice(0, maxResults - mergedFileResults.length)) {
            resultNum++;
            const startLine = Math.max(1, s.start_line - 5);
            const endLine = s.start_line + 60;
            parts.push(`${resultNum}. SYMBOL: ${s.name} (${s.kind}) @ ${s.path}:${s.start_line}`);
            parts.push(`   Suggested read:`);
            parts.push(`   <tool_call>`);
            parts.push(`   {"tool":"read","args":{"path":"${s.path}","startLine":${startLine},"endLine":${endLine}}}`);
            parts.push(`   </tool_call>`);
        }
        for (const s of summaryResults.slice(0, maxResults - resultNum)) {
            resultNum++;
            parts.push(`${resultNum}. SUMMARY: ${s.path} - ${s.summary.slice(0, MAX_PREVIEW_CHARS)}`);
            parts.push(`   Suggested read:`);
            parts.push(`   <tool_call>`);
            parts.push(`   {"tool":"read","args":{"path":"${s.path}","startLine":1,"endLine":${ESTIMATED_LINE_COUNT}}}`);
            parts.push(`   </tool_call>`);
        }
        return {
            ok: true,
            summary: `Found ${resultNum} result(s) for "${query}":`,
            content: parts.join("\n"),
            nextActions: [
                "Read one of the suggested files above using the suggested read call.",
                "Do not search again unless these results are irrelevant.",
                "If no result is relevant, use final and explain that no relevant file was found."
            ],
        };
    },
};
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
