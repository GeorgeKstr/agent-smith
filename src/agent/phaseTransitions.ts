import type { RunEvidence, CheckEvidence } from "./runEvidence.js";
import type { PatchPlan } from "./artifacts/patchPlan.js";
import type { PatchApplicationResult } from "./artifacts/patchApplicationResult.js";

export function shouldExitExplore(input: {
  evidence: RunEvidence;
  maxSearches: number;
  maxReads: number;
}): { shouldExit: boolean; reason: string } {
  const searchesDone = input.evidence.toolResults.filter(
    (r: { tool: string }) => r.tool === "search"
  ).length;
  const readsDone = input.evidence.filesRead.length;

  if (readsDone >= input.maxReads) {
    return { shouldExit: true, reason: `Reached max reads (${readsDone}/${input.maxReads}).` };
  }

  if (searchesDone >= input.maxSearches && readsDone >= 1) {
    return { shouldExit: true, reason: `Explored enough (${searchesDone} searches, ${readsDone} reads).` };
  }

  if (searchesDone >= input.maxSearches + 2 && readsDone === 0) {
    return { shouldExit: true, reason: `No relevant files found after ${searchesDone} searches.` };
  }

  return { shouldExit: false, reason: "" };
}

export function shouldExitPlanPatch(plan: PatchPlan): {
  shouldExit: boolean;
  reason: string;
} {
  if (plan.edits.length > 0) {
    return { shouldExit: true, reason: `Patch plan has ${plan.edits.length} edit(s).` };
  }

  if (plan.needsUserInput) {
    return { shouldExit: true, reason: "Patch plan needs user input." };
  }

  return { shouldExit: false, reason: "Plan has no edits and no user questions." };
}

export function shouldExitApplyPatch(result: PatchApplicationResult): {
  shouldExit: boolean;
  reason: string;
} {
  if (result.changed) {
    return {
      shouldExit: true,
      reason: `Applied: ${result.filesEdited.length} edited, ${result.filesCreated.length} created.`,
    };
  }

  if (result.failedEdits.length >= 3) {
    return {
      shouldExit: true,
      reason: `Too many failed edits (${result.failedEdits.length}).`,
    };
  }

  return { shouldExit: false, reason: "No changes applied yet." };
}

export function shouldExitVerify(input: {
  checksRun: CheckEvidence[];
  maxCheckAttempts: number;
}): { shouldExit: boolean; reason: string } {
  if (input.checksRun.some((c) => c.ok)) {
    return { shouldExit: true, reason: "At least one check passed." };
  }

  if (input.checksRun.length >= input.maxCheckAttempts) {
    return {
      shouldExit: true,
      reason: `Reached max check attempts (${input.checksRun.length}).`,
    };
  }

  return { shouldExit: false, reason: "" };
}
