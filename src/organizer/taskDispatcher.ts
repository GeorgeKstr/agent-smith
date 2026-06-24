import type { OrganizerDatabase } from "./organizerDb.js";
import type { RuntimeTaskResult, OrganizerReviewDecision } from "../types/index.js";
import { getOrganizerTask, getOrganizerAgent, updateOrganizerTask, recordOrganizerTaskEvent, createOrganizerTaskIteration, updateOrganizerTaskIteration, getLatestOrganizerTaskIteration } from "./organizerDb.js";
import { createWorkerApiClient } from "./workerApiClient.js";

type DispatchResult = {
  ok: boolean;
  message: string;
  remoteTaskId?: string;
  remoteChangeSetId?: string;
  result?: RuntimeTaskResult;
  decision?: OrganizerReviewDecision;
};

export async function dispatchOrganizerTask(args: {
  db: OrganizerDatabase;
  taskId: string;
  workerToken?: string;
}): Promise<DispatchResult> {
  return dispatchIteration(args, 0);
}

async function dispatchIteration(args: {
  db: OrganizerDatabase;
  taskId: string;
  workerToken?: string;
}, depth: number): Promise<DispatchResult> {
  if (depth > 5) return { ok: false, message: "Max dispatch depth exceeded." };
  const { db, taskId, workerToken } = args;
  const task = getOrganizerTask(db, taskId);
  if (!task) return { ok: false, message: `Task not found: ${taskId}` };
  if (!task.assignedAgentId) return { ok: false, message: "Task not assigned" };

  const agent = getOrganizerAgent(db, task.assignedAgentId);
  if (!agent || !agent.api_enabled || !agent.api_base_url) return { ok: false, message: "Agent not available" };

  const client = createWorkerApiClient({ baseUrl: agent.api_base_url, token: workerToken });
  const maxIter = Math.min(task.maxIterations, 10);
  const iterIndex = task.currentIteration + 1;

  const prev = getLatestOrganizerTaskIteration(db, taskId);
  const prompt = buildImplementationPrompt({
    task: { title: task.title, prompt: task.prompt, checksJson: task.checksJson, implementModel: task.implementModel, reviewModel: task.reviewModel, maxIterations: maxIter, autoApprove: task.autoApprove, autoApply: task.autoApply },
    iterIndex, maxIter,
    prev: prev?.reviewFeedback ? prev : null
  });

  const iteration = createOrganizerTaskIteration(db, {
    taskId, agentId: agent.id, iterationIndex: iterIndex,
    implementModel: task.implementModel, reviewModel: task.reviewModel,
    prompt, reviewPrompt: null,
    status: "running"
  });

  updateOrganizerTask(db, taskId, { status: "running", currentIteration: iterIndex });
  if (!task.startedAt) db.prepare("UPDATE organizer_tasks SET started_at = ? WHERE id = ?").run(Date.now(), taskId);
  recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "iteration_started", message: `Iteration ${iterIndex} started` });

  // Create remote task
  const createRes = await client.createTask({ title: task.title, description: prompt, priority: task.priority, source: "organizer" });
  if (!createRes.ok || !createRes.task) {
    updateOrganizerTask(db, taskId, { status: "failed", resultJson: JSON.stringify({ error: createRes.error }) });
    updateOrganizerTaskIteration(db, iteration.id, { status: "failed", resultJson: JSON.stringify({ error: createRes.error }) });
    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "dispatch_failed", message: `Failed to create remote task: ${createRes.error}` });
    return { ok: false, message: `Failed to create remote task: ${createRes.error}` };
  }
  const remoteId = createRes.task.id;
  updateOrganizerTask(db, taskId, { remoteTaskId: remoteId });
  updateOrganizerTaskIteration(db, iteration.id, { workerTaskId: remoteId });
  recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "worker_task_created", message: `Created remote task ${remoteId}` });

  // Patch — agent always writes to disk; review inspects post-hoc diff
  const patchRes = await client.patchTask(remoteId, { apply: true, model: task.implementModel ?? undefined });
  const implModel = (patchRes.result?.data as Record<string, unknown> | undefined)?.changeSetId as string | undefined;
  const changeSetId = implModel ?? (
    typeof patchRes.result?.message === "string"
      ? (patchRes.result as { message: string }).message.match(/change set: (\S+)/i)?.[1]
      : undefined
  );

  // Extract artifacts
  const implSummary = patchRes.result?.answer ?? patchRes.result?.message ?? "Patch iteration completed.";
  const files = patchRes.result?.files ?? [];
  const checks = patchRes.result?.checks ?? [];
  let diffPreview: string | null = null;
  let diffStatJson: string | null = null;

  // Try to fetch remote change set details
  if (changeSetId) {
    const changeRes = await client.getChangeSet?.(changeSetId);
    if (changeRes?.ok && typeof changeRes.data === "object" && changeRes.data) {
      const changeData = changeRes.data as Record<string, unknown>;
      const changeFiles = Array.isArray(changeData.files) ? changeData.files as Array<{ path: string; additions: number; deletions: number }> : [];
      if (changeFiles.length > 0) {
        diffStatJson = JSON.stringify(changeFiles);
      }
      if (typeof changeData.changeSet === "object" && changeData.changeSet) {
        const cs = changeData.changeSet as Record<string, unknown>;
        if (typeof cs.diff === "string") {
          diffPreview = compactPreview(cs.diff);
        }
      }
    }
  }

  // Fallback: build diffPreview from result diff
  if (!diffPreview && patchRes.result?.diff) {
    diffPreview = compactPreview(patchRes.result.diff);
  }

  if (!diffPreview) {
    console.error("[dispatch] No diffPreview! changeSetId=%s hasDiff=%s resultFiles=%s",
      changeSetId || "null",
      patchRes.result?.diff ? "yes" : "no",
      JSON.stringify(typeof patchRes.result));
  }

  updateOrganizerTaskIteration(db, iteration.id, {
    resultJson: JSON.stringify(patchRes.result),
    workerChangeSetId: changeSetId ?? null,
    implementationSummary: implSummary.slice(0, 2000),
    changedFilesJson: files.length > 0 ? JSON.stringify(files) : null,
    diffPreview,
    diffStatJson,
    checkResultsJson: checks.length > 0 ? JSON.stringify(checks) : null
  });

  if (patchRes.ok) {
    updateOrganizerTask(db, taskId, { remoteChangeSetId: changeSetId ?? null });
    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "worker_patch_completed", message: changeSetId ? `Change set ${changeSetId}` : "Patch completed" });
  } else {
    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "dispatch_failed", message: `Remote patch failed: ${patchRes.error}` });
  }

  // No review model or auto-approve: skip review, just check if changes were made
  if (!task.reviewModel || task.autoApprove) {
    const hasChanges = diffPreview != null || (files && files.length > 0);
    if (hasChanges) {
      updateOrganizerTask(db, taskId, { status: "completed", finishedAt: Date.now() });
      updateOrganizerTaskIteration(db, iteration.id, { status: "completed" });
      recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "auto_approved", message: "Completed" });
      return { ok: true, message: "Completed.", remoteTaskId: remoteId, remoteChangeSetId: changeSetId };
    }
    updateOrganizerTask(db, taskId, { status: "needs_review" });
    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "needs_user_review", message: "No changes detected" });
    return { ok: true, message: "No changes detected.", remoteTaskId: remoteId, remoteChangeSetId: changeSetId };
  }

  // Review phase (only when reviewModel is set AND autoApprove is false)
  updateOrganizerTask(db, taskId, { status: "reviewing" });
  updateOrganizerTaskIteration(db, iteration.id, { status: "reviewing" });
  recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "review_started", message: `Reviewing with ${task.reviewModel}` });

  const reviewPrompt = buildReviewPrompt(task, iteration, task.prompt, patchRes.result, files, prev, iterIndex, maxIter);
  updateOrganizerTaskIteration(db, iteration.id, { reviewPrompt });

  const reviewRes = await client.dispatchAction({
    kind: "ask",
    prompt: reviewPrompt,
    model: task.reviewModel
  });

  let decision: OrganizerReviewDecision = "failed";
  let feedback = "Review failed or returned invalid response.";
  let nextPrompt: string | null = null;
  let parsedReview: Record<string, unknown> | null = null;

  if (reviewRes.ok && reviewRes.result?.answer) {
    const text = reviewRes.result.answer;
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) parsedReview = JSON.parse(text.slice(start, end + 1));
    } catch { /* use raw text */ }
    if (parsedReview && typeof parsedReview.decision === "string") {
      decision = parsedReview.decision as OrganizerReviewDecision;
      feedback = typeof parsedReview.feedback === "string" ? parsedReview.feedback : feedback;
      nextPrompt = typeof parsedReview.nextPrompt === "string" ? parsedReview.nextPrompt : null;
    } else {
      feedback = text.slice(0, 1000);
    }
  } else {
    feedback = reviewRes.error ?? "Review call failed";
  }

  // Collect review metadata
  const riskLevel = parsedReview && typeof parsedReview.riskLevel === "string" ? parsedReview.riskLevel as string : null;
  const missingChecks = parsedReview && Array.isArray(parsedReview.missingChecks) ? parsedReview.missingChecks as string[] : null;
  const reviewNotes = parsedReview && typeof parsedReview.notes === "string" ? parsedReview.notes as string : null;

  updateOrganizerTaskIteration(db, iteration.id, {
    reviewJson: JSON.stringify(reviewRes.result),
    reviewDecision: decision, reviewFeedback: feedback,
    reviewNextPrompt: nextPrompt
  });
  recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "review_completed", message: `Decision: ${decision}`, payloadJson: JSON.stringify({ decision, feedback, nextPrompt, riskLevel, missingChecks }) });

  if (decision === "approve") {
    updateOrganizerTaskIteration(db, iteration.id, { status: "approved" });
    if (task.autoApprove) {
      updateOrganizerTask(db, taskId, { status: "completed", finishedAt: Date.now() });
      recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "auto_approved", message: "Reviewer approved" });
      return { ok: true, message: "Reviewer approved.", remoteTaskId: remoteId, remoteChangeSetId: changeSetId, decision };
    }
    updateOrganizerTask(db, taskId, { status: "needs_review" });
    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "needs_user_review", message: "Reviewer approved; awaiting user" });
    return { ok: true, message: `Reviewer approved. Awaiting user approval.`, remoteTaskId: remoteId, remoteChangeSetId: changeSetId, decision };
  }

  if (decision === "request_changes") {
    updateOrganizerTaskIteration(db, iteration.id, { status: "changes_requested" });
    if (iterIndex < maxIter) {
      updateOrganizerTask(db, taskId, { status: "iterating" });
      recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "iteration_requested", message: `Iteration ${iterIndex + 1} queued` });
      return dispatchIteration(args, depth + 1);
    }
    updateOrganizerTask(db, taskId, { status: "needs_review" });
    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "max_iterations_reached", message: `Max iterations (${maxIter}) reached` });
    return { ok: true, message: `Max iterations reached (${maxIter}). Needs user review.`, remoteTaskId: remoteId, remoteChangeSetId: changeSetId, decision };
  }

  // rejected or failed
  updateOrganizerTaskIteration(db, iteration.id, { status: decision === "reject" ? "rejected" : "failed" });
  updateOrganizerTask(db, taskId, { status: "needs_review" });
  recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "needs_user_review", message: `Reviewer ${decision}: ${feedback.slice(0, 200)}` });
  return { ok: true, message: `Reviewer ${decision}: ${feedback.slice(0, 200)}`, remoteTaskId: remoteId, remoteChangeSetId: changeSetId, decision };
}

