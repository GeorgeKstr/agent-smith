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

  const noEdits = input.evidence.filesEdited.length === 0 && input.evidence.filesCreated.length === 0;

  return {
    allowed: false,
    summary: noEdits
      ? "STOP SEARCHING. You have not created or edited any files yet. Use create_file or bash now."
      : "Edit pressure active. Further searching blocked. Make a change.",
    nextActions: noEdits
      ? [
          `Use create_file to create a new file. Example: <tool_call>{"tool":"create_file","args":{"path":"src/example.ts","content":"..."}}</tool_call>`,
          "Use bash to run shell commands: mkdir, npm, git, etc.",
          "Call edit if you have already read the file you need to change."
        ]
      : [
          `Call edit for one of: ${inspected}.`,
          "Call create_file to add a new file.",
          "Call bash to run a shell command.",
          "Call final only if the task is truly complete."
        ]
  };
}
