import { normalizeLocalToolTags, parseLocalTextAction } from "./localTextToolParser.js";
function test(name, fn) {
    try {
        fn();
        console.log(`  PASS  ${name}`);
    }
    catch (err) {
        console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function assert(condition, msg) {
    if (!condition)
        throw new Error(msg);
}
function eq(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`${msg}: expected "${expected}", got "${actual}"`);
}
// ── Task 8.1: Malformed closing tag ──
console.log("T8.1: Malformed closing tag normalization");
test("normalizes </tool_calls> to </tool_call>", () => {
    const result = normalizeLocalToolTags(`<tool_call>\n{"tool":"search","args":{"query":"mode"}}\n</tool_calls>`);
    assert(result.changed, "changed");
    assert(result.text.includes("</tool_call>"), "contains </tool_call>");
    assert(!result.text.includes("</tool_calls>"), "no longer </tool_calls>");
    assert(result.warnings.length > 0, "has warnings");
});
test("parses after normalization", () => {
    const action = parseLocalTextAction(`<tool_call>\n{"tool":"search","args":{"query":"mode"}}\n</tool_calls>`);
    eq(action.kind, "tool_call", "kind");
    if (action.kind === "tool_call") {
        eq(action.tool, "search", "tool");
        eq(action.args.query, "mode", "query");
        assert(action.repaired === true, "repaired");
        assert(action.warnings.length > 0, "warnings");
    }
});
// ── Task 8.2: Malformed opening tag ──
console.log("T8.2: Malformed opening tag normalization");
test("normalizes <tool_calls> to <tool_call>", () => {
    const result = normalizeLocalToolTags(`<tool_calls>\n{"tool":"search","args":{"query":"mode"}}\n</tool_call>`);
    assert(result.changed, "changed");
    assert(result.text.includes("<tool_call>"), "contains <tool_call>");
    assert(!result.text.includes("<tool_calls>"), "no longer <tool_calls>");
});
test("parses after opening tag normalization", () => {
    const action = parseLocalTextAction(`<tool_calls>\n{"tool":"search","args":{"query":"mode"}}\n</tool_call>`);
    eq(action.kind, "tool_call", "kind");
    if (action.kind === "tool_call") {
        eq(action.tool, "search", "tool");
        assert(action.repaired === true, "repaired");
    }
});
// ── Additional tag normalizations ──
console.log("Additional tag normalizations");
test("normalizes <final_answer> to <final>", () => {
    const result = normalizeLocalToolTags(`<final_answer>done</final_answer>`);
    assert(result.changed, "changed");
    assert(result.text.includes("<final>"), "contains <final>");
    assert(!result.text.includes("final_answer"), "no final_answer");
});
test("normalizes <toolcall> to <tool_call>", () => {
    const result = normalizeLocalToolTags(`<toolcall>\n{"tool":"search"}\n</toolcall>`);
    assert(result.changed, "changed");
});
test("no change for valid tags", () => {
    const result = normalizeLocalToolTags(`<tool_call>\n{"tool":"search"}\n</tool_call>`);
    assert(!result.changed, "not changed");
});
// ── Valid input still works ──
console.log("Valid input");
test("valid tool_call parses correctly", () => {
    const action = parseLocalTextAction(`<tool_call>\n{"tool":"read","args":{"path":"src/test.ts","startLine":1,"endLine":50}}\n</tool_call>`);
    eq(action.kind, "tool_call", "kind");
    if (action.kind === "tool_call") {
        eq(action.tool, "read", "tool");
        eq(action.args.path, "src/test.ts", "path");
        assert(!action.repaired, "not repaired");
    }
});
test("valid final parses correctly", () => {
    const action = parseLocalTextAction(`<final>Task completed.</final>`);
    eq(action.kind, "final", "kind");
});
console.log("\nDone.");