function buildImplementationPrompt(args: {
  task: { title: string; prompt: string; checksJson?: string | null; implementModel?: string | null; reviewModel?: string | null; maxIterations: number; autoApprove: boolean; autoApply: boolean };
  iterIndex: number;
  maxIter: number;
  prev?: { implementationSummary?: string | null; reviewFeedback?: string | null; reviewNextPrompt?: string | null; changedFilesJson?: string | null } | null;
}): string {
  const { task, iterIndex, maxIter, prev } = args;
  const lines: string[] = [];

  if (iterIndex === 1) {
    lines.push(
      "You are Agent Smith's implementation model.",
      "Your job is to produce the smallest safe code change for the assigned task.",
      "",
      "Rules:",
      "- Do not rewrite unrelated code.",
      "- Do not perform broad refactors unless the task explicitly requires it.",
      "- Prefer minimal, testable changes.",
      "- Preserve existing style and architecture.",
      "- If the context is insufficient, explain exactly what is missing.",
      "- Return a proposed patch/change only through the normal Agent Smith patch flow.",
      "- Do not mark the task complete yourself.",
      "",
      "Task:",
      task.title,
      "",
      "Task prompt:",
      task.prompt,
    );
  } else {
    lines.push(
      `This is implementation iteration ${iterIndex} of ${maxIter}.`,
      "Your job is to revise the previous proposed change according to reviewer feedback.",
      "",
      "Rules:",
      "- Address the reviewer feedback directly.",
      "- Do not undo correct parts of the previous implementation unless needed.",
      "- Keep the change minimal.",
      "- Avoid unrelated refactors.",
      "- If the reviewer requested tests, add the smallest relevant tests.",
      "- If the requested change is unsafe or impossible, explain why.",
      "",
      "Original task:",
      task.title,
      `Original prompt: ${task.prompt}`,
    );

    if (prev?.implementationSummary) lines.push(`\nPrevious implementation summary: ${prev.implementationSummary.slice(0, 1500)}`);
    if (prev?.changedFilesJson) {
      try {
        const prevFiles = JSON.parse(prev.changedFilesJson) as string[];
        if (prevFiles.length) lines.push(`\nPrevious changed files: ${prevFiles.join(", ")}`);
      } catch { /* skip */ }
    }
    if (prev?.reviewFeedback) lines.push(`\nReviewer feedback: ${prev.reviewFeedback}`);
    if (prev?.reviewNextPrompt) lines.push(`\nNext implementation instructions: ${prev.reviewNextPrompt}`);
  }

  lines.push(
    "",
    "Implementation policy:",
    `- Implement model: ${task.implementModel ?? "(default)"}`,
    `- Review model: ${task.reviewModel ?? "(none)"}`,
    `- Iteration: ${iterIndex} / ${maxIter}`,
    `- Auto approve: ${task.autoApprove}`,
    `- Auto apply: ${task.autoApply}`,
    `- Required checks: ${task.checksJson ?? "(none)"}`,
    "",
    "Context instructions:",
    "- Use the retrieved context packet.",
    "- Prefer files and symbols selected by Agent Smith.",
    "- If tests are included, update or add the smallest relevant tests."
  );

  return lines.join("\n");
}

