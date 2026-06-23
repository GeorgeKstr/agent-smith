import {
  test, assert, eq, contains, notContains, summarize,
} from "./trajectoryHarness.js";
import { classifyRuntimeIntent } from "./classifyRuntimeIntent.js";
import { parseExplicitMode } from "./parseExplicitMode.js";
import { canCompleteRun } from "./completionGate.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import { isWriteTool } from "./toolPermissions.js";

// ═══════════════════════════════════════════════════════════════════
// 1. Runtime Intent Detection
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Runtime Intent Detection ===\n");

test("build mode, make background red -> patch intent", () => {
  const prompt = "can you make the background of the chat website red?";
  const { explicitMode, cleanedPrompt } = parseExplicitMode(prompt);
  const r = classifyRuntimeIntent({
    prompt: cleanedPrompt,
    uiMode: "build",
    explicitMode,
  });
  eq(r.intent, "patch", "should be patch intent");
});

// ═══════════════════════════════════════════════════════════════════
// 2. Completion Gate: patch mode
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Completion Gate ===\n");

test("CSS file changed without checks -> completed (changed+best-effort)", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesEdited.push("public/style.css");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Changed body background to red.",
    metrics: createEmptyRunMetrics(),
    evidence,
  });

  eq(gate.canComplete, true, "should complete");
  eq(gate.status, "completed", "completed without checks");
});

test("TS file changed without checks -> completed (changed+best-effort)", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesEdited.push("src/tui/App.tsx");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Changed styles and component.",
    metrics: createEmptyRunMetrics(),
    evidence,
  });

  eq(gate.canComplete, true, "edits complete without checks");
});

test("no file changes -> fails", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("public/style.css");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "I inspected the stylesheet but made no changes.",
    metrics: createEmptyRunMetrics(),
    evidence,
  });

  eq(gate.canComplete, false, "needs actual change evidence");
});

test("<final> without edits but allowNoEditCompletion -> completed", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("public/style.css");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Inspected public/style.css. Contains body background rule.",
    metrics: createEmptyRunMetrics(),
    evidence,
    allowNoEditCompletion: true,
  });

  eq(gate.canComplete, true, "should complete with no-edit allowance");
  eq(gate.status, "completed", "completed status");
});

test("empty final with allowNoEditCompletion -> fails", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("public/style.css");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "   ",
    metrics: createEmptyRunMetrics(),
    evidence,
    allowNoEditCompletion: true,
  });

  eq(gate.canComplete, false, "empty final should not complete");
});

// ═══════════════════════════════════════════════════════════════════
// 3. Tool Permissions
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Tool Write Detection ===\n");

test("edit is a write tool", () => {
  assert(isWriteTool("edit"), "edit should be write tool");
});

test("create_file is a write tool", () => {
  assert(isWriteTool("create_file"), "create_file should be write tool");
});

test("search is NOT a write tool", () => {
  assert(!isWriteTool("search"), "search should not be write tool");
});

test("read is NOT a write tool", () => {
  assert(!isWriteTool("read"), "read should not be write tool");
});

// ═══════════════════════════════════════════════════════════════════
// 4. Empty search rejection  
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Empty Search Queries ===\n");

test("empty query is rejected by search tool", async () => {
  const { searchTool } = await import("./tools/searchTool.js");
  const result = await searchTool.handler({}, { root: "/tmp", db: {} as any, config: {} as any });
  eq(result.ok, false, "empty query should fail");
  assert(result.summary.includes("No query"), "should mention no query");
});

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
const result = summarize();
process.exit(result.ok ? 0 : 1);
