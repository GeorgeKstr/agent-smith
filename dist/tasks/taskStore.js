function makeId() {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
export function createWorkItem(db, input) {
    const now = Date.now();
    const item = {
        id: makeId(),
        parentId: input.parentId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: "todo",
        priority: input.priority ?? 0,
        source: input.source ?? "user",
        assignedAgentId: input.assignedAgentId ?? null,
        createdAt: now,
        updatedAt: now
    };
    db.prepare(`
    INSERT INTO work_items (id, parent_id, title, description, status, priority, source, assigned_agent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.parentId, item.title, item.description, item.status, item.priority, item.source, item.assignedAgentId, item.createdAt, item.updatedAt);
    return item;
}
export function listWorkItems(db, opts) {
    let sql = "SELECT * FROM work_items WHERE 1=1";
    const params = [];
    if (opts?.status) {
        sql += " AND status = ?";
        params.push(opts.status);
    }
    if (opts?.source) {
        sql += " AND source = ?";
        params.push(opts.source);
    }
    sql += " ORDER BY priority DESC, created_at DESC";
    if (opts?.limit && opts.limit > 0) {
        sql += " LIMIT ?";
        params.push(opts.limit);
    }
    const rows = db.prepare(sql).all(...params);
    return rows.map(rowToItem);
}
export function getWorkItem(db, id) {
    const row = db.prepare("SELECT * FROM work_items WHERE id = ?").get(id);
    if (!row)
        return undefined;
    return rowToItem(row);
}
export function updateWorkItemStatus(db, id, status) {
    const now = Date.now();
    const result = db.prepare("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    if (result.changes === 0)
        return undefined;
    return getWorkItem(db, id);
}
export function deleteWorkItem(db, id) {
    const result = db.prepare("DELETE FROM work_items WHERE id = ?").run(id);
    return result.changes > 0;
}
function rowToItem(row) {
    return {
        id: row.id,
        parentId: row.parent_id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        source: row.source,
        assignedAgentId: row.assigned_agent_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
export function updateWorkItemDescription(db, id, description) {
    const now = Date.now();
    const result = db.prepare("UPDATE work_items SET description = ?, updated_at = ? WHERE id = ?").run(description, now, id);
    if (result.changes === 0)
        return undefined;
    return getWorkItem(db, id);
}
export function updateWorkItemAssignedAgent(db, id, assignedAgentId) {
    const now = Date.now();
    const result = db.prepare("UPDATE work_items SET assigned_agent_id = ?, updated_at = ? WHERE id = ?").run(assignedAgentId, now, id);
    if (result.changes === 0)
        return undefined;
    return getWorkItem(db, id);
}
export function listWorkItemChangeSets(db, taskId) {
    const rows = db.prepare("SELECT id, status, summary, created_at, updated_at FROM change_sets WHERE task_id = ? ORDER BY created_at DESC").all(taskId);
    return rows.map((r) => ({
        id: r.id,
        status: r.status,
        summary: r.summary,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }));
}
