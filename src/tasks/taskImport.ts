import type { SmithDatabase } from "../db/db.js";
import type { OrganizerDatabase } from "../organizer/organizerDb.js";
import type { TaskImportFormat, TaskImportDefaults, TaskImportOptions, TaskImportResult } from "../types/index.js";
import { parseTaskImport } from "./taskImportParser.js";
import { createWorkItem, listWorkItems } from "./taskStore.js";
import { createOrganizerTask, listOrganizerTasks, createOrganizerBucket, listOrganizerBuckets, assignOrganizerTask } from "../organizer/organizerDb.js";

export function importLocalTasks(args: {
  db: SmithDatabase;
  text: string;
  format?: TaskImportFormat;
  defaults?: TaskImportDefaults;
  options?: TaskImportOptions;
}): TaskImportResult {
  const { db, text, format, defaults, options } = args;
  const preview = parseTaskImport(text, format);
  const result: TaskImportResult = { created: 0, skipped: 0, bucketsCreated: 0, taskIds: [], warnings: [...preview.warnings] };
  const existing = new Set(listWorkItems(db).map((w) => w.title.toLowerCase()));

  for (const t of preview.tasks) {
    if (options?.skipDuplicates && existing.has(t.title.toLowerCase())) {
      result.skipped++;
      continue;
    }
    const item = createWorkItem(db, {
      title: t.title,
      description: t.description ?? t.prompt ?? defaults?.projectId ?? undefined,
      priority: t.priority ?? defaults?.priority ?? 0,
      source: "organizer",
      assignedAgentId: t.assignedAgentId ?? defaults?.assignedAgentId
    });
    result.taskIds.push(item.id);
    result.created++;
    existing.add(t.title.toLowerCase());
  }
  return result;
}

export function importOrganizerTasks(args: {
  db: OrganizerDatabase;
  text: string;
  format?: TaskImportFormat;
  defaults: TaskImportDefaults & { projectId: string };
  options?: TaskImportOptions;
}): TaskImportResult {
  const { db, text, format, defaults, options } = args;
  const preview = parseTaskImport(text, format);
  const result: TaskImportResult = { created: 0, skipped: 0, bucketsCreated: 0, taskIds: [], warnings: [...preview.warnings] };

  const existing = new Set(listOrganizerTasks(db, { projectId: defaults.projectId }).map((t) => t.title.toLowerCase()));
  const existingBuckets = new Map<string, string>();
  const buckets = listOrganizerBuckets(db, defaults.projectId);
  for (const b of buckets) existingBuckets.set(b.name.toLowerCase(), b.id);

  function resolveBucketId(taskBucket?: string): string | null {
    const name = taskBucket ?? defaults.bucketName ?? null;
    if (!name) return defaults.bucketId ?? null;
    const lower = name.toLowerCase();
    if (existingBuckets.has(lower)) return existingBuckets.get(lower)!;
    if (options?.createMissingBuckets) {
      const b = createOrganizerBucket(db, { projectId: defaults.projectId, name });
      existingBuckets.set(lower, b.id);
      result.bucketsCreated++;
      return b.id;
    }
    result.warnings.push(`Bucket not found: "${name}"`);
    return defaults.bucketId ?? null;
  }

  for (const t of preview.tasks) {
    if (options?.skipDuplicates && existing.has(t.title.toLowerCase())) { result.skipped++; continue; }
    const bucketId = resolveBucketId(t.bucketName);
    const task = createOrganizerTask(db, {
      projectId: defaults.projectId,
      bucketId: bucketId ?? undefined,
      title: t.title,
      prompt: t.prompt ?? t.description ?? t.title,
      priority: t.priority ?? defaults.priority ?? 0,
      implementModel: t.implementModel ?? defaults.implementModel,
      reviewModel: t.reviewModel ?? defaults.reviewModel,
      maxIterations: clamp(1, 10, t.maxIterations ?? defaults.maxIterations ?? 1),
      autoApprove: t.autoApprove ?? defaults.autoApprove ?? false,
      autoApply: t.autoApply ?? defaults.autoApply ?? false,
      requireChecks: t.requireChecks ?? defaults.requireChecks ?? false,
      checks: t.checks ?? defaults.checks
    });
    const agentId = t.assignedAgentId ?? defaults.assignedAgentId;
    if (agentId) {
      assignOrganizerTask(db, task.id, agentId);
    }
    result.taskIds.push(task.id);
    result.created++;
    existing.add(t.title.toLowerCase());
  }

  if (options?.dispatchImmediately) {
    result.warnings.push("dispatchImmediately not implemented yet");
  }

  return result;
}

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val));
}
