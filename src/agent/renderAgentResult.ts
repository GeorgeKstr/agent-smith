import type { FocusedAgentResult } from "../agent/focusedAgentLoop.js";
import type { PatchWorkflowResult } from "../agent/runPatchWorkflow.js";

export function renderAgentResult(result: {
  status: string;
  finalText: string;
  evidence: FocusedAgentResult["evidence"];
  stopReason?: string;
  pendingOperations?: string[];
  metrics?: unknown;
  changedFiles?: string[];
  checksRun?: string[];
}): string {
  const status = result.status;
  const stopReason = "stopReason" in result ? result.stopReason : undefined;
  const evidence = result.evidence;
  const pendingOps = "pendingOperations" in result ? result.pendingOperations : evidence.pendingFileOperations;

  switch (status) {
    case "completed":
      if (evidence.filesEdited.length > 0 || evidence.filesCreated.length > 0) {
        return renderChanged(result.finalText, evidence);
      }
      if (evidence.filesRead.length > 0 && evidence.filesEdited.length === 0 && evidence.filesCreated.length === 0) {
        return renderReadOnly(result.finalText, evidence);
      }
      return result.finalText;

    case "waiting_for_approval":
      return renderPendingApproval(result.finalText, evidence, pendingOps ?? []);

    case "waiting_for_user":
      return result.finalText;

    case "partial":
      if (stopReason === "no_change_answer") {
        return renderNoChange(result.finalText, evidence);
      }
      if (evidence.filesEdited.length > 0 || evidence.filesCreated.length > 0) {
        return renderPartial(result.finalText, evidence, result);
      }
      return renderPartial(result.finalText, evidence, result);

    case "failed":
      return renderFailed(result.finalText, evidence, stopReason);

    case "blocked":
      return renderBlocked(result.finalText, stopReason);

    default:
      return result.finalText;
  }
}

function renderReadOnly(finalText: string, evidence: FocusedAgentResult["evidence"]): string {
  const lines: string[] = [];

  if (finalText.trim()) {
    lines.push(finalText.trim());
  }

  // Compact evidence
  if (evidence.filesRead.length > 0) {
    const unique = [...new Set(evidence.filesRead)].slice(-3);
    lines.push(`\nFiles inspected: ${unique.join(", ")}`);
  }

  return lines.join("\n") || "Answered.";
}

function renderChanged(finalText: string, evidence: FocusedAgentResult["evidence"]): string {
  const lines: string[] = [];

  if (finalText.trim()) {
    lines.push(finalText.trim());
  }

  const paths = [...new Set([...evidence.filesEdited, ...evidence.filesCreated])];
  if (paths.length > 0) {
    lines.push(`\nChanged: ${paths.join(", ")}`);
  }

  const passed = evidence.checksRun.filter((c) => c.ok).length;
  const total = evidence.checksRun.length;
  if (total > 0) {
    lines.push(`Checks: ${passed}/${total} passed`);
  }

  return lines.join("\n");
}

function renderNoChange(finalText: string, evidence: FocusedAgentResult["evidence"]): string {
  const lines: string[] = [];

  lines.push("Answered without changes.");

  if (finalText.trim()) {
    lines.push(`\n${finalText.trim()}`);
  }

  if (evidence.filesRead.length > 0) {
    const unique = [...new Set(evidence.filesRead)].slice(-3);
    lines.push(`\nFiles inspected: ${unique.join(", ")}`);
    lines.push("Changes made: 0");
  }

  return lines.join("\n");
}

function renderPendingApproval(
  finalText: string,
  evidence: FocusedAgentResult["evidence"],
  pendingOps: string[],
): string {
  const lines: string[] = [];

  lines.push("Proposed changes awaiting approval.");

  if (finalText.trim() && !finalText.startsWith("File changes queued")) {
    lines.push(`\n${finalText.trim()}`);
  }

  if (pendingOps.length > 0) {
    lines.push(`\nPending operations: ${pendingOps.join(", ")}`);
    lines.push("\nUse CLI to approve/reject:");
    for (const id of pendingOps) {
      lines.push(`  smith approvals approve ${id}`);
      lines.push(`  smith approvals reject ${id}`);
    }
  }

  return lines.join("\n");
}

function renderPartial(
  finalText: string,
  evidence: FocusedAgentResult["evidence"],
  result: { metrics?: unknown },
): string {
  const lines: string[] = [];

  if (finalText.trim()) {
    lines.push(finalText.trim());
  }

  const m = result.metrics as { modelTurns?: number; toolCallsRequested?: number } | undefined;
  if (m) {
    lines.push(`\nProgress: ${m.modelTurns} turns, ${m.toolCallsRequested} tool calls`);
  }
  if (evidence.filesRead.length > 0) {
    const unique = [...new Set(evidence.filesRead)].slice(-3);
    lines.push(`Inspected: ${unique.join(", ")}`);
  }

  return lines.join("\n") || "Partially completed.";
}

function renderFailed(
  finalText: string,
  evidence: FocusedAgentResult["evidence"],
  stopReason?: string,
): string {
  const lines: string[] = [];

  lines.push("Could not complete.");

  if (stopReason && stopReason !== "no_verified_completion") {
    lines.push(`\nReason: ${stopReason.replace(/_/g, " ")}`);
  }

  if (evidence.filesRead.length > 0) {
    const unique = [...new Set(evidence.filesRead)].slice(-4);
    lines.push(`\nFiles inspected: ${unique.join(", ")}`);
  }

  const toolFailures = evidence.toolResults.filter((r) => !r.ok).slice(-3);
  if (toolFailures.length > 0) {
    lines.push("\nRecent failures:");
    for (const f of toolFailures) {
      lines.push(`- ${f.tool}: ${f.summary}`);
    }
  }

  if (finalText.trim() && !finalText.startsWith("Could not complete")) {
    lines.push(`\n${finalText.slice(0, 300)}`);
  }

  return lines.join("\n");
}

function renderBlocked(finalText: string, stopReason?: string): string {
  const lines: string[] = [];

  lines.push("Blocked.");

  if (stopReason) {
    lines.push(`\nReason: ${stopReason.replace(/_/g, " ")}`);
  }

  if (finalText.trim()) {
    lines.push(`\n${finalText.trim().slice(0, 200)}`);
  }

  return lines.join("\n");
}
