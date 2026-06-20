import type { PatchPhase } from "./patchPhase.js";
import type { LocalToolProgress } from "./localToolProgress.js";

export type PatchPhasePolicyDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      summary: string;
      nextActions: string[];
    };

export function checkPatchPhasePolicy(input: {
  phase: PatchPhase;
  toolName: string;
  args: Record<string, unknown>;
  progress: LocalToolProgress;
  maxTotalSearchesPerRun: number;
  maxSearchesAfterFirstRead: number;
  requireReasonForSearchAfterRead: boolean;
}): PatchPhasePolicyDecision {
  const {
    phase,
    toolName,
    args,
    progress,
    maxTotalSearchesPerRun,
    maxSearchesAfterFirstRead,
    requireReasonForSearchAfterRead
  } = input;

  if (toolName !== "search") {
    return { allowed: true };
  }

  if (progress.totalSearches >= maxTotalSearchesPerRun) {
    return {
      allowed: false,
      summary:
        "Search limit reached. Patch mode cannot keep searching without making a change.",
      nextActions: [
        "Read one of the already discovered files.",
        "Edit, replace lines, or create file in an inspected file.",
        "Use final if no relevant file can be found or no change is needed."
      ]
    };
  }

  if (phase === "ready_to_change" || phase === "ready_to_propose" || phase === "changed" || phase === "verified") {
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    const query = typeof args.query === "string" ? args.query.trim() : "";

    if (progress.searchesAfterFirstRead >= maxSearchesAfterFirstRead) {
      return {
        allowed: false,
        summary:
          "Search after read limit reached. You already inspected a file and must now make progress.",
        nextActions: [
          "Edit the inspected file if it contains the issue.",
          "Read a specific nearby range or related file if more context is needed.",
          "Use final and explain why no edit is needed."
        ]
      };
    }

    if (requireReasonForSearchAfterRead && !reason) {
      return {
        allowed: false,
        summary:
          "Search after reading a file requires a specific reason in the 'reason' field.",
        nextActions: [
          "Include a reason such as: the inspected file imports a symbol defined elsewhere.",
          "Otherwise edit the inspected file or use final with explanation."
        ]
      };
    }

    if (isBroadSearchQuery(query)) {
      return {
        allowed: false,
        summary:
          `Search query "${query}" is too broad after a file has already been read.`,
        nextActions: [
          "Use a specific function name, component name, symbol, or error message.",
          "Edit the inspected file if enough context is available.",
          "Use final if no change is needed."
        ]
      };
    }
  }

  return { allowed: true };
}

export function isBroadSearchQuery(query: string): boolean {
  const q = query.toLowerCase().trim();

  if (q.length <= 3) return true;

  return [
    "mode",
    "config",
    "client",
    "src",
    "file",
    "files",
    "app",
    "index",
    "main",
    "component",
    "tool",
    "tools",
    "state",
    "data",
    "type",
    "types",
    "api",
    "server",
    "route",
    "routes",
    "page",
    "pages",
    "util",
    "utils",
    "lib",
    "test",
    "tests",
  ].includes(q);
}
