import fs from "node:fs/promises";
import path from "node:path";
import { tryQueueFileOperation } from "../approval/queueOperation.js";
const appendToFileTool = {
    name: "append_to_file",
    description: "Append content to the end of an existing file. Use to add new CSS rules, config entries, or imports.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Project-relative path." },
            content: { type: "string", description: "Content to append to the end of the file." },
            reason: { type: "string", description: "Why this append is needed." },
        },
        required: ["path", "content", "reason"],
    },
    mode: "patch",
    async handler(rawArgs, ctx) {
        const args = rawArgs;
        const relPath = typeof args.path === "string" ? args.path.trim() : "";
        const content = typeof args.content === "string" ? args.content : "";
        const reason = typeof args.reason === "string" ? args.reason : "";
        if (!relPath)
            return { ok: false, summary: "No path provided." };
        const fullPath = path.resolve(ctx.root, relPath);
        const rel = path.relative(ctx.root, fullPath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            return { ok: false, summary: `Path outside project root: ${relPath}` };
        }
        let before;
        try {
            before = await fs.readFile(fullPath, "utf8");
        }
        catch {
            return { ok: false, summary: `Cannot read file: ${relPath}` };
        }
        const after = before + (before.endsWith("\n") ? "" : "\n") + content + "\n";
        const queueResult = await tryQueueFileOperation({
            config: ctx.config,
            root: ctx.root,
            taskId: ctx.taskId,
            kind: "edit_file",
            path: relPath,
            beforeText: "",
            afterText: after,
            diff: `+${content.split("\n").length} lines appended to ${relPath}`,
            reason: reason || "append content",
        });
        if (queueResult.queued) {
            return queueResult.result;
        }
        try {
            await fs.writeFile(fullPath, after, "utf8");
        }
        catch (err) {
            return {
                ok: false,
                summary: `Failed to write ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        return {
            ok: true,
            summary: `Appended to ${relPath}: ${reason}`,
            content: `Appended ${content.split("\n").filter(Boolean).length} line(s) to ${relPath}`,
            metadata: { path: relPath, appendedLines: content.split("\n").filter(Boolean).length },
            nextActions: ["Run a relevant check if this is a code file."],
        };
    },
};
export { appendToFileTool };
