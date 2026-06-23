import { normalizeLocalToolTags, parseLocalTextAction, parseLocalTextActions } from "./localTextToolParser.js";
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
// Build the <tool_call> / <arg_key> tags from char codes so this source never depends on
// special glyphs that some editors/pipelines mangle.
const O = String.fromCharCode(60, 116, 111, 111, 108, 95, 99, 97, 108, 108, 62);
const C = String.fromCharCode(60, 47, 116, 111, 111, 108, 95, 99, 97, 108, 108, 62);
const tool = (inner) => `${O}\n${inner}\n${C}`;
// ── Task 8.1: Malformed closing tag ──
console.log("T8.1: Malformed closing tag normalization");
test("normalizes </tool_calls> to closing tag", () => {
    const result = normalizeLocalToolTags(`${O}\n{"tool":"search","args":{"query":"mode"}}\n</tool_calls>`);
    assert(result.changed, "changed");
    assert(result.text.includes(C), "contains closing tag");
    assert(!result.text.includes("</tool_calls>"), "no longer </tool_calls>");
    assert(result.warnings.length > 0, "has warnings");
});
test("parses after normalization", () => {
    const action = parseLocalTextAction(`${O}\n{"tool":"search","args":{"query":"mode"}}\n</tool_calls>`);
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
test("normalizes <tool_calls> to opening tag", () => {
    const result = normalizeLocalToolTags(`<tool_calls>\n{"tool":"search","args":{"query":"mode"}}\n${C}`);
    assert(result.changed, "changed");
    assert(result.text.includes(O), "contains opening tag");
    assert(!result.text.includes("<tool_calls>"), "no longer <tool_calls>");
});
test("parses after opening tag normalization", () => {
    const action = parseLocalTextAction(`<tool_calls>\n{"tool":"search","args":{"query":"mode"}}\n${C}`);
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
test("normalizes <toolcall> to opening tag", () => {
    const result = normalizeLocalToolTags(`<toolcall>\n{"tool":"search"}\n</toolcall>`);
    assert(result.changed, "changed");
});
test("no change for valid tags", () => {
    const result = normalizeLocalToolTags(tool(`{"tool":"search"}`));
    assert(!result.changed, "not changed");
});
// ── Valid input still works ──
console.log("Valid input");
test("valid tool_call parses correctly", () => {
    const action = parseLocalTextAction(tool(`{"tool":"read","args":{"path":"src/test.ts","startLine":1,"endLine":50}}`));
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
// ── Robustness: multiple actions, fences, bare/native JSON ──
console.log("Robustness: multi-action + fences + bare JSON");
test("multiple tool calls parse into an ordered list", () => {
    const actions = parseLocalTextActions(`${tool(`{"tool":"search","args":{"query":"x"}}`)}\n${tool(`{"tool":"read","args":{"path":"a.ts"}}`)}`);
    eq(actions.length, 2, "two actions");
    eq(actions[0].kind, "tool_call", "first kind");
    eq(actions[1].kind, "tool_call", "second kind");
    if (actions[0].kind === "tool_call" && actions[1].kind === "tool_call") {
        eq(actions[0].tool, "search", "first tool");
        eq(actions[1].tool, "read", "second tool");
    }
});
test("tool_call followed by final yields both in order", () => {
    const actions = parseLocalTextActions(`${tool(`{"tool":"read","args":{"path":"a.ts"}}`)}\n<final>done</final>`);
    eq(actions.length, 2, "two actions");
    eq(actions[0].kind, "tool_call", "first kind");
    eq(actions[1].kind, "final", "second kind");
});
test("markdown fenced json tool_call is recovered", () => {
    const actions = parseLocalTextActions("```json\n{\"tool\":\"search\",\"args\":{\"query\":\"q\"}}\n```");
    eq(actions.length, 1, "one action");
    eq(actions[0].kind, "tool_call", "kind");
    if (actions[0].kind === "tool_call") {
        eq(actions[0].tool, "search", "tool");
        assert(actions[0].repaired === true, "repaired");
    }
});
test("markdown fenced tool_call block is recovered", () => {
    const actions = parseLocalTextActions("```tool_call\n{\"tool\":\"read\",\"args\":{\"path\":\"x\"}}\n```");
    eq(actions.length, 1, "one action");
    eq(actions[0].kind, "tool_call", "kind");
});
test("bare JSON object (no tags) is recovered", () => {
    const actions = parseLocalTextActions(`{"tool":"edit","args":{"path":"a.ts","search":"old","replace":"new"}}`);
    eq(actions.length, 1, "one action");
    eq(actions[0].kind, "tool_call", "kind");
    if (actions[0].kind === "tool_call") {
        eq(actions[0].tool, "edit", "tool");
        assert(actions[0].repaired === true, "repaired");
    }
});
test("native {name, arguments} shape is coerced", () => {
    const actions = parseLocalTextActions(`{"name":"read","arguments":{"path":"a.ts"}}`);
    eq(actions.length, 1, "one action");
    if (actions[0].kind === "tool_call") {
        eq(actions[0].tool, "read", "tool coerced from name");
        eq(actions[0].args.path, "a.ts", "args coerced from arguments");
    }
});
test("native {name, arguments(string)} shape is coerced", () => {
    const actions = parseLocalTextActions(`{"name":"edit","arguments":"{\\"path\\":\\"a.ts\\"}"}`);
    eq(actions.length, 1, "one action");
    if (actions[0].kind === "tool_call")
        eq(actions[0].tool, "edit", "tool");
});
test("unclosed open tag is recovered to end of output", () => {
    const actions = parseLocalTextActions(`${O}\n{"tool":"read","args":{"path":"a.ts"}}`);
    eq(actions.length, 1, "one action");
    eq(actions[0].kind, "tool_call", "kind");
    if (actions[0].kind === "tool_call")
        eq(actions[0].tool, "read", "tool");
});
test("prose with no tool block is plain_text", () => {
    const actions = parseLocalTextActions("I need more context to answer that.");
    eq(actions.length, 1, "one action");
    eq(actions[0].kind, "plain_text", "kind");
});
test("plain_text fallback via single parser", () => {
    const action = parseLocalTextAction("just chatting");
    eq(action.kind, "plain_text", "kind");
});
console.log("\nDone.");
