export type ExplorationResult = {
  inspectedFiles: Array<{
    path: string;
    ranges: string[];
    reason: string;
    relevant: boolean;
  }>;
  likelyEditTargets: Array<{
    path: string;
    target: string;
    reason: string;
  }>;
  unresolvedQuestions: string[];
  enoughContext: boolean;
};

export function emptyExplorationResult(): ExplorationResult {
  return {
    inspectedFiles: [],
    likelyEditTargets: [],
    unresolvedQuestions: [],
    enoughContext: false,
  };
}

export function buildExplorationResult(input: {
  filesRead: Array<{ path: string; ranges: string[]; summary: string }>;
  toolResults: Array<{ tool: string; ok: boolean; summary: string }>;
  remainingUnknowns: string[];
}): ExplorationResult {
  const inspected = input.filesRead.map((f) => ({
    path: f.path,
    ranges: f.ranges.map(String),
    reason: f.summary || "inspected",
    relevant: true,
  }));

  const targets = input.filesRead
    .filter((f) => f.summary && !f.summary.toLowerCase().includes("no relevant"))
    .map((f) => ({
      path: f.path,
      target: f.ranges.length > 0 ? f.ranges[0] : "full file",
      reason: f.summary || "potential edit target",
    }));

  const searches = input.toolResults.filter((r) => r.tool === "search").length;

  return {
    inspectedFiles: inspected.slice(0, 8),
    likelyEditTargets: targets.slice(0, 6),
    unresolvedQuestions: input.remainingUnknowns.slice(0, 4),
    enoughContext: inspected.length >= 1 || (searches >= 3 && inspected.length === 0),
  };
}

export function renderExplorationForPlan(input: {
  exploration: ExplorationResult;
  packetGoal: string;
}): string {
  const lines: string[] = [];

  lines.push("## EXPLORATION RESULT");

  if (input.exploration.inspectedFiles.length > 0) {
    lines.push("\nInspected files:");
    for (const f of input.exploration.inspectedFiles.slice(0, 6)) {
      const ranges = f.ranges.length > 0 ? ` (${f.ranges.join(", ")})` : "";
      const rel = f.relevant ? "relevant" : "not relevant";
      lines.push(`- ${f.path}${ranges} [${rel}]: ${f.reason}`);
    }
  }

  if (input.exploration.likelyEditTargets.length > 0) {
    lines.push("\nLikely edit targets:");
    for (const t of input.exploration.likelyEditTargets.slice(0, 4)) {
      lines.push(`- ${t.path}: ${t.target} (${t.reason})`);
    }
  }

  if (input.exploration.unresolvedQuestions.length > 0) {
    lines.push("\nUnresolved:");
    for (const q of input.exploration.unresolvedQuestions.slice(0, 3)) {
      lines.push(`- ${q}`);
    }
  }

  return lines.join("\n");
}

export function renderExplorationForApply(input: {
  exploration: ExplorationResult;
  plan: { edits?: Array<{ path: string; target: string }> };
}): string {
  const lines: string[] = [];

  lines.push("## EXPLORATION SUMMARY");

  if (input.exploration.inspectedFiles.length > 0) {
    const paths = input.exploration.inspectedFiles
      .filter((f) => f.relevant)
      .slice(0, 4)
      .map((f) => f.path);
    if (paths.length > 0) {
      lines.push(`Inspected: ${paths.join(", ")}`);
    }
  }

  if (input.plan.edits && input.plan.edits.length > 0) {
    lines.push("\nEdit targets from plan:");
    for (const e of input.plan.edits.slice(0, 4)) {
      lines.push(`- ${e.path}: ${e.target}`);
    }
  }

  return lines.join("\n");
}
