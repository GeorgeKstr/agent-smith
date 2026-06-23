import fs from "node:fs/promises";
import path from "node:path";
import { buildUnifiedDiffFromEdit } from "../editDiff.js";
import { checkPatchSafety } from "../safety.js";
import { tryQueueFileOperation } from "../approval/queueOperation.js";
const editTool = {
    name: "edit",
    description: "Apply a controlled search/replace edit to one file.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative project path to edit." },
            search: { type: "string", description: "Exact text to find and replace." },
            replace: { type: "string", description: "Replacement text." },
            reason: { type: "string", description: "Why this edit is needed." },
        },
        required: ["path", "search", "replace", "reason"],
    },
    mode: "patch",
    async handler(rawArgs, ctx) {
        const args = rawArgs;
        const relPath = typeof args.path === "string" ? args.path.trim() : "";
        const search = typeof args.search === "string" ? args.search : "";
        const replace = typeof args.replace === "string" ? args.replace : "";
        const reason = typeof args.reason === "string" ? args.reason : "";
        if (!relPath)
            return { ok: false, summary: "No path provided." };
        if (!search)
            return { ok: false, summary: "No search text provided." };
        const fullPath = path.resolve(ctx.root, relPath);
        const rel = path.relative(ctx.root, fullPath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            return { ok: false, summary: `Path outside project root: ${relPath}` };
        }
        // Read-before-edit enforcement (skip for non-existent files — those need create_file)
        const fileExists = await fs.access(fullPath).then(() => true).catch(() => false);
        if (!fileExists) {
            return {
                ok: false,
                summary: `File does not exist: ${relPath}. Use create_file to create it.`,
                nextActions: [`create_file path="${relPath}" content="..."`],
            };
        }
        const wasRead = ctx.memory?.filesRead?.some((f) => f.path === rel || rel.endsWith("/" + f.path) || f.path.endsWith("/" + rel));
        if (!wasRead) {
            return {
                ok: false,
                summary: `Cannot edit ${relPath}: file must be read first. Call 'read' on it, then retry.`,
                nextActions: [`read path="${relPath}"`],
            };
        }
        let before;
        try {
            before = await fs.readFile(fullPath, "utf8");
        }
        catch {
            return { ok: false, summary: `Cannot read file: ${relPath}` };
        }
        const lines = before.split("\n");
        if (lines.length > ctx.config.safety.maxPatchLines) {
            return {
                ok: false,
                summary: `File exceeds safety line limit (${ctx.config.safety.maxPatchLines}): ${relPath} (${lines.length} lines)`,
            };
        }
        const occurrences = countOccurrences(before, search);
        if (occurrences === 0) {
            return { ok: false, summary: `Search text not found in ${relPath}.` };
        }
        if (occurrences > 1) {
            return {
                ok: false,
                summary: `Search text found ${occurrences} times in ${relPath}. Provide a more specific search to target a single occurrence.`,
            };
        }
        const after = before.replace(search, replace);
        if (after === before) {
            return { ok: false, summary: "No changes made (search equals replace)." };
        }
        // Build unified diff and run safety checks
        const diff = buildUnifiedDiffFromEdit({ path: rel, before, after });
        const changedLines = Math.abs(before.split("\n").length - after.split("\n").length);
        const safety = checkPatchSafety({ root: ctx.root, config: ctx.config, files: [rel], changedLines });
        if (!safety.ok) {
            return { ok: false, summary: `Safety check failed: ${safety.violations.join("; ")}` };
        }
        // Check if approval queuing is required
        const queueResult = await tryQueueFileOperation({
            config: ctx.config,
            root: ctx.root,
            taskId: ctx.taskId,
            kind: "edit_file",
            path: relPath,
            beforeText: search,
            afterText: replace,
            diff,
            reason: reason || "edit requested",
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
        const insertionsPerLine = lines.filter((l, i) => {
            const afterLines = after.split("\n");
            return afterLines[i] !== l;
        }).length;
        return {
            ok: true,
            summary: `Applied edit to ${relPath}: ${reason} (${insertionsPerLine} line(s) changed)`,
            content: diff,
            metadata: {
                path: relPath,
                reason,
                searchLength: search.length,
                replaceLength: replace.length,
            },
            nextActions: ["Run check to verify the change."],
        };
    },
};
function countOccurrences(text, search) {
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(search, pos)) !== -1) {
        count++;
        pos += search.length || 1;
    }
    return count;
}
export { editTool };
