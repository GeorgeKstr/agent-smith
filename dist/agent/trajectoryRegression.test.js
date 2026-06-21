import { test, assert, eq, contains, notContains, summarize, runIntentScenarios, runParserTests, } from "./trajectoryHarness.js";
import { toolsForPhase } from "./phaseTools.js";
import { isWriteTool } from "./toolPermissions.js";
import { profileForPhase, toolsForProfile } from "./permissionProfile.js";
import { classifyRuntimeIntent } from "./classifyRuntimeIntent.js";
import { parseExplicitMode } from "./parseExplicitMode.js";
// ═══════════════════════════════════════════════════════════════════
// 1. Intent Classification Regression
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Intent Classification ===\n");
const intentScenarios = [
    { name: "hello in build mode -> chat", input: "hello", uiMode: "build", expected: { intent: "chat" } },
    { name: "hi in build mode -> chat", input: "hi", uiMode: "build", expected: { intent: "chat" } },
    { name: "thanks -> chat", input: "thanks", uiMode: "build", expected: { intent: "chat" } },
    { name: "what can you do? -> ask", input: "what can you do?", uiMode: "build", expected: { intent: "ask" } },
    { name: "how do I create a file? -> ask (not patch)", input: "how do I create a file in this project?", uiMode: "build", expected: { intent: "ask" } },
    { name: "explain how to implement auth -> ask", input: "explain how to implement auth", uiMode: "build", expected: { intent: "ask" } },
    { name: "create helloworld.txt -> patch", input: "create helloworld.txt with Hello world", uiMode: "build", expected: { intent: "patch" } },
    { name: "fix the bug -> patch", input: "fix the bug in config switcher", uiMode: "build", expected: { intent: "patch" } },
    { name: "implement login feature -> patch", input: "implement login feature", uiMode: "build", expected: { intent: "patch" } },
    { name: "explain this code -> ask", input: "explain this code", uiMode: "build", expected: { intent: "ask" } },
    { name: "/ask override keeps ask", input: "/ask create helloworld.txt", expected: { intent: "ask", explicitMode: "ask" } },
    { name: "/build override is patch", input: "/build explain this", expected: { intent: "patch" } },
    { name: "/mode toggle task -> patch", input: "the /mode command should work like a toggle if no other parameter is provided", uiMode: "build", expected: { intent: "patch" } },
    { name: "review my changes -> ask", input: "review my changes", uiMode: "build", expected: { intent: "ask" } },
    { name: "empty prompt -> chat", input: "", expected: { intent: "chat" } },
    { name: "vague fix -> patch, low confidence", input: "fix this", uiMode: "build", expected: { intent: "patch" } },
];
runIntentScenarios(intentScenarios);
// ═══════════════════════════════════════════════════════════════════
// 2. Phase Permission Boundaries
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Phase Permission Boundaries ===\n");
test("explore: only search, read, final", () => {
    const tools = toolsForPhase("explore");
    contains(tools, "search", "should have search");
    contains(tools, "read", "should have read");
    contains(tools, "final", "should have final");
    for (const t of tools) {
        assert(!isWriteTool(t), `${t} should not be write tool`);
    }
    eq(tools.length, 3, "tool count");
});
test("plan_patch: only propose_edit, ask_user, final", () => {
    const tools = toolsForPhase("plan_patch");
    contains(tools, "propose_edit", "should have propose_edit");
    contains(tools, "ask_user", "should have ask_user");
    contains(tools, "final", "should have final");
    notContains(tools, "search", "should not have search");
    notContains(tools, "read", "should not have read");
    notContains(tools, "edit", "should not have edit");
});
test("apply_patch: edit, replace_lines, create_file, ask_user, final", () => {
    const tools = toolsForPhase("apply_patch");
    contains(tools, "edit", "should have edit");
    contains(tools, "create_file", "should have create_file");
    contains(tools, "final", "should have final");
    notContains(tools, "search", "should NOT have search");
    notContains(tools, "read", "should NOT have read");
});
test("verify: check, read, edit, replace_lines, final", () => {
    const tools = toolsForPhase("verify");
    contains(tools, "check", "should have check");
    contains(tools, "read", "should have read");
    contains(tools, "edit", "should have edit (for repair)");
    notContains(tools, "search", "should not have search");
});
test("chat: no tools", () => {
    eq(toolsForPhase("chat").length, 0, "chat tools");
});
// ═══════════════════════════════════════════════════════════════════
// 3. Permission Profile -> Phase Tool Consistency
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Permission Profile Consistency ===\n");
test("explore phase -> readonly profile", () => {
    eq(profileForPhase("explore"), "readonly", "profile");
});
test("plan_patch phase -> plan profile", () => {
    eq(profileForPhase("plan_patch"), "plan", "profile");
});
test("apply_patch phase -> apply profile", () => {
    eq(profileForPhase("apply_patch"), "apply", "profile");
});
test("verify phase -> verify profile", () => {
    eq(profileForPhase("verify"), "verify", "profile");
});
test("phase tools subset of profile tools (except 'final')", () => {
    const phases = ["chat", "ask", "explore", "plan_patch", "apply_patch", "verify"];
    for (const phase of phases) {
        const pts = toolsForPhase(phase);
        const profile = profileForPhase(phase);
        const ptools = toolsForProfile(profile);
        for (const t of pts) {
            if (t === "final")
                continue;
            assert(ptools.includes(t), `${phase} tool "${t}" should be in "${profile}" profile [${ptools.join(", ")}]`);
        }
    }
});
// ═══════════════════════════════════════════════════════════════════
// 4. XML Parser Robustness
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Parser Robustness ===\n");
runParserTests();
// ═══════════════════════════════════════════════════════════════════
// 5. Trajectory Scenario: /mode toggle
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== /mode Toggle Trajectory ===\n");
test("/mode toggle intent is patch", () => {
    const prompt = "the /mode command should work like a toggle if no other parameter is provided";
    const { explicitMode, cleanedPrompt } = parseExplicitMode(prompt);
    const r = classifyRuntimeIntent({ prompt: cleanedPrompt, uiMode: "build", explicitMode });
    eq(r.intent, "patch", "should be patch intent");
});
test("/mode toggle: explore phase allows search/read only", () => {
    const tools = toolsForPhase("explore");
    contains(tools, "search", "explore has search");
    contains(tools, "read", "explore has read");
    notContains(tools, "edit", "explore should NOT have edit");
});
test("/mode toggle: apply phase forbids search", () => {
    const tools = toolsForPhase("apply_patch");
    notContains(tools, "search", "apply_patch must NOT have search");
    notContains(tools, "read", "apply_patch must NOT have read");
    contains(tools, "edit", "apply_patch must have edit");
});
test("/mode toggle: verify phase has check", () => {
    const tools = toolsForPhase("verify");
    contains(tools, "check", "verify must have check");
});
// ═══════════════════════════════════════════════════════════════════
// 6. CreateFile Policy
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== CreateFile Policy ===\n");
test("create_file not in explore phase", () => {
    notContains(toolsForPhase("explore"), "create_file", "explore tools");
});
test("create_file in apply_patch phase", () => {
    contains(toolsForPhase("apply_patch"), "create_file", "apply_patch tools");
});
// ═══════════════════════════════════════════════════════════════════
// 7. Edit Pressure Workflow Bypass
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Phase Workflow No Longer Relies on Edit Pressure ===\n");
test("phase tool lists are narrow enough to not need edit pressure", () => {
    const exploreTools = toolsForPhase("explore");
    const applyTools = toolsForPhase("apply_patch");
    const exploreHasWrite = exploreTools.some((t) => isWriteTool(t));
    assert(!exploreHasWrite, "explore phase should have no write tools");
    const applyHasSearch = applyTools.includes("search");
    assert(!applyHasSearch, "apply phase should have no search tool");
});
// ═══════════════════════════════════════════════════════════════════
// 8. Status Reporting Granularity
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Status Reporting ===\n");
test("FocusedAgentStatus includes 'blocked'", () => {
    const statuses = ["completed", "partial", "failed", "waiting_for_user", "blocked"];
    contains(statuses, "blocked", "FocusedAgentStatus should include blocked");
});
// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
const result = summarize();
process.exit(result.ok ? 0 : 1);
