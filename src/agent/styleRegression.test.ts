import {
  test, assert, eq, contains, notContains, summarize,
} from "./trajectoryHarness.js";
import { classifyTaskKind, isUiStylePatchPrompt } from "../context/taskPacket.js";
import { classifyRuntimeIntent } from "./classifyRuntimeIntent.js";
import { parseExplicitMode } from "./parseExplicitMode.js";
import { toolsForPhase } from "./phaseTools.js";
import { profileForPhase } from "./permissionProfile.js";
import { canCompleteRun } from "./completionGate.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";

// ═══════════════════════════════════════════════════════════════════
// 1. TaskKind Detection
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== UI Style Task Detection ===\n");

test("make background red -> ui_style_patch", () => {
  eq(classifyTaskKind("make the background red"), "ui_style_patch", "taskKind");
});

test("can you make the background of the chat website red? -> ui_style_patch", () => {
  eq(classifyTaskKind("can you make the background of the chat website red?"), "ui_style_patch", "taskKind");
});

test("change button color to blue -> ui_style_patch", () => {
  eq(classifyTaskKind("change button color to blue"), "ui_style_patch", "taskKind");
});

test("make sidebar wider -> ui_style_patch", () => {
  eq(classifyTaskKind("make sidebar wider"), "ui_style_patch", "taskKind");
});

test("set font to 16px -> ui_style_patch", () => {
  eq(classifyTaskKind("set font to 16px"), "ui_style_patch", "taskKind");
});

test("make the page dark mode -> ui_style_patch", () => {
  eq(classifyTaskKind("make the page dark mode"), "ui_style_patch", "taskKind");
});

test("fix the /mode command -> code_patch", () => {
  eq(classifyTaskKind("fix the /mode command"), "code_patch", "taskKind");
});

test("create helloworld.txt -> file_create", () => {
  eq(classifyTaskKind("create helloworld.txt"), "file_create", "taskKind");
});

test("hi -> chat", () => {
  eq(classifyTaskKind("hi"), "chat", "taskKind");
});

test("explain this code -> ask", () => {
  eq(classifyTaskKind("explain this code"), "ask", "taskKind");
});

// ═══════════════════════════════════════════════════════════════════
// 2. isUiStylePatchPrompt helper
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== isUiStylePatchPrompt ===\n");

test("make background red -> true", () => {
  eq(isUiStylePatchPrompt("make background red"), true, "should detect");
});

test("change the css to dark theme -> true", () => {
  eq(isUiStylePatchPrompt("change the css to dark theme"), true, "should detect");
});

test("make topbar red -> true", () => {
  eq(isUiStylePatchPrompt("make topbar red"), true, "should detect");
});

test("fix the bug in auth -> false", () => {
  eq(isUiStylePatchPrompt("fix the bug in auth"), false, "not a style task");
});

test("hello -> false", () => {
  eq(isUiStylePatchPrompt("hello"), false, "should not detect");
});

// ═══════════════════════════════════════════════════════════════════
// 3. apply_style_patch Phase Tools
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== apply_style_patch Phase ===\n");

test("apply_style_patch has edit", () => {
  contains(toolsForPhase("apply_style_patch"), "edit", "should have edit");
});

test("apply_style_patch has replace_lines", () => {
  contains(toolsForPhase("apply_style_patch"), "replace_lines", "should have replace_lines");
});

test("apply_style_patch has append_to_file", () => {
  contains(toolsForPhase("apply_style_patch"), "append_to_file", "should have append_to_file");
});

test("apply_style_patch has final", () => {
  contains(toolsForPhase("apply_style_patch"), "final", "should have final");
});

test("apply_style_patch has NO search", () => {
  notContains(toolsForPhase("apply_style_patch"), "search", "should NOT have search");
});

test("apply_style_patch has NO read", () => {
  notContains(toolsForPhase("apply_style_patch"), "read", "should NOT have read");
});

test("apply_style_patch has NO propose_edit", () => {
  notContains(toolsForPhase("apply_style_patch"), "propose_edit", "style apply goes straight to edit");
});

test("apply_style_patch maps to apply permission profile", () => {
  eq(profileForPhase("apply_style_patch"), "apply", "profile");
});

// ═══════════════════════════════════════════════════════════════════
// 4. Style Completion Gate
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Style Completion Gate ===\n");

test("CSS file changed without checks -> completed for ui_style_patch", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesEdited.push("public/style.css");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Changed body background to red.",
    metrics: createEmptyRunMetrics(),
    evidence,
    taskKind: "ui_style_patch",
  });

  eq(gate.canComplete, true, "should complete");
  eq(gate.status, "completed", "completed without checks");
});

test("CSS file changed + TS file changed requires checks even for style", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesEdited.push("public/style.css");
  evidence.filesEdited.push("src/tui/App.tsx");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "Changed styles and component.",
    metrics: createEmptyRunMetrics(),
    evidence,
    taskKind: "ui_style_patch",
  });

  eq(gate.canComplete, false, "needs checks because TS file changed");
});

test("no file changes in style task -> fails", () => {
  const evidence = createEmptyRunEvidence();
  evidence.filesRead.push("public/style.css");

  const gate = canCompleteRun({
    mode: "patch",
    finalText: "I inspected the stylesheet but made no changes.",
    metrics: createEmptyRunMetrics(),
    evidence,
    taskKind: "ui_style_patch",
  });

  eq(gate.canComplete, false, "needs actual change evidence");
});

// ═══════════════════════════════════════════════════════════════════
// 5. Trajectory: Background Red Task
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Background Red Trajectory ===\n");

test("build: make background red -> taskKind ui_style_patch", () => {
  const prompt = "can you make the background of the chat website red?";
  const { explicitMode, cleanedPrompt } = parseExplicitMode(prompt);
  const r = classifyRuntimeIntent({
    prompt: cleanedPrompt,
    uiMode: "build",
    explicitMode,
  });
  eq(r.intent, "patch", "should be patch intent");
  eq(classifyTaskKind(cleanedPrompt), "ui_style_patch", "should be style task");
});

test("explore phase allows search/read for style task", () => {
  const tools = toolsForPhase("explore");
  contains(tools, "search", "explore has search");
  contains(tools, "read", "explore has read");
});

test("apply_style_patch phase has NO search", () => {
  const tools = toolsForPhase("apply_style_patch");
  notContains(tools, "search", "no search in style apply");
});

test("apply_style_patch has only edit tools + final", () => {
  const tools = toolsForPhase("apply_style_patch");
  eq(tools.length, 5, "5 tools: edit, replace_lines, append_to_file, ask_user, final");
});

// ═══════════════════════════════════════════════════════════════════
// 6. append_to_file tool registration
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== append_to_file Tool ===\n");

test("append_to_file is in apply_style_patch tools", () => {
  contains(toolsForPhase("apply_style_patch"), "append_to_file", "style tasks");
});

test("append_to_file is NOT in explore tools", () => {
  notContains(toolsForPhase("explore"), "append_to_file", "explore is readonly");
});

test("append_to_file is NOT in plan_patch tools", () => {
  notContains(toolsForPhase("plan_patch"), "append_to_file", "plan is proposal only");
});

// ═══════════════════════════════════════════════════════════════════
// 7. Empty search rejection  
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
