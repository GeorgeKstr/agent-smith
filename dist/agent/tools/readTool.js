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
        const editGuidance = `\n\nEdit guidance:
If this file needs changes, your next action should be:

For known exact text:
<tool_call>
{"tool":"edit","args":{"path":"${rel}","search":"exact old text from above","replace":"new text","reason":"explain why"}}
</tool_call>

For uncertain exact text, use propose_edit first:
<tool_call>
{"tool":"propose_edit","args":{"path":"${rel}","target":"function or block name","intent":"what behavior to implement","proposedChange":"plain-English description of the change","reason":"why this change is needed"}}
</tool_call>`;
        const isCssFile = rel.endsWith(".css") || rel.endsWith(".scss") || rel.endsWith(".less");
        const styleGuidance = isCssFile ? `\n\nStyle file guidance:
This is a stylesheet. For visual/style changes (color, background, font, etc.):
- Use edit to change an existing CSS rule if it exists.
- Use append_to_file to add a new CSS rule if no matching selector is found.
- After reading a stylesheet, you should edit it — do NOT search for more files.

Example:
<tool_call>
{"tool":"edit","args":{"path":"${rel}","search":"body {","replace":"body {\\n  background: red;","reason":"Make background red"}}
</tool_call>

Or append a new rule:
<tool_call>
{"tool":"append_to_file","args":{"path":"${rel}","content":"\\nbody {\\n  background: red;\\n}","reason":"Add body background rule"}}
</tool_call>` : "";
        const nextActions = [];
        if (truncated) {
            nextActions.push(`Read remaining lines with startLine: ${endLine + 1}`);
        }
        nextActions.push("If this file contains the requested change, call propose_edit, edit, or replace_lines.", "Use exact old text from the content above. The 'search' field in edit must match exactly.", "If unsure of exact text, use propose_edit to describe the change first.", "Do not search again unless this file explicitly references another file you need to inspect.");
        return {
            ok: true,
            summary: `Read ${rel}:${startLine}-${endLine} (${selected.length}/${totalLines} lines)${truncatedNote}`,
            content: numbered + editGuidance + styleGuidance,
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
