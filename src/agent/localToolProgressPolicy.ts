import type { LocalToolProgress } from "./localToolProgress.js";

export type ProgressPolicyDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      summary: string;
      nextActions: string[];
    };

export function checkLocalToolProgressPolicy(input: {
  toolName: string;
  args: Record<string, unknown>;
  progress: LocalToolProgress;
  maxConsecutiveSearches: number;
  maxConsecutiveReads: number;
}): ProgressPolicyDecision {
  const { toolName, progress } = input;

  if (toolName === "search" && progress.consecutiveSearches >= input.maxConsecutiveSearches) {
    return {
      allowed: false,
      summary:
        "Search limit reached. You have already searched repeatedly without reading any result.",
      nextActions: [
        "Call read on one of the files returned by the previous search.",
        "Use final if no search result is relevant.",
        "Use a more specific search only if the previous search returned no usable files."
      ]
    };
  }

  if (toolName === "read" && progress.consecutiveReads >= input.maxConsecutiveReads) {
    return {
      allowed: false,
      summary:
        "Read limit reached. You have already read repeatedly without making progress.",
      nextActions: [
        "Use edit or create_file if you have enough information.",
        "Use check if changes were made.",
        "Use final if no change is needed."
      ]
    };
  }

  return { allowed: true };
}
