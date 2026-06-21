import { classifyRuntimeIntent } from "./classifyRuntimeIntent.js";
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
// ── Task 7.1: Greeting in build mode ──
console.log("T7.1: Greeting in build mode");
test("hello -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "hello", uiMode: "build" });
    eq(r.intent, "chat", "intent");
    eq(r.confidence, "high", "confidence");
});
test("hi -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "hi", uiMode: "build" });
    eq(r.intent, "chat", "intent");
});
test("hey -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "hey", uiMode: "build" });
    eq(r.intent, "chat", "intent");
});
test("thanks -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "thanks", uiMode: "build" });
    eq(r.intent, "chat", "intent");
});
test("good morning -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "good morning", uiMode: "build" });
    eq(r.intent, "chat", "intent");
});
// ── Task 7.2: General question in build mode ──
console.log("T7.2: General question in build mode");
test("what can you do? -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "what can you do?", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("who are you -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "who are you", uiMode: "build" });
    eq(r.intent, "chat", "intent");
});
test("how are you -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "how are you", uiMode: "build" });
    eq(r.intent, "chat", "intent");
});
// ── Task 7.3: Explanation question with patch keywords ──
console.log("T7.3: Explanation questions are ask, not patch");
test("how do I create a file in this project? -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "how do I create a file in this project?", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("explain how to implement auth -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "explain how to implement auth", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("tell me how to fix this bug -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "tell me how to fix this bug", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("show me how to add a component -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "show me how to add a component", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
// ── Task 7.4: Explicit file creation ──
console.log("T7.4: Explicit file creation -> patch");
test("create helloworld.txt with Hello world -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "create helloworld.txt with Hello world", uiMode: "build" });
    eq(r.intent, "patch", "intent");
    eq(r.confidence, "high", "confidence");
});
test("fix the bug in config switcher -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "fix the bug in config switcher", uiMode: "build" });
    eq(r.intent, "patch", "intent");
});
test("implement login feature -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "implement login feature", uiMode: "build" });
    eq(r.intent, "patch", "intent");
});
test("refactor the parser -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "refactor the parser", uiMode: "build" });
    eq(r.intent, "patch", "intent");
});
test("delete old config file -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "delete old config file", uiMode: "build" });
    eq(r.intent, "patch", "intent");
});
test("rename getUser to fetchUser -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "rename getUser to fetchUser", uiMode: "build" });
    eq(r.intent, "patch", "intent");
});
test("add a new endpoint for users -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "add a new endpoint for users", uiMode: "build" });
    eq(r.intent, "patch", "intent");
});
test("generate a type definition for User -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "generate a type definition for User", uiMode: "build" });
    eq(r.intent, "patch", "intent");
});
// ── Task 7.5: Ask override ──
console.log("T7.5: /ask override -> ask");
test("/ask create helloworld.txt -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "create helloworld.txt", explicitMode: "ask" });
    eq(r.intent, "ask", "intent");
    eq(r.confidence, "high", "confidence");
});
// ── Task 7.6: Patch override ──
console.log("T7.6: /patch override -> patch");
test("/patch explain this -> patch", () => {
    const r = classifyRuntimeIntent({ prompt: "explain this", explicitMode: "patch" });
    eq(r.intent, "patch", "intent");
    eq(r.confidence, "high", "confidence");
});
// ── Task 7.8: Vague patch confidence ──
console.log("T7.8: Vague patch request -> low confidence");
test("make this better -> patch, low confidence", () => {
    const r = classifyRuntimeIntent({ prompt: "make this better", uiMode: "build" });
    eq(r.intent, "patch", "intent");
    eq(r.confidence, "low", "confidence");
});
test("fix this -> patch, low confidence", () => {
    const r = classifyRuntimeIntent({ prompt: "fix this", uiMode: "build" });
    eq(r.intent, "patch", "intent");
    eq(r.confidence, "low", "confidence");
});
test("improve this -> patch, low confidence", () => {
    const r = classifyRuntimeIntent({ prompt: "improve this", uiMode: "build" });
    eq(r.intent, "patch", "intent");
    eq(r.confidence, "low", "confidence");
});
// ── Additional: Ask questions stay ask ──
console.log("Ask questions -> ask");
test("explain why this failed -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "explain why this failed", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("what is this project? -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "what is this project?", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("why did the last run fail? -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "why did the last run fail?", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("how does the config switcher work? -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "how does the config switcher work?", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("review my changes -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "review my changes", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("analyze the performance -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "analyze the performance", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("summarize whats in this directory -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "summarize whats in this directory", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("find where login is implemented -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "find where login is implemented", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("list all the components -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "list all the components", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("search for error handling code -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "search for error handling code", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
test("what does this function do? -> ask", () => {
    const r = classifyRuntimeIntent({ prompt: "what does this function do?", uiMode: "build" });
    eq(r.intent, "ask", "intent");
});
// ── Empty prompt ──
console.log("Edge cases");
test("empty prompt -> chat", () => {
    const r = classifyRuntimeIntent({ prompt: "" });
    eq(r.intent, "chat", "intent");
});
test("explicit chat mode", () => {
    const r = classifyRuntimeIntent({ prompt: "create file", explicitMode: "chat" });
    eq(r.intent, "chat", "intent");
});
// ── Command detection ──
test("slash command -> command", () => {
    const r = classifyRuntimeIntent({ prompt: "/help" });
    eq(r.intent, "command", "intent");
});
test("colon command -> command", () => {
    const r = classifyRuntimeIntent({ prompt: ":q" });
    eq(r.intent, "command", "intent");
});
console.log("\nDone.");
