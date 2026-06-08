import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { isGitRepo, createGitCheckpoint } from "../checkpoints/gitCheckpoint.js";
import { updateCheckpointAppliedDiff } from "../checkpoints/checkpointStore.js";
import { getChangeSet, listChangedFiles, updateChangeSetStatus, updateChangeSetCheckpoint, getAcceptedHunkRefs } from "./changeSetStore.js";
import { filterDiffToFiles } from "./diffFilter.js";
import { buildAcceptedHunksDiff } from "./hunkDiffBuilder.js";
export async function applyAcceptedChangeSet(args) {
    const { root, db, indexer, changeSetId } = args;
    const cs = getChangeSet(db, changeSetId);
    if (!cs) {
        return { ok: false, message: `Change set not found: ${changeSetId}`, files: [] };
    }
    const fileReviews = listChangedFiles(db, changeSetId);
    const acceptedPaths = cs.status === "accepted"
        ? fileReviews.map((f) => f.path)
        : fileReviews.filter((f) => f.status === "accepted").map((f) => f.path);
    if (acceptedPaths.length === 0) {
        return { ok: false, message: "No accepted files to apply.", files: [] };
    }
    const filteredDiff = filterDiffToFiles(cs.diff, acceptedPaths);
    if (!filteredDiff.trim()) {
        return { ok: false, message: "Accepted files produced an empty diff.", files: [] };
    }
    if (!(await isGitRepo(root))) {
        return { ok: false, message: "Not a Git repository. Apply requires Git.", files: [] };
    }
    const cp = await createGitCheckpoint({
        root,
        db,
        label: `before applying change set ${changeSetId}`
    });
    const changesDir = path.join(root, ".agent", "changes", changeSetId);
    await fs.mkdir(changesDir, { recursive: true });
    const appliedDiffPath = `.agent/changes/${changeSetId}/accepted.diff`;
    await fs.writeFile(path.join(root, appliedDiffPath), filteredDiff, "utf8");
    const checkResult = await execa("git", ["apply", "--check", appliedDiffPath], { cwd: root, reject: false });
    if (checkResult.exitCode !== 0) {
        return {
            ok: false,
            message: `git apply --check failed: ${checkResult.stderr || checkResult.stdout}`,
            files: acceptedPaths,
            checkpointId: cp.id
        };
    }
    const applyResult = await execa("git", ["apply", appliedDiffPath], { cwd: root, reject: false });
    if (applyResult.exitCode !== 0) {
        return {
            ok: false,
            message: `git apply failed: ${applyResult.stderr || applyResult.stdout}`,
            files: acceptedPaths,
            checkpointId: cp.id
        };
    }
    updateCheckpointAppliedDiff(db, cp.id, appliedDiffPath, acceptedPaths);
    updateChangeSetStatus(db, changeSetId, "applied");
    if (indexer) {
        await indexer.reindexPaths(acceptedPaths);
    }
    return {
        ok: true,
        message: `Applied change set ${changeSetId}.`,
        files: acceptedPaths,
        checkpointId: cp.id
    };
}
export async function validateAcceptedHunksDiff(args) {
    const { root, db, changeSetId } = args;
    const cs = getChangeSet(db, changeSetId);
    if (!cs) {
        return { ok: false, message: `Change set not found: ${changeSetId}`, diff: "", files: [] };
    }
    const refs = getAcceptedHunkRefs(db, changeSetId);
    if (refs.length === 0) {
        return { ok: false, message: "No accepted hunks to validate.", diff: "", files: [] };
    }
    const diff = buildAcceptedHunksDiff({ originalDiff: cs.diff, acceptedHunks: refs });
    if (!diff.trim()) {
        return { ok: false, message: "No accepted hunks to validate.", diff: "", files: [] };
    }
    const dir = path.join(root, ".agent", "changes", changeSetId);
    await fs.mkdir(dir, { recursive: true });
    const previewPath = path.join(dir, "accepted-hunks.preview.diff");
    await fs.writeFile(previewPath, diff, "utf8");
    const files = [...new Set(refs.map((r) => r.path))];
    if (!(await isGitRepo(root))) {
        return { ok: true, message: "Not a Git repo; diff generated but not validated.", diff, files };
    }
    const result = await execa("git", ["apply", "--check", previewPath], { cwd: root, reject: false });
    if (result.exitCode !== 0) {
        return {
            ok: false,
            message: `Partial hunk diff does not apply cleanly: ${result.stderr || result.stdout}. Use file-level apply or accept the full file.`,
            diff,
            files
        };
    }
    return { ok: true, message: "Accepted hunks diff validates.", diff, files };
}
export async function applyAcceptedHunksChangeSet(args) {
    const { root, db, indexer, changeSetId } = args;
    const cs = getChangeSet(db, changeSetId);
    if (!cs) {
        return { ok: false, message: `Change set not found: ${changeSetId}`, files: [] };
    }
    const refs = getAcceptedHunkRefs(db, changeSetId);
    if (refs.length === 0) {
        return { ok: false, message: "No accepted hunks to apply.", files: [] };
    }
    const diff = buildAcceptedHunksDiff({ originalDiff: cs.diff, acceptedHunks: refs });
    if (!diff.trim()) {
        return { ok: false, message: "Accepted hunks produced an empty diff.", files: [] };
    }
    if (!(await isGitRepo(root))) {
        return { ok: false, message: "Not a Git repository. Apply requires Git.", files: [] };
    }
    const dir = path.join(root, ".agent", "changes", changeSetId);
    await fs.mkdir(dir, { recursive: true });
    const diffPath = `.agent/changes/${changeSetId}/accepted-hunks.diff`;
    await fs.writeFile(path.join(root, diffPath), diff, "utf8");
    const checkResult = await execa("git", ["apply", "--check", diffPath], { cwd: root, reject: false });
    if (checkResult.exitCode !== 0) {
        return {
            ok: false,
            message: `Accepted hunks diff does not apply cleanly: ${checkResult.stderr || checkResult.stdout}. Use file-level apply or accept the full file.`,
            files: [...new Set(refs.map((r) => r.path))],
            diffPath
        };
    }
    const cp = await createGitCheckpoint({
        root,
        db,
        label: `before applying accepted hunks for change set ${changeSetId}`
    });
    const applyResult = await execa("git", ["apply", diffPath], { cwd: root, reject: false });
    if (applyResult.exitCode !== 0) {
        return {
            ok: false,
            message: `git apply failed: ${applyResult.stderr || applyResult.stdout}`,
            files: [...new Set(refs.map((r) => r.path))],
            checkpointId: cp.id,
            diffPath
        };
    }
    const files = [...new Set(refs.map((r) => r.path))];
    updateCheckpointAppliedDiff(db, cp.id, diffPath, files);
    updateChangeSetStatus(db, changeSetId, "applied");
    updateChangeSetCheckpoint(db, changeSetId, cp.id);
    if (indexer) {
        await indexer.reindexPaths(files);
    }
    return {
        ok: true,
        message: `Applied accepted hunks from change set ${changeSetId}.\nApplied accepted hunks only. If anything looks wrong, run: smith changes revert ${changeSetId}`,
        files,
        checkpointId: cp.id,
        diffPath
    };
}
