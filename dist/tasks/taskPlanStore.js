function makeId() {
    return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
export function createTaskPlanStep(db, input) {
    const now = Date.now();
    const sortOrder = input.sortOrder ?? nextSortOrder(db, input.taskId);
    const step = {
        id: makeId(),
        taskId: input.taskId,
        title: input.title,
        status: input.status ?? "todo",
        notes: input.notes ?? null,
        sortOrder,
        createdAt: now,
        updatedAt: now
    };
    db.prepare(`
    INSERT INTO task_plan_steps (id, task_id, title, status, notes, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(step.id, step.taskId, step.title, step.status, step.notes, step.sortOrder, step.createdAt, step.updatedAt);
    return step;
}
export function listTaskPlanSteps(db, taskId) {
    const rows = db.prepare("SELECT * FROM task_plan_steps WHERE task_id = ? ORDER BY sort_order").all(taskId);
    return rows.map(rowToStep);
}
export function getTaskPlanStep(db, id) {
    const row = db.prepare("SELECT * FROM task_plan_steps WHERE id = ?").get(id);
    if (!row)
        return undefined;
    return rowToStep(row);
}
export function updateTaskPlanStepStatus(db, id, status) {
    const now = Date.now();
    const result = db.prepare("UPDATE task_plan_steps SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    if (result.changes === 0)
        return undefined;
    return getTaskPlanStep(db, id);
}
export function updateTaskPlanStepNotes(db, id, notes) {
    const now = Date.now();
    const result = db.prepare("UPDATE task_plan_steps SET notes = ?, updated_at = ? WHERE id = ?").run(notes, now, id);
    if (result.changes === 0)
        return undefined;
    return getTaskPlanStep(db, id);
}
export function updateTaskPlanStepTitle(db, id, title) {
    const now = Date.now();
    const result = db.prepare("UPDATE task_plan_steps SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id);
    if (result.changes === 0)
        return undefined;
    return getTaskPlanStep(db, id);
}
export function reorderTaskPlanStep(db, id, sortOrder) {
    const now = Date.now();
    const result = db.prepare("UPDATE task_plan_steps SET sort_order = ?, updated_at = ? WHERE id = ?").run(sortOrder, now, id);
    if (result.changes === 0)
        return undefined;
    return getTaskPlanStep(db, id);
}
export function deleteTaskPlanStep(db, id) {
    const result = db.prepare("DELETE FROM task_plan_steps WHERE id = ?").run(id);
    return result.changes > 0;
}
export function replaceTaskPlan(db, taskId, steps) {
    db.prepare("DELETE FROM task_plan_steps WHERE task_id = ?").run(taskId);
    const results = [];
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const title = typeof s === "string" ? s : s.title;
        if (!title.trim())
            continue;
        const step = createTaskPlanStep(db, {
            taskId,
            title: title.trim(),
            status: typeof s === "object" ? s.status : undefined,
            notes: typeof s === "object" ? s.notes : undefined,
            sortOrder: i
        });
        results.push(step);
    }
    return results;
}
function nextSortOrder(db, taskId) {
    const row = db.prepare("SELECT MAX(sort_order) AS m FROM task_plan_steps WHERE task_id = ?").get(taskId);
    return (row?.m ?? -1) + 1;
}
function rowToStep(row) {
    return {
        id: row.id,
        taskId: row.task_id,
        title: row.title,
        status: row.status,
        notes: row.notes,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
export function findPlanStepByKeywords(steps, keywords) {
    const available = steps.filter((s) => s.status !== "done" && s.status !== "skipped");
    for (const kw of keywords) {
        const lower = kw.toLowerCase();
        for (const s of available) {
            if (s.title.toLowerCase().includes(lower) || (s.notes && s.notes.toLowerCase().includes(lower))) {
                return s;
            }
        }
    }
    // Fall back to any step regardless of status
    for (const kw of keywords) {
        const lower = kw.toLowerCase();
        for (const s of steps) {
            if (s.title.toLowerCase().includes(lower) || (s.notes && s.notes.toLowerCase().includes(lower))) {
                return s;
            }
        }
    }
    return null;
}
export function markFirstMatchingPlanStep(db, taskId, keywords, status) {
    const steps = listTaskPlanSteps(db, taskId);
    if (steps.length === 0)
        return null;
    const step = findPlanStepByKeywords(steps, keywords);
    if (!step)
        return null;
    const updated = updateTaskPlanStepStatus(db, step.id, status);
    return updated ?? null;
}
export function markPlanProgressForPhase(db, taskId, phase) {
    const steps = listTaskPlanSteps(db, taskId);
    if (steps.length === 0)
        return [];
    const changed = [];
    switch (phase) {
        case "context": {
            const keywords = ["understand", "inspect", "context", "relevant", "files", "symbols"];
            const match = findPlanStepByKeywords(steps, keywords);
            if (match) {
                const u = updateTaskPlanStepStatus(db, match.id, "done");
                if (u)
                    changed.push(u);
            }
            break;
        }
        case "implementation": {
            const keywords = ["implement", "patch", "change", "fix", "update", "code"];
            const match = findPlanStepByKeywords(steps, keywords);
            if (match) {
                const u = updateTaskPlanStepStatus(db, match.id, "done");
                if (u)
                    changed.push(u);
            }
            break;
        }
        case "checks": {
            const keywords = ["test", "check", "typecheck", "lint", "build", "validate"];
            const match = findPlanStepByKeywords(steps, keywords);
            if (match) {
                const u = updateTaskPlanStepStatus(db, match.id, "done");
                if (u)
                    changed.push(u);
            }
            break;
        }
        case "review": {
            const keywords = ["review", "changes", "change set", "diff"];
            const match = findPlanStepByKeywords(steps, keywords);
            if (match) {
                const u = updateTaskPlanStepStatus(db, match.id, "doing");
                if (u)
                    changed.push(u);
            }
            break;
        }
        case "failed": {
            const first = steps.find((s) => s.status !== "done" && s.status !== "skipped" && s.status !== "failed");
            if (first) {
                const u = updateTaskPlanStepStatus(db, first.id, "failed");
                if (u)
                    changed.push(u);
            }
            break;
        }
        case "completed": {
            for (const s of steps) {
                if (s.status === "todo" || s.status === "doing") {
                    const u = updateTaskPlanStepStatus(db, s.id, "done");
                    if (u)
                        changed.push(u);
                }
            }
            break;
        }
    }
    return changed;
}
