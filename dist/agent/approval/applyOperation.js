import fs from "node:fs/promises";
import path from "node:path";
import { riskForKind } from "./approvalTypes.js";
export async function applyApprovedOperation(input) {
    const { operation, root } = input;
    if (operation.status !== "approved") {
        return { ok: false, summary: `Operation ${operation.id} is not approved (status: ${operation.status}).` };
    }
    const fullPath = path.resolve(root, operation.path);
    const rel = path.relative(root, fullPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        await input.store.markFailed(operation.id, `Path outside project root: ${operation.path}`);
        return { ok: false, summary: `Path outside project root: ${operation.path}` };
    }
    try {
        switch (operation.kind) {
            case "create_file": {
                if (!operation.afterText) {
                    await input.store.markFailed(operation.id, "No content for file creation.");
                    return { ok: false, summary: "No content for file creation." };
                }
                try {
                    await fs.access(fullPath);
                    await input.store.markFailed(operation.id, "File already exists.");
                    return { ok: false, summary: `File already exists: ${operation.path}` };
                }
                catch {
                    // File doesn't exist, proceed
                }
                const dir = path.dirname(fullPath);
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(fullPath, operation.afterText, "utf8");
                await input.store.markApplied(operation.id);
                return { ok: true, summary: `Created ${operation.path}`, path: rel };
            }
            case "edit_file":
            case "replace_lines": {
                let current;
                try {
                    current = await fs.readFile(fullPath, "utf8");
                }
                catch {
                    await input.store.markFailed(operation.id, `Cannot read file: ${operation.path}`);
                    return { ok: false, summary: `Cannot read file: ${operation.path}` };
                }
                if (operation.beforeText && !current.includes(operation.beforeText)) {
                    await input.store.markFailed(operation.id, "File content no longer matches. The file may have been changed since the edit was proposed.");
                    return { ok: false, summary: `File content no longer matches for ${operation.path}.` };
                }
                if (!operation.afterText) {
                    await input.store.markFailed(operation.id, "No replacement text.");
                    return { ok: false, summary: "No replacement text for edit." };
                }
                const maxLines = input.maxLines ?? 5000;
                if (current.split("\n").length > maxLines) {
                    await input.store.markFailed(operation.id, `File exceeds ${maxLines} lines.`);
                    return { ok: false, summary: `File ${operation.path} exceeds ${maxLines} lines.` };
                }
                const search = operation.beforeText ?? "";
                if (search && !current.includes(search)) {
                    await input.store.markFailed(operation.id, "Search text not found in file.");
                    return { ok: false, summary: `Search text not found in ${operation.path}.` };
                }
                const after = search
                    ? current.replace(search, operation.afterText)
                    : operation.afterText;
                await fs.writeFile(fullPath, after, "utf8");
                await input.store.markApplied(operation.id);
                return { ok: true, summary: `Applied edit to ${operation.path}`, path: rel };
            }
            case "delete_file": {
                try {
                    await fs.access(fullPath);
                }
                catch {
                    await input.store.markFailed(operation.id, "File does not exist.");
                    return { ok: false, summary: `File does not exist: ${operation.path}` };
                }
                await fs.rm(fullPath);
                await input.store.markApplied(operation.id);
                return { ok: true, summary: `Deleted ${operation.path}`, path: rel };
            }
            case "rename_file": {
                if (!operation.newPath) {
                    await input.store.markFailed(operation.id, "No new path for rename.");
                    return { ok: false, summary: "No new path for rename." };
                }
                const newFullPath = path.resolve(root, operation.newPath);
                await fs.rename(fullPath, newFullPath);
                await input.store.markApplied(operation.id);
                return { ok: true, summary: `Renamed ${operation.path} to ${operation.newPath}`, path: rel };
            }
            case "move_file": {
                if (!operation.newPath) {
                    await input.store.markFailed(operation.id, "No target path for move.");
                    return { ok: false, summary: "No target path for move." };
                }
                const targetFullPath = path.resolve(root, operation.newPath);
                const targetDir = path.dirname(targetFullPath);
                await fs.mkdir(targetDir, { recursive: true });
                await fs.rename(fullPath, targetFullPath);
                await input.store.markApplied(operation.id);
                return { ok: true, summary: `Moved ${operation.path} to ${operation.newPath}`, path: rel };
            }
            default:
                await input.store.markFailed(operation.id, `Unknown operation kind: ${operation.kind}`);
                return { ok: false, summary: `Unknown operation kind: ${operation.kind}` };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await input.store.markFailed(operation.id, msg);
        return { ok: false, summary: `Failed to apply ${operation.kind} on ${operation.path}: ${msg}` };
    }
}
export function buildOperationFromEditInput(input) {
    return {
        kind: input.kind,
        risk: riskForKind(input.kind),
        path: input.path,
        beforeText: input.beforeText,
        afterText: input.afterText,
        diff: input.diff,
        newPath: input.newPath,
        reason: input.reason,
        taskId: input.taskId,
    };
}
