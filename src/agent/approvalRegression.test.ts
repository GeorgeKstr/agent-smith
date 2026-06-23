import {
  test, assert, eq, contains, notContains, summarize,
} from "./trajectoryHarness.js";
import { classifyRuntimeIntent } from "./classifyRuntimeIntent.js";
import { parseExplicitMode } from "./parseExplicitMode.js";
import { canCompleteRun } from "./completionGate.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import { renderAgentResult } from "./renderAgentResult.js";
import { shouldQueueFileOperation, riskForKind } from "./approval/approvalTypes.js";
import type { ApprovalPolicyKind, FileOperationKind } from "./approval/approvalTypes.js";

// ═══════════════════════════════════════════════════════════════════
// 1. Read-Only Status/History Questions
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Read-Only Status Questions ===\n");

const readOnlyPrompts = [
  "what was the last file we created?",
  "what did helloworld.txt contain?",
  "which file did you modify?",
  "show me the last change",
  "tell me what files changed",
  "what is in helloworld.txt?",
  "what file did you make?",
  "what was the last file created?",
  "list the files you changed",
  "show me what was modified",
];

for (const prompt of readOnlyPrompts) {
  test(`${prompt.slice(0, 45)}... -> ask`, () => {
    const { explicitMode, cleanedPrompt } = parseExplicitMode(prompt);
    const r = classifyRuntimeIntent({
      prompt: cleanedPrompt,
      uiMode: "build",
      explicitMode,
    });
    eq(r.intent, "ask", `should be ask, got ${r.intent}`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 2. Read-Only in Build Mode Still Ask
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Build Mode + Read-Only = Ask ===\n");

test("build: what file did we create? -> ask", () => {
  const r = classifyRuntimeIntent({
    prompt: "what file did we create?",
    uiMode: "build",
    explicitMode: "auto",
  });
  eq(r.intent, "ask", "build mode should not override read-only ask");
});

test("build: what is in helloworld.txt? -> ask", () => {
  const r = classifyRuntimeIntent({
    prompt: "what is in helloworld.txt?",
    uiMode: "build",
    explicitMode: "auto",
  });
  eq(r.intent, "ask", "should be ask");
});

// ═══════════════════════════════════════════════════════════════════
// 3. Patch Requests Still Patch
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Patch Requests Stay Patch ===\n");

const patchPrompts = [
  "create helloworld.txt",
  "edit the config file",
  "fix the /mode bug",
  "delete old config file",
  "rename getUser to fetchUser",
];

for (const prompt of patchPrompts) {
  test(`${prompt} -> patch`, () => {
    const { explicitMode, cleanedPrompt } = parseExplicitMode(prompt);
    const r = classifyRuntimeIntent({
      prompt: cleanedPrompt,
      uiMode: "build",
      explicitMode,
    });
    eq(r.intent, "patch", `should be patch, got ${r.intent}`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 4. Useful No-Change Answer Completion
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Useful No-Change Answer ===\n");

test("useful no-change answer completes in patch mode", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("helloworld.txt");
  evidence.toolResults.push({
    tool: "read",
    ok: true,
    summary: "Read helloworld.txt:1-10 (1/10 lines)",
  });

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "The last file we created is helloworld.txt. It contains: Hello, world!",
    metrics: createEmptyRunMetrics(),
    evidence,
    allowUsefulNoChangeAnswer: true,
  });

  eq(gate.canComplete, true, "should complete");
  eq(gate.status, "completed", "should be completed");
});

test("short useless answer does not complete", () => {
  const gate = canCompleteRun({
    mode: "patch",
    finalText: "done",
    metrics: createEmptyRunMetrics(),
    evidence: createEmptyRunEvidence(),
    allowUsefulNoChangeAnswer: true,
  });

  eq(gate.canComplete, false, "should not complete with just 'done'");
});

test("useful answer without inspection does not complete", () => {
  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Here is a very long and detailed answer about what the file contains and how it works.",
    metrics: createEmptyRunMetrics(),
    evidence: createEmptyRunEvidence(),
    allowUsefulNoChangeAnswer: true,
  });

  eq(gate.canComplete, false, "needs filesRead to complete");
});

test("normal patch request still requires changes", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("src/tui/App.tsx");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "I inspected the file. The /mode handler is at line 42. No changes needed.",
    metrics: createEmptyRunMetrics(),
    evidence,
    allowUsefulNoChangeAnswer: false, // not enabled for explicit patch
  });

  eq(gate.canComplete, false, "explicit patch should still require changes");
});

// ═══════════════════════════════════════════════════════════════════
// 5. Approval Policy: Queue Behavior
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Approval Policy ===\n");

test("on_write queues create_file", () => {
  eq(shouldQueueFileOperation({ policy: "on_write", kind: "create_file", risk: "write" }), true, "create_file should queue");
});

test("on_write queues edit_file", () => {
  eq(shouldQueueFileOperation({ policy: "on_write", kind: "edit_file", risk: "write" }), true, "edit_file should queue");
});

test("on_write queues destructive", () => {
  eq(shouldQueueFileOperation({ policy: "on_write", kind: "delete_file", risk: "destructive" }), true, "delete_file should queue");
});

test("never does not queue anything", () => {
  eq(shouldQueueFileOperation({ policy: "never", kind: "create_file", risk: "write" }), false, "never should not queue");
});

test("on_destructive queues only destructive", () => {
  eq(shouldQueueFileOperation({ policy: "on_destructive", kind: "delete_file", risk: "destructive" }), true, "delete should queue");
  eq(shouldQueueFileOperation({ policy: "on_destructive", kind: "edit_file", risk: "write" }), false, "edit should not queue");
  eq(shouldQueueFileOperation({ policy: "on_destructive", kind: "create_file", risk: "write" }), false, "create should not queue");
});

