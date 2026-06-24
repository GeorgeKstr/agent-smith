import type { AgentRunMetrics } from "./runMetrics.js";
import type { RunEvidence } from "./runEvidence.js";

export type CompletionGateResult = {
  canComplete: boolean;
  status: "completed" | "partial" | "failed" | "waiting_for_approval";
  warnings: string[];
  reason: string;
};

export function canCompleteRun(input: {
  mode: "ask" | "patch";
  finalText: string;
  metrics: AgentRunMetrics;
  evidence: RunEvidence;
  allowNoEditCompletion?: boolean;
  allowInspectedNoEditFinal?: boolean;
  allowUsefulNoChangeAnswer?: boolean;
  runtimeIntent?: string;
}): CompletionGateResult {
  const { mode, finalText, metrics, evidence } = input;

  if (mode === "ask") {
    if (finalText.trim().length > 0) {
      return { canComplete: true, status: "completed", warnings: [], reason: "Ask mode produced a final answer." };
    }
    return { canComplete: false, status: "failed", warnings: ["Ask mode produced no final answer."], reason: "No final text." };
  }

  // Patch mode
  const changed = evidence.filesEdited.length > 0 || evidence.filesCreated.length > 0;
  const checkPassed = evidence.checksRun.some((c) => c.ok);
  const hasPending = (evidence.pendingFileOperations?.length ?? 0) > 0;

  if (hasPending) {
    return {
      canComplete: false,
      status: "waiting_for_approval",
      warnings: [`${evidence.pendingFileOperations?.length ?? 0} file operation(s) are pending user approval.`],
      reason: "The agent proposed file changes, but they have not been approved/applied yet.",
    };
  }

  if (input.allowNoEditCompletion && finalText.trim().length > 0) {
    return { canComplete: true, status: "completed", warnings: ["No edits were required for this task."], reason: "Patch mode allowed to complete without edits." };
  }

  if (
    input.allowInspectedNoEditFinal &&
    evidence.filesRead.length > 0 &&
    finalText.trim().length > 80
  ) {
    return {
      canComplete: true,
      status: "completed",
      warnings: ["No file changes were made after inspection."],
      reason: "The agent inspected relevant files and explained that no edit was needed."
    };
  }

  if (
    input.allowUsefulNoChangeAnswer &&
    isUsefulNoChangeAnswer({ finalText, evidence })
  ) {
    return {
      canComplete: true,
      status: "completed",
      warnings: ["Answered without making file changes."],
      reason: "The model inspected files and produced a useful no-change answer.",
    };
  }

  // Plain non-code file creation doesn't need code checks
  if (!evidence.filesEdited.length && evidence.filesCreated.length > 0 &&
      evidence.filesCreated.every((p) => !/[.](ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|cpp|h|hpp|cs|php|rb|swift|kt)$/i.test(p))) {
    return { canComplete: true, status: "completed", warnings: ["No code check was required for plain file creation."], reason: "Plain non-code file was created successfully." };
  }

  if (changed && checkPassed) {
    return { canComplete: true, status: "completed", warnings: [], reason: "Files were changed and at least one check passed." };
  }

  // Edits were made but no check passed. Checks are best-effort: many projects
  // have none configured, and local models often skip the check tool. Treat a
  // real file change as a completed run (with a warning) rather than failing.
  if (changed) {
    const warnings: string[] = [];
    if (evidence.checksRun.length === 0) warnings.push("Files were changed but no checks were run.");
    else warnings.push("Files were changed but no check passed — please verify manually.");
    return {
      canComplete: true,
      status: "completed",
      warnings,
      reason: "Files were changed. Checks are best-effort and not required for completion.",
    };
  }

  const warnings: string[] = [];
  if (metrics.toolCallsRequested === 0) warnings.push("No tools were called.");
  if (!changed) warnings.push("No files were changed.");
  if (evidence.filesCreated.length > 0 && !evidence.filesEdited.length) warnings.push("Files were created but no code edits or checks verified.");
  if (evidence.checksRun.length === 0) warnings.push("No checks were run.");
  else if (!checkPassed) warnings.push("No checks passed.");
  if (metrics.progressPolicyRejections > 0) warnings.push(`${metrics.progressPolicyRejections} tool call(s) were blocked by progress policy (search/read loops).`);
  if (metrics.searches > 2 && metrics.reads === 0) warnings.push("Search-only loop detected: multiple searches with no reads.");

  return {
    canComplete: false,
    status: changed ? "partial" : "failed",
    warnings,
    reason: "Patch mode completion requires verified change evidence.",
  };
}

export function buildNoEvidenceMessage(input: {
  mode: "ask" | "patch";
  metrics: AgentRunMetrics;
  evidence: RunEvidence;
  modelOutput?: string;
  gateResult: CompletionGateResult;
}): string {
  const noEdits = input.evidence.filesEdited.length === 0 && input.evidence.filesCreated.length === 0;

  const lines: string[] = [];
  if (noEdits) {
    lines.push("You have NOT created or edited any files yet. You MUST use create_file or edit to make changes before using <final>.");
    lines.push("Example: <tool_call>{\"tool\":\"create_file\",\"args\":{\"path\":\"src/example.ts\",\"content\":\"...\"}}</tool_call>");
  } else {
    lines.push(input.gateResult.reason);
  }

  if (input.modelOutput) {
    const clipped = input.modelOutput.length > 200 ? input.modelOutput.slice(0, 200) + "..." : input.modelOutput;
    lines.push(`\nYour last output (rejected): ${clipped}`);
  }

  if (noEdits && input.evidence.filesRead.length > 0) {
    const unique = [...new Set(input.evidence.filesRead)].slice(-4);
    lines.push(`\nYou already read: ${unique.join(", ")}. Now edit one of these files or create a new one.`);
  }

  if (input.gateResult.warnings.length > 0) {
    lines.push(`\nWarnings:`);
    for (const w of input.gateResult.warnings) lines.push(`- ${w}`);
  }

  return lines.join("\n");
}

function isUsefulNoChangeAnswer(input: {
  finalText: string;
  evidence: RunEvidence;
}): boolean {
  const text = input.finalText.trim();

  if (text.length < 40) return false;

  const bad = /^(done|fixed|task completed|completed|ok|finished|ready|success)$/i.test(text);
  if (bad) return false;

  if (input.evidence.filesRead.length === 0 && text.length < 120) return false;

  return true;
}
