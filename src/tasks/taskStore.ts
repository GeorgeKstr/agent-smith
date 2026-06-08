import type { SmithDatabase } from "../db/db.js";
import type { WorkItem, WorkItemStatus, WorkItemSource } from "../types/index.js";

function makeId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export type CreateWorkItemInput = {
  title: string;
  description?: string;
  parentId?: string;
  priority?: number;
  source?: WorkItemSource;
  assignedAgentId?: string;
};

export function createWorkItem(db: SmithDatabase, input: CreateWorkItemInput): WorkItem {
  const now = Date.now();
  const item: WorkItem = {
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

type ListOpts = {
  status?: WorkItemStatus;
  source?: WorkItemSource;
  limit?: number;
};

export function listWorkItems(db: SmithDatabase, opts?: ListOpts): WorkItem[] {
  let sql = "SELECT * FROM work_items WHERE 1=1";
  const params: unknown[] = [];

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

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    parent_id: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    source: string;
    assigned_agent_id: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map(rowToItem);
}

export function getWorkItem(db: SmithDatabase, id: string): WorkItem | undefined {
  const row = db.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as {
    id: string; parent_id: string | null; title: string; description: string | null;
    status: string; priority: number; source: string; assigned_agent_id: string | null;
    created_at: number; updated_at: number;
  } | undefined;
  if (!row) return undefined;
  return rowToItem(row);
}

export function updateWorkItemStatus(db: SmithDatabase, id: string, status: WorkItemStatus): WorkItem | undefined {
  const now = Date.now();
  const result = db.prepare("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  if (result.changes === 0) return undefined;
  return getWorkItem(db, id);
}

export function deleteWorkItem(db: SmithDatabase, id: string): boolean {
  const result = db.prepare("DELETE FROM work_items WHERE id = ?").run(id);
  return result.changes > 0;
}

function rowToItem(row: {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  source: string;
  assigned_agent_id: string | null;
  created_at: number;
  updated_at: number;
}): WorkItem {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    status: row.status as WorkItemStatus,
    priority: row.priority,
    source: row.source as WorkItemSource,
    assignedAgentId: row.assigned_agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function updateWorkItemDescription(db: SmithDatabase, id: string, description: string): WorkItem | undefined {
  const now = Date.now();
  const result = db.prepare("UPDATE work_items SET description = ?, updated_at = ? WHERE id = ?").run(description, now, id);
  if (result.changes === 0) return undefined;
  return getWorkItem(db, id);
}

export function updateWorkItemAssignedAgent(db: SmithDatabase, id: string, assignedAgentId: string): WorkItem | undefined {
  const now = Date.now();
  const result = db.prepare("UPDATE work_items SET assigned_agent_id = ?, updated_at = ? WHERE id = ?").run(assignedAgentId, now, id);
  if (result.changes === 0) return undefined;
  return getWorkItem(db, id);
}

type ChangeSetSummary = {
  id: string;
  status: string;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
};

export function listWorkItemChangeSets(db: SmithDatabase, taskId: string): ChangeSetSummary[] {
  const rows = db.prepare(
    "SELECT id, status, summary, created_at, updated_at FROM change_sets WHERE task_id = ? ORDER BY created_at DESC"
  ).all(taskId) as Array<{
    id: string; status: string; summary: string | null; created_at: number; updated_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    summary: r.summary,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}
