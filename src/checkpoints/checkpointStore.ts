import type { SmithDatabase } from "../db/db.js";
import type { Checkpoint } from "../types/index.js";

function makeId(): string {
  return `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

type CreateInput = {
  id?: string;
  label: string;
  taskId?: string;
  gitHead?: string | null;
  dirtyBefore: boolean;
  files?: string[];
  preDiffPath?: string | null;
  appliedDiffPath?: string | null;
};

export function createCheckpointRecord(db: SmithDatabase, input: CreateInput): Checkpoint {
  const now = Date.now();
  const files = input.files ?? [];

  const checkpoint: Checkpoint = {
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

export function listCheckpoints(db: SmithDatabase): Checkpoint[] {
  const rows = db.prepare("SELECT * FROM checkpoints ORDER BY created_at DESC").all() as Array<{
    id: string; task_id: string | null; label: string; git_head: string | null;
    dirty_before: number; files_json: string; pre_diff_path: string | null;
    applied_diff_path: string | null; created_at: number;
  }>;
  return rows.map(rowToCheckpoint);
}

export function getCheckpoint(db: SmithDatabase, id: string): Checkpoint | undefined {
  const row = db.prepare("SELECT * FROM checkpoints WHERE id = ?").get(id) as {
    id: string; task_id: string | null; label: string; git_head: string | null;
    dirty_before: number; files_json: string; pre_diff_path: string | null;
    applied_diff_path: string | null; created_at: number;
  } | undefined;
  if (!row) return undefined;
  return rowToCheckpoint(row);
}

export function updateCheckpointAppliedDiff(db: SmithDatabase, id: string, appliedDiffPath: string, files: string[]): Checkpoint | undefined {
  db.prepare("UPDATE checkpoints SET applied_diff_path = ?, files_json = ? WHERE id = ?").run(appliedDiffPath, JSON.stringify(files), id);
  return getCheckpoint(db, id);
}

export function deleteCheckpoint(db: SmithDatabase, id: string): boolean {
  const result = db.prepare("DELETE FROM checkpoints WHERE id = ?").run(id);
  return result.changes > 0;
}

function rowToCheckpoint(row: {
  id: string; task_id: string | null; label: string; git_head: string | null;
  dirty_before: number; files_json: string; pre_diff_path: string | null;
  applied_diff_path: string | null; created_at: number;
}): Checkpoint {
  let files: string[] = [];
  try { files = JSON.parse(row.files_json); } catch { /* keep empty */ }
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
