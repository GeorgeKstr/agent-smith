import { nanoid } from "nanoid";
import type { SmithDatabase } from "./db.js";
import type { CheckResult } from "../types/index.js";

/** Open a task record and return its id. */
export function createTask(db: SmithDatabase, taskText: string, model: string): string {
  const id = nanoid();
  db.prepare(
    "INSERT INTO tasks (id, task_text, created_at, status, chosen_model, success) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(id, taskText, Date.now(), "running", model);
  return id;
}

/** Record an applied edit so future retrieval can learn which files matter. */
export function recordEdit(
  db: SmithDatabase,
  taskId: string,
  relPath: string,
  patch: string,
  newHash?: string
): void {
  const file = db.prepare("SELECT id, hash FROM files WHERE path = ?").get(relPath) as
    | { id: number; hash: string }
    | undefined;
  db.prepare(
    "INSERT INTO edits (id, task_id, file_id, old_hash, new_hash, patch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(nanoid(), taskId, file?.id ?? null, file?.hash ?? null, newHash ?? null, patch.slice(0, 20_000), Date.now());
}

/** Persist the output of a check/test run. */
export function recordTestRun(db: SmithDatabase, taskId: string, result: CheckResult): void {
  db.prepare(
    "INSERT INTO test_runs (id, task_id, command, exit_code, stdout, stderr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(nanoid(), taskId, result.command, result.exitCode, result.stdout, result.stderr, Date.now());
}

/** Close out a task with its final status. */
export function finishTask(db: SmithDatabase, taskId: string, success: boolean): void {
  db.prepare("UPDATE tasks SET status = ?, success = ? WHERE id = ?").run(
    success ? "succeeded" : "failed",
    success ? 1 : 0,
    taskId
  );
}

/** Recent task history for the TUI. */
export function recentTasks(db: SmithDatabase, limit = 5): Array<{ task: string; success: number; status: string }> {
  return db
    .prepare("SELECT task_text AS task, success, status FROM tasks ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{ task: string; success: number; status: string }>;
}
