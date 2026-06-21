import fs from "node:fs/promises";
import path from "node:path";
import { tryQueueFileOperation } from "../approval/queueOperation.js";
const createFileTool = {
    name: "create_file",
    description: "Create a new file inside the project root. Fails if the file already exists.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Project-relative path for the new file." },
            content: { type: "string", description: "Full content to write into the new file." },
            reason: { type: "string", description: "Why this new file is needed." },
        },
        required: ["path", "content", "reason"],
    },
    mode: "patch",
    async handler(rawArgs, ctx) {
        const args = rawArgs;
        const relPath = typeof args.path === "string" ? args.path.trim() : "";
        const content = typeof args.content === "string" ? args.content : "";
        const reason = typeof args.reason === "string" ? args.reason : "";
        if (!relPath || relPath === ".") {
            return { ok: false, summary: "Invalid path. Use a relative file path like 'helloworld.txt'." };
        }
        if (path.isAbsolute(relPath)) {
            return { ok: false, summary: "Absolute paths are not allowed. Use a relative path." };
        }
        if (relPath.endsWith("/") || relPath.endsWith(path.sep)) {
            return { ok: false, summary: "Directory paths are not allowed for create_file. Use a file path." };
        }
        const absPath = path.resolve(ctx.root, relPath);
        const root = path.resolve(ctx.root);
        if (!absPath.startsWith(root + path.sep) && absPath !== root) {
            return { ok: false, summary: "Path escapes the project root." };
        }
        try {
            const stat = await fs.stat(absPath).catch(() => null);
            if (stat?.isDirectory()) {
                return { ok: false, summary: `"${relPath}" is an existing directory. Use a file path instead.` };
            }
            if (stat) {
                return {
                    ok: false,
                    summary: `"${relPath}" already exists. Use edit to modify it.`,
                    nextActions: ["Use edit with exact search/replace to modify the existing file."],
                };
            }
            // Check if approval queuing is required
            const queueResult = await tryQueueFileOperation({
                config: ctx.config,
                root: ctx.root,
                taskId: ctx.taskId,
                kind: "create_file",
                path: relPath,
                afterText: content,
                reason: reason || "User requested file creation",
            });
            if (queueResult.queued) {
                return queueResult.result;
            }
            await fs.mkdir(path.dirname(absPath), { recursive: true });
            await fs.writeFile(absPath, content, "utf8");
            return {
                ok: true,
                summary: `Created ${relPath} (${Buffer.byteLength(content, "utf8")} bytes): ${reason}`,
                content: `Created: ${relPath}\nReason: ${reason}`,
                metadata: { path: relPath, bytes: Buffer.byteLength(content, "utf8") },
                nextActions: ["Run a relevant check if this is a code file."],
            };
        }
        catch (err) {
            return {
                ok: false,
                summary: `Failed to create "${relPath}": ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
};
export { createFileTool };
