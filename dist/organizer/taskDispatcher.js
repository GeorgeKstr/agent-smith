import { getOrganizerTask, getOrganizerAgent, updateOrganizerTask, recordOrganizerTaskEvent, createOrganizerTaskIteration, updateOrganizerTaskIteration, getLatestOrganizerTaskIteration } from "./organizerDb.js";
import { createWorkerApiClient } from "./workerApiClient.js";
export async function dispatchOrganizerTask(args) {
    return dispatchIteration(args, 0);
}
async function dispatchIteration(args, depth) {
    if (depth > 5)
        return { ok: false, message: "Max dispatch depth exceeded." };
    const { db, taskId, workerToken } = args;
    const task = getOrganizerTask(db, taskId);
    if (!task)
        return { ok: false, message: `Task not found: ${taskId}` };
    if (!task.assignedAgentId)
        return { ok: false, message: "Task not assigned" };
    const agent = getOrganizerAgent(db, task.assignedAgentId);
    if (!agent || !agent.api_enabled || !agent.api_base_url)
        return { ok: false, message: "Agent not available" };
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
    if (!task.startedAt)
        db.prepare("UPDATE organizer_tasks SET started_at = ? WHERE id = ?").run(Date.now(), taskId);
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
    // Patch
    const patchRes = await client.patchTask(remoteId, { apply: false, model: task.implementModel ?? undefined });
    const implModel = patchRes.result?.data?.changeSetId;
    const changeSetId = implModel ?? (typeof patchRes.result?.message === "string"
        ? patchRes.result.message.match(/change set: (\S+)/i)?.[1]
        : undefined);
    // Extract artifacts
    const implSummary = patchRes.result?.answer ?? patchRes.result?.message ?? "Patch iteration completed.";
    const files = patchRes.result?.files ?? [];
    const checks = patchRes.result?.checks ?? [];
    let diffPreview = null;
    let diffStatJson = null;
    // Try to fetch remote change set details
    if (changeSetId) {
        const changeRes = await client.getChangeSet?.(changeSetId);
        if (changeRes?.ok && typeof changeRes.data === "object" && changeRes.data) {
            const changeData = changeRes.data;
            const changeFiles = Array.isArray(changeData.files) ? changeData.files : [];
            if (changeFiles.length > 0) {
                diffStatJson = JSON.stringify(changeFiles);
            }
            if (typeof changeData.changeSet === "object" && changeData.changeSet) {
                const cs = changeData.changeSet;
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
    }
    else {
        recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "dispatch_failed", message: `Remote patch failed: ${patchRes.error}` });
    }
    // No review model
    if (!task.reviewModel) {
        if (task.autoApprove) {
            updateOrganizerTask(db, taskId, { status: "auto_approved" });
            updateOrganizerTaskIteration(db, iteration.id, { status: "approved" });
            recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "auto_approved", message: "Auto-approved (no review model)" });
            return { ok: true, message: "Auto-approved (no review model)", remoteTaskId: remoteId, remoteChangeSetId: changeSetId };
        }
        updateOrganizerTask(db, taskId, { status: "needs_review" });
        recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "needs_user_review", message: "No review model configured" });
        return { ok: true, message: "Patch generated. Needs user review (no review model).", remoteTaskId: remoteId, remoteChangeSetId: changeSetId };
    }
    // Review phase
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
    let decision = "failed";
    let feedback = "Review failed or returned invalid response.";
    let nextPrompt = null;
    let parsedReview = null;
    if (reviewRes.ok && reviewRes.result?.answer) {
        const text = reviewRes.result.answer;
        try {
            const start = text.indexOf("{");
            const end = text.lastIndexOf("}");
            if (start >= 0 && end > start)
                parsedReview = JSON.parse(text.slice(start, end + 1));
        }
        catch { /* use raw text */ }
        if (parsedReview && typeof parsedReview.decision === "string") {
            decision = parsedReview.decision;
            feedback = typeof parsedReview.feedback === "string" ? parsedReview.feedback : feedback;
            nextPrompt = typeof parsedReview.nextPrompt === "string" ? parsedReview.nextPrompt : null;
        }
        else {
            feedback = text.slice(0, 1000);
        }
    }
    else {
        feedback = reviewRes.error ?? "Review call failed";
    }
    // Collect review metadata
    const riskLevel = parsedReview && typeof parsedReview.riskLevel === "string" ? parsedReview.riskLevel : null;
    const missingChecks = parsedReview && Array.isArray(parsedReview.missingChecks) ? parsedReview.missingChecks : null;
    const reviewNotes = parsedReview && typeof parsedReview.notes === "string" ? parsedReview.notes : null;
    updateOrganizerTaskIteration(db, iteration.id, {
        reviewJson: JSON.stringify(reviewRes.result),
        reviewDecision: decision, reviewFeedback: feedback,
        reviewNextPrompt: nextPrompt
    });
    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "review_completed", message: `Decision: ${decision}`, payloadJson: JSON.stringify({ decision, feedback, nextPrompt, riskLevel, missingChecks }) });
    if (decision === "approve") {
        updateOrganizerTaskIteration(db, iteration.id, { status: "approved" });
        if (task.autoApprove) {
            if (task.autoApply && changeSetId) {
                const applyRes = await client.applyChange?.(changeSetId, { hunks: false });
                if (applyRes?.ok) {
                    updateOrganizerTask(db, taskId, { status: "completed" });
                    recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "auto_approved", message: "Auto-approved and applied by reviewer" });
                    return { ok: true, message: "Auto-approved and applied.", remoteTaskId: remoteId, remoteChangeSetId: changeSetId, decision };
                }
                updateOrganizerTask(db, taskId, { status: "needs_review" });
                recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "auto_approved", message: `Auto-approved but apply failed: ${applyRes?.error ?? "unknown"}` });
                return { ok: true, message: `Auto-approved but apply failed. Needs user review.`, remoteTaskId: remoteId, remoteChangeSetId: changeSetId, decision };
            }
            updateOrganizerTask(db, taskId, { status: "auto_approved" });
            recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "auto_approved", message: "Auto-approved by reviewer" });
        }
        else {
            updateOrganizerTask(db, taskId, { status: "needs_review" });
            recordOrganizerTaskEvent(db, { taskId, agentId: agent.id, eventType: "needs_user_review", message: "Reviewer approved; awaiting user" });
        }
        return { ok: true, message: `Reviewer approved. ${task.autoApprove ? (task.autoApply ? "Auto-approved and applied." : "Auto-approved.") : "Awaiting user approval."}`, remoteTaskId: remoteId, remoteChangeSetId: changeSetId, decision };
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
function buildImplementationPrompt(args) {
    const { task, iterIndex, maxIter, prev } = args;
    const lines = [];
    if (iterIndex === 1) {
        lines.push("You are Agent Smith's implementation model.", "Your job is to produce the smallest safe code change for the assigned task.", "", "Rules:", "- Do not rewrite unrelated code.", "- Do not perform broad refactors unless the task explicitly requires it.", "- Prefer minimal, testable changes.", "- Preserve existing style and architecture.", "- If the context is insufficient, explain exactly what is missing.", "- Return a proposed patch/change only through the normal Agent Smith patch flow.", "- Do not mark the task complete yourself.", "", "Task:", task.title, "", "Task prompt:", task.prompt);
    }
    else {
        lines.push(`This is implementation iteration ${iterIndex} of ${maxIter}.`, "Your job is to revise the previous proposed change according to reviewer feedback.", "", "Rules:", "- Address the reviewer feedback directly.", "- Do not undo correct parts of the previous implementation unless needed.", "- Keep the change minimal.", "- Avoid unrelated refactors.", "- If the reviewer requested tests, add the smallest relevant tests.", "- If the requested change is unsafe or impossible, explain why.", "", "Original task:", task.title, `Original prompt: ${task.prompt}`);
        if (prev?.implementationSummary)
            lines.push(`\nPrevious implementation summary: ${prev.implementationSummary.slice(0, 1500)}`);
        if (prev?.changedFilesJson) {
            try {
                const prevFiles = JSON.parse(prev.changedFilesJson);
                if (prevFiles.length)
                    lines.push(`\nPrevious changed files: ${prevFiles.join(", ")}`);
            }
            catch { /* skip */ }
        }
        if (prev?.reviewFeedback)
            lines.push(`\nReviewer feedback: ${prev.reviewFeedback}`);
        if (prev?.reviewNextPrompt)
            lines.push(`\nNext implementation instructions: ${prev.reviewNextPrompt}`);
    }
    lines.push("", "Implementation policy:", `- Implement model: ${task.implementModel ?? "(default)"}`, `- Review model: ${task.reviewModel ?? "(none)"}`, `- Iteration: ${iterIndex} / ${maxIter}`, `- Auto approve: ${task.autoApprove}`, `- Auto apply: ${task.autoApply}`, `- Required checks: ${task.checksJson ?? "(none)"}`, "", "Context instructions:", "- Use the retrieved context packet.", "- Prefer files and symbols selected by Agent Smith.", "- If tests are included, update or add the smallest relevant tests.");
    return lines.join("\n");
}
function buildReviewPrompt(task, iteration, originalPrompt, result, files, prev, iterIndex, maxIter) {
    const lines = [
        `Review the following proposed change for task: "${task.title}"`,
        `Iteration ${iterIndex ?? "?"} of ${maxIter ?? "?"}`,
        "",
        `Original task prompt: ${task.prompt}`,
    ];
    if (prev?.reviewFeedback) {
        lines.push(`\nPrevious reviewer feedback: ${prev.reviewFeedback}`);
    }
    if (iteration.implementationSummary) {
        lines.push(`\nImplementation summary: ${iteration.implementationSummary.slice(0, 2000)}`);
    }
    if (files) {
        lines.push(`\nChanged files (${files.length}):`);
        for (const f of files.slice(0, 20))
            lines.push(`  - ${f}`);
    }
    if (iteration.diffPreview) {
        lines.push(`\nDiff preview:\n\`\`\`diff\n${iteration.diffPreview.slice(0, 3000)}\n\`\`\``);
    }
    if (iteration.checkResultsJson) {
        try {
            const checks = JSON.parse(iteration.checkResultsJson);
            if (checks.length > 0) {
                lines.push(`\nCheck results:`);
                for (const c of checks)
                    lines.push(`  ${c.ok ? "✓" : "✗"} ${c.name}`);
            }
        }
        catch { /* skip */ }
    }
    lines.push("", `Respond with JSON only:`, `{"decision":"approve"|"request_changes"|"reject","feedback":"...","nextPrompt":"...","riskLevel":"low"|"medium"|"high","missingChecks":["typecheck","test"],"notes":"..."}`, `- approve: the change satisfies the task and appears safe`, `- request_changes: close but needs specific improvements in another iteration`, `- reject: wrong, unsafe, too broad, or should not continue`, `- riskLevel: your assessment of the change's risk`, `- missingChecks: any checks that should have run but are missing`, `- notes: optional short notes for the human reviewer`, `- do not produce code`);
    return lines.join("\n");
}
function compactPreview(diff, maxLines = 200) {
    if (!diff)
        return "";
    const lines = diff.split("\n");
    const out = [];
    for (const line of lines.slice(0, maxLines)) {
        const t = line.trim();
        if (t.startsWith("diff --git") || t.startsWith("---") || t.startsWith("+++") || t.startsWith("@@") || line.startsWith("+") || line.startsWith("-")) {
            out.push(line);
        }
        else if (out.length === 0 || out[out.length - 1] !== "") {
            out.push(line);
        }
    }
    if (lines.length > maxLines)
        out.push("... diff preview truncated ...");
    return out.join("\n");
}
