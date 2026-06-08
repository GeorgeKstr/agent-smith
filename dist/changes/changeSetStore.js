import { parseUnifiedDiff } from "./diffParser.js";
function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function computeSetStatus(db, changeSetId) {
    const rows = db.prepare("SELECT status FROM changed_files WHERE change_set_id = ?").all(changeSetId);
    if (rows.length === 0)
        return "proposed";
    const accepted = rows.filter((r) => r.status === "accepted").length;
    const rejected = rows.filter((r) => r.status === "rejected").length;
    const pending = rows.filter((r) => r.status === "pending").length;
    if (pending === rows.length)
        return "proposed";
    if (accepted === rows.length)
        return "accepted";
    if (rejected === rows.length)
        return "rejected";
    return "partially_accepted";
}
export function createChangeSet(db, input) {
    const now = Date.now();
    const id = makeId("change");
    const status = input.status ?? "proposed";
    const changeSet = {
        id,
        taskId: input.taskId ?? null,
        checkpointId: input.checkpointId ?? null,
        diff: input.diff,
        status,
        summary: input.summary ?? null,
        createdAt: now,
        updatedAt: now
    };
    db.prepare(`
    INSERT INTO change_sets (id, task_id, checkpoint_id, diff, status, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(changeSet.id, changeSet.taskId, changeSet.checkpointId, changeSet.diff, changeSet.status, changeSet.summary, changeSet.createdAt, changeSet.updatedAt);
    const parsed = parseUnifiedDiff(input.diff);
    const insertFile = db.prepare(`
    INSERT INTO changed_files (id, change_set_id, path, status, additions, deletions)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    const insertHunk = db.prepare(`
    INSERT INTO changed_hunks (id, change_set_id, changed_file_id, path, hunk_index, header, status, old_start, old_lines, new_start, new_lines, additions, deletions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    for (const file of parsed.files) {
        const fileId = makeId("changed_file");
        const fileAdditions = file.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0);
        const fileDeletions = file.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "delete").length, 0);
        insertFile.run(fileId, id, file.path, "pending", fileAdditions, fileDeletions);
        for (let i = 0; i < file.hunks.length; i++) {
            const hunk = file.hunks[i];
            const hunkAdditions = hunk.lines.filter((l) => l.type === "add").length;
            const hunkDeletions = hunk.lines.filter((l) => l.type === "delete").length;
            insertHunk.run(makeId("hunk"), id, fileId, file.path, i, hunk.header, "pending", hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines, hunkAdditions, hunkDeletions);
        }
    }
    return changeSet;
}
export function listChangeSets(db, opts) {
    let sql = "SELECT * FROM change_sets WHERE 1=1";
    const params = [];
    if (opts?.status) {
        sql += " AND status = ?";
        params.push(opts.status);
    }
    if (opts?.taskId) {
        sql += " AND task_id = ?";
        params.push(opts.taskId);
    }
    sql += " ORDER BY created_at DESC";
    const rows = db.prepare(sql).all(...params);
    return rows.map(rowToChangeSet);
}
export function getChangeSet(db, id) {
    const row = db.prepare("SELECT * FROM change_sets WHERE id = ?").get(id);
    if (!row)
        return undefined;
    return rowToChangeSet(row);
}
export function listChangedFiles(db, changeSetId) {
    const rows = db.prepare("SELECT * FROM changed_files WHERE change_set_id = ? ORDER BY path").all(changeSetId);
    return rows.map((r) => ({
        id: r.id,
        changeSetId: r.change_set_id,
        path: r.path,
        status: r.status,
        additions: r.additions,
        deletions: r.deletions
    }));
}
export function listChangedHunks(db, changeSetId, path) {
    let sql = "SELECT * FROM changed_hunks WHERE change_set_id = ?";
    const params = [changeSetId];
    if (path) {
        sql += " AND path = ?";
        params.push(path);
    }
    sql += " ORDER BY path, hunk_index";
    const rows = db.prepare(sql).all(...params);
    return rows.map((r) => ({
        id: r.id,
        changeSetId: r.change_set_id,
        changedFileId: r.changed_file_id,
        path: r.path,
        hunkIndex: r.hunk_index,
        header: r.header,
        status: r.status,
        oldStart: r.old_start,
        oldLines: r.old_lines,
        newStart: r.new_start,
        newLines: r.new_lines,
        additions: r.additions,
        deletions: r.deletions
    }));
}
export function updateChangedHunkStatus(db, hunkId, status) {
    const result = db.prepare("UPDATE changed_hunks SET status = ? WHERE id = ?").run(status, hunkId);
    if (result.changes === 0)
        return undefined;
    const row = db.prepare("SELECT * FROM changed_hunks WHERE id = ?").get(hunkId);
    if (!row)
        return undefined;
    rollupFileStatusFromHunks(db, row.change_set_id, row.path);
    return {
        id: row.id,
        changeSetId: row.change_set_id,
        changedFileId: row.changed_file_id,
        path: row.path,
        hunkIndex: row.hunk_index,
        header: row.header,
        status: row.status,
        oldStart: row.old_start,
        oldLines: row.old_lines,
        newStart: row.new_start,
        newLines: row.new_lines,
        additions: row.additions,
        deletions: row.deletions
    };
}
export function updateChangedHunksForFile(db, changeSetId, path, status) {
    const result = db.prepare("UPDATE changed_hunks SET status = ? WHERE change_set_id = ? AND path = ?").run(status, changeSetId, path);
    db.prepare("UPDATE changed_files SET status = ? WHERE change_set_id = ? AND path = ?")
        .run(status, changeSetId, path);
    const newSetStatus = computeSetStatus(db, changeSetId);
    db.prepare("UPDATE change_sets SET status = ?, updated_at = ? WHERE id = ?").run(newSetStatus, Date.now(), changeSetId);
    return result.changes;
}
export function updateChangeSetStatus(db, id, status) {
    const now = Date.now();
    const result = db.prepare("UPDATE change_sets SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    if (result.changes === 0)
        return undefined;
    if (status === "accepted") {
        db.prepare("UPDATE changed_files SET status = 'accepted' WHERE change_set_id = ?").run(id);
        db.prepare("UPDATE changed_hunks SET status = 'accepted' WHERE change_set_id = ?").run(id);
    }
    else if (status === "rejected") {
        db.prepare("UPDATE changed_files SET status = 'rejected' WHERE change_set_id = ?").run(id);
        db.prepare("UPDATE changed_hunks SET status = 'rejected' WHERE change_set_id = ?").run(id);
    }
    return getChangeSet(db, id);
}
export function updateChangedFileStatus(db, changeSetId, path, status) {
    const result = db.prepare("UPDATE changed_files SET status = ? WHERE change_set_id = ? AND path = ?").run(status, changeSetId, path);
    if (result.changes === 0)
        return undefined;
    db.prepare("UPDATE changed_hunks SET status = ? WHERE change_set_id = ? AND path = ?")
        .run(status, changeSetId, path);
    const newSetStatus = computeSetStatus(db, changeSetId);
    db.prepare("UPDATE change_sets SET status = ?, updated_at = ? WHERE id = ?").run(newSetStatus, Date.now(), changeSetId);
    const row = db.prepare("SELECT * FROM changed_files WHERE change_set_id = ? AND path = ?").get(changeSetId, path);
    if (!row)
        return undefined;
    return {
        id: row.id,
        changeSetId: row.change_set_id,
        path: row.path,
        status: row.status,
        additions: row.additions,
        deletions: row.deletions
    };
}
export function deleteChangeSet(db, id) {
    db.prepare("DELETE FROM changed_hunks WHERE change_set_id = ?").run(id);
    db.prepare("DELETE FROM changed_files WHERE change_set_id = ?").run(id);
    const result = db.prepare("DELETE FROM change_sets WHERE id = ?").run(id);
    return result.changes > 0;
}
export function getAcceptedHunkRefs(db, changeSetId) {
    const rows = db.prepare("SELECT path, hunk_index FROM changed_hunks WHERE change_set_id = ? AND status = 'accepted' ORDER BY path, hunk_index").all(changeSetId);
    return rows.map((r) => ({ path: r.path, hunkIndex: r.hunk_index }));
}
export function updateChangeSetCheckpoint(db, id, checkpointId) {
    db.prepare("UPDATE change_sets SET checkpoint_id = ?, updated_at = ? WHERE id = ?")
        .run(checkpointId, Date.now(), id);
}
function rollupFileStatusFromHunks(db, changeSetId, path) {
    const hunks = listChangedHunks(db, changeSetId, path);
    if (hunks.length === 0)
        return;
    const accepted = hunks.filter((h) => h.status === "accepted").length;
    const rejected = hunks.filter((h) => h.status === "rejected").length;
    const pending = hunks.filter((h) => h.status === "pending").length;
    let fileStatus = "pending";
    if (pending === hunks.length)
        fileStatus = "pending";
    else if (accepted === hunks.length)
        fileStatus = "accepted";
    else if (rejected === hunks.length)
        fileStatus = "rejected";
    db.prepare("UPDATE changed_files SET status = ? WHERE change_set_id = ? AND path = ?")
        .run(fileStatus, changeSetId, path);
    const newSetStatus = computeSetStatus(db, changeSetId);
    db.prepare("UPDATE change_sets SET status = ?, updated_at = ? WHERE id = ?").run(newSetStatus, Date.now(), changeSetId);
}
function rowToChangeSet(row) {
    return {
        id: row.id,
        taskId: row.task_id,
        checkpointId: row.checkpoint_id,
        diff: row.diff,
        status: row.status,
        summary: row.summary,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
