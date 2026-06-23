import type { TaskPacket } from "../context/taskPacket.js";

export type WorkingMemory = {
  goal: string;
  successCriteria: string[];
  confirmedFacts: string[];
  filesRead: Array<{
    path: string;
    ranges: string[];
    summary: string;
  }>;
  currentHypothesis: string;
  editPlan: string[];
  editsApplied: string[];
  checkResults: string[];
  bashResults: Array<{ command: string; exitCode: number; ok: boolean }>;
  remainingUnknowns: string[];
  warnings: string[];
};

export function createWorkingMemory(packet: TaskPacket): WorkingMemory {
  return {
    goal: packet.goal,
    successCriteria: [...packet.successCriteria],
    confirmedFacts: [],
    filesRead: [],
    currentHypothesis: "",
    editPlan: [],
    editsApplied: [],
    checkResults: [],
    bashResults: [],
    remainingUnknowns: packet.keywords.map((k) => `Unknown: how does ${k} relate?`).slice(0, 4),
    warnings: [],
  };
}

export function renderWorkingMemory(memory: WorkingMemory): string {
  const lines: string[] = [];

  lines.push(`## WORKING MEMORY`);
  lines.push(`Goal: ${memory.goal}`);

  if (memory.successCriteria.length > 0) {
    lines.push(`Success: ${memory.successCriteria.join(" | ")}`);
  }

  if (memory.confirmedFacts.length > 0) {
    lines.push("Facts:");
    for (const fact of memory.confirmedFacts.slice(0, 8)) {
      lines.push(`- ${fact}`);
    }
  }

  if (memory.filesRead.length > 0) {
    lines.push("Files inspected:");
    for (const f of memory.filesRead.slice(0, 6)) {
      const ranges = f.ranges.length > 0 ? ` (${f.ranges.join(", ")})` : "";
      lines.push(`- ${f.path}${ranges}: ${f.summary}`);
    }
  }

  if (memory.currentHypothesis) {
    lines.push(`Hypothesis: ${memory.currentHypothesis}`);
  }

  if (memory.editPlan.length > 0) {
    lines.push("Edit plan:");
    for (const step of memory.editPlan.slice(0, 6)) {
      lines.push(`- ${step}`);
    }
  }

  if (memory.editsApplied.length > 0) {
    lines.push("Edits applied:");
    for (const edit of memory.editsApplied.slice(0, 6)) {
      lines.push(`- ${edit}`);
    }
  }

  if (memory.checkResults.length > 0) {
    lines.push("Check results:");
    for (const result of memory.checkResults.slice(0, 4)) {
      lines.push(`- ${result}`);
    }
  }

  if (memory.bashResults.length > 0) {
    lines.push("Recent shell commands:");
    for (const r of memory.bashResults.slice(-4)) {
      lines.push(`- ${r.ok ? "OK" : `EXIT ${r.exitCode}`} ${r.command}`);
    }
  }

  if (memory.remainingUnknowns.length > 0) {
    lines.push("Remaining unknowns:");
    for (const u of memory.remainingUnknowns.slice(0, 4)) {
      lines.push(`- ${u}`);
    }
  }

  if (memory.warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of memory.warnings.slice(0, 3)) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join("\n");
}

export function mergeWorkingMemory(
  oldMemory: WorkingMemory,
  update: Partial<WorkingMemory>
): WorkingMemory {
  return {
    goal: update.goal ?? oldMemory.goal,
    successCriteria: update.successCriteria ?? oldMemory.successCriteria,
    confirmedFacts: dedupe([
      ...oldMemory.confirmedFacts,
      ...(update.confirmedFacts ?? []),
    ]),
    filesRead: dedupeFiles([...oldMemory.filesRead, ...(update.filesRead ?? [])]),
    currentHypothesis: update.currentHypothesis ?? oldMemory.currentHypothesis,
    editPlan: dedupe([...oldMemory.editPlan, ...(update.editPlan ?? [])]),
    editsApplied: dedupe([...oldMemory.editsApplied, ...(update.editsApplied ?? [])]),
    checkResults: dedupe([...oldMemory.checkResults, ...(update.checkResults ?? [])]),
    bashResults: [...oldMemory.bashResults, ...(update.bashResults ?? [])],
    remainingUnknowns: dedupe([
      ...oldMemory.remainingUnknowns,
      ...(update.remainingUnknowns ?? []),
    ]),
    warnings: dedupe([...oldMemory.warnings, ...(update.warnings ?? [])]),
  };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function dedupeFiles(
  files: WorkingMemory["filesRead"]
): WorkingMemory["filesRead"] {
  const seen = new Set<string>();
  return files.filter((f) => {
    const key = `${f.path}:${f.ranges.join(",")}:${f.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
