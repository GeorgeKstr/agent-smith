import type { RuntimeIntent } from "./runtimeIntent.js";
import type { RunEvidence } from "./runEvidence.js";

export type EditPressureDecision =
  | { allowed: true }
  | {
      allowed: false;
      summary: string;
      nextActions: string[];
    };

export function checkEditPressurePolicy(input: {
  runtimeIntent: RuntimeIntent;
  toolName: string;
  evidence: RunEvidence;
  totalSearches: number;
  maxReadsBeforeEditPressure: number;
  maxSearchesBeforeEditPressure: number;
  allowReadAfterEditPressure: boolean;
}): EditPressureDecision {
  if (input.runtimeIntent !== "patch") {
    return { allowed: true };
  }

  const changed =
    input.evidence.filesEdited.length > 0 ||
    input.evidence.filesCreated.length > 0;

  if (changed) return { allowed: true };

  const readCount = input.evidence.filesRead.length;
  const searchCount = input.totalSearches;

  const pressureActive =
    readCount >= input.maxReadsBeforeEditPressure ||
    searchCount >= input.maxSearchesBeforeEditPressure;

  if (!pressureActive) return { allowed: true };

  const allowedUnderPressure = [
    "propose_edit",
    "edit",
    "replace_lines",
    "create_file",
    "ask_user",
    "finish",
    "check",
    "bash",
  ];

  if (input.allowReadAfterEditPressure) {
    allowedUnderPressure.push("read");
  }

  if (allowedUnderPressure.includes(input.toolName)) {
    return { allowed: true };
  }

  const inspected = input.evidence.filesRead.length > 0
    ? input.evidence.filesRead.join(", ")
    : "none";

  return {
    allowed: false,
    summary:
      "Edit pressure active. Enough context has been inspected for this patch task. Further searching is blocked until you propose or make a change.",
    nextActions: [
      `Call propose_edit for one of the inspected files (${inspected}).`,
      "Call edit or replace_lines if you know the exact change.",
      "Call ask_user if the requested behavior is ambiguous.",
      "Call final only if no edit is needed and explain why."
    ]
  };
}