function buildReviewPrompt(
  task: { title: string; prompt: string; checksJson?: string | null },
  iteration: { implementationSummary?: string | null; changedFilesJson?: string | null; diffPreview?: string | null; checkResultsJson?: string | null; reviewFeedback?: string | null },
  originalPrompt: string,
  result?: RuntimeTaskResult | null,
  files?: string[],
  prev?: { reviewFeedback?: string | null } | null,
  iterIndex?: number,
  maxIter?: number
): string {
  const lines: string[] = [
    `Review the implementation diff below against the task requirements.`,
    ``,
    `TASK: ${task.title}`,
    `REQUIREMENTS: ${task.prompt}`,
  ];

  if (prev?.reviewFeedback) {
    lines.push(``, `PREVIOUS FEEDBACK: ${prev.reviewFeedback}`);
  }

  if (iteration.diffPreview && iteration.diffPreview.trim()) {
    lines.push(``, `IMPLEMENTATION DIFF:`, `\`\`\`diff`, iteration.diffPreview.slice(0, 16000), `\`\`\``);
    lines.push(``, `Files changed: ${(files ?? []).join(", ") || "see diff above"}`);
  } else {
    lines.push(``, `NO CHANGES were made. The implementation produced no code.`);
  }

  if (iteration.implementationSummary) {
    lines.push(``, `SUMMARY: ${iteration.implementationSummary.slice(0, 500)}`);
  }

  lines.push(
    ``,
    `Output limit: 2048 tokens. Keep your JSON response within this budget.`,
    `Reply with EXACTLY this JSON format:`,
    `{"decision":"approve"|"request_changes"|"reject","feedback":"why","nextPrompt":"what to fix","riskLevel":"low"|"medium"|"high"}`
  );
  return lines.join("\n");
}

function compactPreview(diff: string, maxLines: number = 500): string {
  if (!diff) return "";
  const lines = diff.split("\n");
  const out: string[] = [];
  for (const line of lines.slice(0, maxLines)) {
    const t = line.trim();
    if (t.startsWith("diff --git") || t.startsWith("---") || t.startsWith("+++") || t.startsWith("@@") || line.startsWith("+") || line.startsWith("-")) {
      out.push(line);
    } else if (out.length === 0 || out[out.length - 1] !== "") {
      out.push(line);
    }
  }
  if (lines.length > maxLines) out.push("... diff preview truncated ...");
  return out.join("\n");
}