test("always queues everything", () => {
  eq(shouldQueueFileOperation({ policy: "always", kind: "edit_file", risk: "write" }), true, "always queues writes");
  eq(shouldQueueFileOperation({ policy: "always", kind: "delete_file", risk: "destructive" }), true, "always queues destructive");
});

test("risk classification is correct", () => {
  eq(riskForKind("create_file"), "write", "create_file -> write");
  eq(riskForKind("edit_file"), "write", "edit_file -> write");
  eq(riskForKind("replace_lines"), "write", "replace_lines -> write");
  eq(riskForKind("delete_file"), "destructive", "delete_file -> destructive");
  eq(riskForKind("rename_file"), "destructive", "rename_file -> destructive");
  eq(riskForKind("move_file"), "destructive", "move_file -> destructive");
});

// ═══════════════════════════════════════════════════════════════════
// 6. Completion Gate: Pending Operations
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Pending Operations Gate ===\n");

test("pending operations -> waiting_for_approval", () => {
  const evidence = createEmptyRunEvidence();
  evidence.pendingFileOperations.push("op_123");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Task is done.",
    metrics: createEmptyRunMetrics(),
    evidence,
  });

  eq(gate.canComplete, false, "should not complete");
  eq(gate.status, "waiting_for_approval", "should be waiting_for_approval");
});

test("approved and applied operations allow completion", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesEdited.push("file.ts");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Applied edit to file.ts",
    metrics: createEmptyRunMetrics(),
    evidence,
  });

  // Checks are best-effort: a real file edit completes even without a check run.
  eq(gate.canComplete, true, "edits complete without checks");
  eq(gate.status, "completed", "completed");
});

// ═══════════════════════════════════════════════════════════════════
// 7. Result Renderer Outputs
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Result Rendering ===\n");

test("read-only answer renders concisely", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("helloworld.txt");
  evidence.toolResults.push({ tool: "read", ok: true, summary: "Read helloworld.txt" });
  evidence.toolResults.push({ tool: "search", ok: true, summary: "Found 1 result" });

  const result = {
    ok: true,
    status: "completed" as const,
    finalText: "The last file we created is **helloworld.txt**.\nIt contains: Hello, world!",
    changedFiles: [] as string[],
    checksRun: [] as string[],
    metrics: createEmptyRunMetrics(),
    evidence,
    stopReason: "no_change_answer" as const,
    memory: { goal: "", successCriteria: [], confirmedFacts: [], filesRead: [], currentHypothesis: "", editPlan: [], editsApplied: [], checkResults: [], remainingUnknowns: [], warnings: [] },
  };

  const output = renderAgentResult(result);
  assert(output.includes("helloworld.txt"), "should mention file");
  assert(!output.includes("Patch mode completion requires"), "should not dump completion gate text");
  assert(!output.includes("Could not complete"), "should not say failed");
});

test("pending approval output is clear", () => {
  const evidence = createEmptyRunEvidence();
  evidence.pendingFileOperations.push("op_123");

  const result = {
    ok: true,
    status: "waiting_for_approval" as const,
    finalText: "File changes queued for approval.",
    changedFiles: [] as string[],
    checksRun: [] as string[],
    metrics: createEmptyRunMetrics(),
    evidence,
    stopReason: "waiting_for_approval" as const,
    memory: { goal: "", successCriteria: [], confirmedFacts: [], filesRead: [], currentHypothesis: "", editPlan: [], editsApplied: [], checkResults: [], remainingUnknowns: [], warnings: [] },
  };

  const output = renderAgentResult(result);
  assert(output.includes("awaiting approval"), "should mention approval");
  assert(output.includes("smith approvals"), "should show CLI commands");
});

test("failed output is concise but informative", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("src/tui/App.tsx");
  evidence.toolResults.push({ tool: "edit", ok: false, summary: "Search text not found" });

  const result = {
    ok: false,
    status: "failed" as const,
    finalText: "Could not apply edit.",
    changedFiles: [] as string[],
    checksRun: [] as string[],
    metrics: createEmptyRunMetrics(),
    evidence,
    stopReason: "no_verified_completion" as const,
    memory: { goal: "", successCriteria: [], confirmedFacts: [], filesRead: [], currentHypothesis: "", editPlan: [], editsApplied: [], checkResults: [], remainingUnknowns: [], warnings: [] },
  };

  const output = renderAgentResult(result);
  assert(output.includes("Could not complete"), "should start with could not complete");
  assert(output.includes("Files inspected"), "should show inspected");
  assert(output.includes("Search text not found"), "should show failure reason");
});

// ═══════════════════════════════════════════════════════════════════
// 8. Edge Cases
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Edge Cases ===\n");

test("empty evidence + noChangeAnswer completes", () => {
  const gate = canCompleteRun({
    mode: "patch",
    finalText: "The file was inspected and here is what I found.",
    metrics: createEmptyRunMetrics(),
    evidence: createEmptyRunEvidence(),
    allowUsefulNoChangeAnswer: true,
  });
  // No filesRead so this should still fail
  eq(gate.canComplete, false, "needs actual file reads");
});

test("patch: file created but no typecheck configured still marks change", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesCreated.push("readme.txt");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Created readme.txt",
    metrics: createEmptyRunMetrics(),
    evidence,
  });

  eq(gate.canComplete, true, "plain non-code file completes");
  eq(gate.status, "completed", "completed");
});

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
const result = summarize();
process.exit(result.ok ? 0 : 1);
