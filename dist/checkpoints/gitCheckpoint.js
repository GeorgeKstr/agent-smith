import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { createCheckpointRecord, getCheckpoint } from "./checkpointStore.js";
export async function isGitRepo(root) {
    try {
        const result = await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, reject: false });
        return result.exitCode === 0 && result.stdout.trim() === "true";
    }
    catch {
        return false;
    }
}
export async function getGitHead(root) {
    try {
        const result = await execa("git", ["rev-parse", "HEAD"], { cwd: root, reject: false });
        if (result.exitCode !== 0)
            return null;
        return result.stdout.trim() || null;
    }
    catch {
        return null;
    }
}
export async function getGitDiff(root) {
    try {
        const result = await execa("git", ["diff", "--binary"], { cwd: root, reject: false });
        return result.stdout;
    }
    catch {
        return "";
    }
}
export async function getChangedFiles(root) {
    try {
        const result = await execa("git", ["diff", "--name-only"], { cwd: root, reject: false });
        if (result.exitCode !== 0)
            return [];
        return result.stdout.split("\n").filter((l) => l.trim());
    }
    catch {
        return [];
    }
}
export async function createGitCheckpoint(args) {
    const { root, db, label, taskId } = args;
    if (!(await isGitRepo(root))) {
        return createCheckpointRecord(db, {
            label,
            taskId,
            gitHead: null,
            dirtyBefore: false,
            files: [],
            preDiffPath: null
        });
    }
    const gitHead = await getGitHead(root);
    const diff = await getGitDiff(root);
    const files = await getChangedFiles(root);
    const dirtyBefore = diff.trim().length > 0;
    const checkpointId = `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const checkpointDir = path.join(root, ".agent", "checkpoints", checkpointId);
    await fs.mkdir(checkpointDir, { recursive: true });
    const preDiffPath = `.agent/checkpoints/${checkpointId}/pre.diff`;
    await fs.writeFile(path.join(root, preDiffPath), diff, "utf8");
    if (gitHead) {
        await fs.writeFile(path.join(checkpointDir, "head.txt"), gitHead, "utf8");
    }
    return createCheckpointRecord(db, {
        id: checkpointId,
        label,
        taskId,
        gitHead,
        dirtyBefore,
        files,
        preDiffPath
    });
}
export async function revertCheckpoint(args) {
    const { root, db, id } = args;
    const cp = getCheckpoint(db, id);
    if (!cp) {
        return { ok: false, message: `Checkpoint not found: ${id}`, files: [] };
    }
    if (!(await isGitRepo(root))) {
        return { ok: false, message: "Not a Git repository. Revert requires Git.", files: [] };
    }
    if (cp.appliedDiffPath) {
        try {
            const diffPath = path.join(root, cp.appliedDiffPath);
            const diffContent = await fs.readFile(diffPath, "utf8");
            const tmpPath = path.join(root, ".agent", "checkpoints", `${id}_revert.diff`);
            await fs.writeFile(tmpPath, diffContent, "utf8");
            const result = await execa("git", ["apply", "-R", tmpPath], { cwd: root, reject: false });
            await fs.unlink(tmpPath).catch(() => { });
            if (result.exitCode !== 0) {
                return { ok: false, message: `git apply -R failed: ${result.stderr || result.stdout}`, files: [] };
            }
            return { ok: true, message: "Reverted applied diff.", files: cp.files };
        }
        catch (err) {
            return { ok: false, message: `Revert error: ${err instanceof Error ? err.message : String(err)}`, files: [] };
        }
    }
    return { ok: false, message: "Checkpoint has no applied diff to revert yet.", files: [] };
}
