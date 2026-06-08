function makeId() {
    return `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
export function createCheckpointRecord(db, input) {
    const now = Date.now();
    const files = input.files ?? [];
    const checkpoint = {
        id: input.id ?? makeId(),
        taskId: input.taskId ?? null,
        label: input.label,
        gitHead: input.gitHead ?? null,
        dirtyBefore: input.dirtyBefore,
        files,
        preDiffPath: input.preDiffPath ?? null,
        appliedDiffPath: input.appliedDiffPath ?? null,
        createdAt: now
    };
    db.prepare(`
    INSERT INTO checkpoints (id, task_id, label, git_head, dirty_before, files_json, pre_diff_path, applied_diff_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(checkpoint.id, checkpoint.taskId, checkpoint.label, checkpoint.gitHead, checkpoint.dirtyBefore ? 1 : 0, JSON.stringify(files), checkpoint.preDiffPath, checkpoint.appliedDiffPath, checkpoint.createdAt);
    return checkpoint;
}
export function listCheckpoints(db) {
    const rows = db.prepare("SELECT * FROM checkpoints ORDER BY created_at DESC").all();
    return rows.map(rowToCheckpoint);
}
export function getCheckpoint(db, id) {
    const row = db.prepare("SELECT * FROM checkpoints WHERE id = ?").get(id);
    if (!row)
        return undefined;
    return rowToCheckpoint(row);
}
export function updateCheckpointAppliedDiff(db, id, appliedDiffPath, files) {
    db.prepare("UPDATE checkpoints SET applied_diff_path = ?, files_json = ? WHERE id = ?").run(appliedDiffPath, JSON.stringify(files), id);
    return getCheckpoint(db, id);
}
export function deleteCheckpoint(db, id) {
    const result = db.prepare("DELETE FROM checkpoints WHERE id = ?").run(id);
    return result.changes > 0;
}
function rowToCheckpoint(row) {
    let files = [];
    try {
        files = JSON.parse(row.files_json);
    }
    catch { /* keep empty */ }
    return {
        id: row.id,
        taskId: row.task_id,
        label: row.label,
        gitHead: row.git_head,
        dirtyBefore: !!row.dirty_before,
        files,
        preDiffPath: row.pre_diff_path,
        appliedDiffPath: row.applied_diff_path,
        createdAt: row.created_at
    };
}
