import type { OrganizerDatabase } from "./organizerDb.js";
import { getOrganizerTask, listOrganizerTaskEvents, listOrganizerTaskIterations } from "./organizerDb.js";

export function buildOrganizerTaskTimeline(db: OrganizerDatabase, taskId: string) {
  const task = getOrganizerTask(db, taskId);
  const events = listOrganizerTaskEvents(db, taskId);
  const iterations = listOrganizerTaskIterations(db, taskId);

  const parsedIterations = iterations.map((i) => ({
    iteration: i,
    implementationSummary: i.implementationSummary ?? null,
    changedFiles: safeJson(i.changedFilesJson) ?? [],
    diffStats: safeJson(i.diffStatJson) ?? [],
    diffPreview: i.diffPreview ?? null,
    checkResults: safeJson(i.checkResultsJson) ?? [],
    resultData: safeJson(i.resultJson) ?? null,
    reviewData: safeJson(i.reviewJson) ?? null,
    reviewDecision: i.reviewDecision ?? null,
    reviewFeedback: i.reviewFeedback ?? null,
    reviewNextPrompt: i.reviewNextPrompt ?? null,
    workerTaskId: i.workerTaskId ?? null,
    workerChangeSetId: i.workerChangeSetId ?? null,
  }));

  const checks: string[] = task?.checksJson ? (safeJson(task.checksJson) ?? []) as string[] : [];

  return { task, events, iterations: parsedIterations, checks };
}

function safeJson(raw: unknown): unknown {
  if (!raw) return null;
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}
