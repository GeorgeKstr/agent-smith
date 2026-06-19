import fs from "node:fs/promises";
import path from "node:path";
const MAX_READ_LINES = 160;
const MAX_READ_CHARS = 6000;
const readTool = {
    name: "read",
    description: "Read a narrow line window or symbol from a project file.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative project path to read." },
            startLine: {
                type: "number",
                description: "1-based start line. Defaults to 1.",
            },
            endLine: {
                type: "number",
                description: "1-based end line (inclusive). Defaults to startLine + 160.",
            },
            symbol: {
                type: "string",
                description: "Optional symbol name to read around.",
            },
        },
        required: ["path"],
    },
    mode: "readonly",
    async handler(rawArgs, ctx) {
        const args = rawArgs;
        const relPath = typeof args.path === "string" ? args.path.trim() : "";
        if (!relPath)
            return { ok: false, summary: "No path provided." };
        if (relPath === ".") {
            return {
                ok: false,
                summary: `Cannot read ".": it is a directory. Use search to list files.`,
                nextActions: ["Use search to find files", "Use create_file to create a new file"],
            };
        }
        const fullPath = path.resolve(ctx.root, relPath);
        const rel = path.relative(ctx.root, fullPath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            return { ok: false, summary: `Path outside project root: ${relPath}` };
        }
        // Check if path is a directory
        try {
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                return {
                    ok: false,
                    summary: `"${relPath}" is a directory. Use search to list its contents.`,
                    nextActions: ["Use search to find files"],
                };
            }
        }
        catch {
            return {
                ok: false,
                summary: `"${relPath}" does not exist. To create it, use create_file.`,
                nextActions: ["Use create_file if the task is to create this file", "Use search if you need to find an existing file"],
            };
        }
        let content;
        try {
            content = await fs.readFile(fullPath, "utf8");
        }
        catch {
            return { ok: false, summary: `Cannot read "${relPath}": file could not be opened.` };
        }
        const lines = content.split("\n");
        const totalLines = lines.length;
        let startLine = 1;
        let endLine = totalLines;
        const symbol = typeof args.symbol === "string" ? args.symbol.trim() : "";
        if (symbol) {
            const row = ctx.db
                .prepare(`SELECT start_line, end_line FROM symbols s
           JOIN files f ON f.id = s.file_id
           WHERE f.path = ? AND s.name = ?
           LIMIT 1`)
                .get(rel, symbol);
            if (row) {
                startLine = Math.max(1, row.start_line - 3);
                endLine = Math.min(totalLines, row.end_line + 2);
            }
        }
        if (typeof args.startLine === "number" && Number.isFinite(args.startLine)) {
            startLine = Math.max(1, Math.floor(args.startLine));
        }
        if (typeof args.endLine === "number" && Number.isFinite(args.endLine)) {
            endLine = Math.min(totalLines, Math.floor(args.endLine));
        }
        else if (!symbol) {
            endLine = Math.min(totalLines, startLine + MAX_READ_LINES - 1);
        }
        const rangeSize = endLine - startLine + 1;
        let truncated = false;
        if (rangeSize > MAX_READ_LINES) {
            endLine = startLine + MAX_READ_LINES - 1;
            truncated = true;
        }
        const selected = lines.slice(startLine - 1, endLine);
        const numbered = selected
            .map((l, i) => `${String(startLine + i).padStart(4, " ")}| ${l}`)
            .join("\n");
        const charCount = numbered.length;
        if (charCount > MAX_READ_CHARS) {
            truncated = true;
        }
        const truncatedNote = truncated ? ` [truncated: showing lines ${startLine}-${endLine}]` : "";
        const nextActions = [];
        if (truncated) {
            nextActions.push(`Read remaining lines with startLine: ${endLine + 1}`);
        }
        return {
            ok: true,
            summary: `Read ${rel}:${startLine}-${endLine} (${selected.length}/${totalLines} lines)${truncatedNote}`,
            content: numbered,
            truncated,
            metadata: {
                path: rel,
                startLine,
                endLine,
                totalLines,
            },
            nextActions: nextActions.length > 0 ? nextActions : undefined,
        };
    },
};
export { readTool };
export { MAX_READ_LINES, MAX_READ_CHARS };
