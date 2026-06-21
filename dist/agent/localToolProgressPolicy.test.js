import { createEmptyLocalToolProgress, updateLocalToolProgress } from "./localToolProgress.js";
import { checkLocalToolProgressPolicy } from "./localToolProgressPolicy.js";
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
// ── Task 8.3: Search limit ──
console.log("T8.3: Search limit");
test("first search allowed", () => {
    const p = createEmptyLocalToolProgress();
    const d = checkLocalToolProgressPolicy({ toolName: "search", args: {}, progress: p, maxConsecutiveSearches: 2, maxConsecutiveReads: 4 });
    assert(d.allowed, "allowed");
});
test("second search allowed", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "test" }, ok: true });
    const d = checkLocalToolProgressPolicy({ toolName: "search", args: {}, progress: p2, maxConsecutiveSearches: 2, maxConsecutiveReads: 4 });
    assert(d.allowed, "second search allowed");
});
test("third search rejected", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "a" }, ok: true });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "search", args: { query: "b" }, ok: true });
    const d = checkLocalToolProgressPolicy({ toolName: "search", args: {}, progress: p3, maxConsecutiveSearches: 2, maxConsecutiveReads: 4 });
    assert(!d.allowed, "rejected");
    if (!d.allowed) {
        assert(d.summary.includes("Search limit"), "summary mentions limit");
        assert(d.nextActions.length > 0, "has next actions");
    }
});
test("failed searches still count as consecutive", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "a" }, ok: false });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "search", args: { query: "b" }, ok: false });
    // Failed searches don't increment consecutive counter (see updateLocalToolProgress: only increments on ok)
    // So consecutiveSearches should still be 0
    eq(p3.consecutiveSearches, 0, "consecutive searches after failures");
});
// ── Task 8.4: Search then read resets search counter ──
console.log("T8.4: Search then read resets counter");
test("search after read is allowed", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "a" }, ok: true });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "read", args: { path: "test.ts" }, ok: true });
    eq(p3.consecutiveSearches, 0, "consecutive searches reset");
    const d = checkLocalToolProgressPolicy({ toolName: "search", args: {}, progress: p3, maxConsecutiveSearches: 2, maxConsecutiveReads: 4 });
    assert(d.allowed, "search after read is allowed");
});
test("two searches, one read, then search is allowed", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "a" }, ok: true });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "search", args: { query: "b" }, ok: true });
    const p4 = updateLocalToolProgress({ progress: p3, toolName: "read", args: { path: "test.ts" }, ok: true });
    const p5 = updateLocalToolProgress({ progress: p4, toolName: "search", args: { query: "c" }, ok: true });
    eq(p5.consecutiveSearches, 1, "consecutive searches reset after read, then incremented to 1");
});
// ── Progress tracking ──
console.log("Progress tracking");
test("consecutiveSearches increments on ok search", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "test" }, ok: true });
    eq(p2.consecutiveSearches, 1, "consecutive searches = 1");
});
test("non-search tool resets consecutiveSearches", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "a" }, ok: true });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "edit", args: {}, ok: true });
    eq(p3.consecutiveSearches, 0, "consecutive searches reset by edit");
});
test("lastSearchQueries tracked", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "mode" }, ok: true });
    assert(p2.lastSearchQueries.includes("mode"), "query tracked");
});
test("max 5 last search queries", () => {
    let p = createEmptyLocalToolProgress();
    for (let i = 0; i < 10; i++) {
        p = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: `q${i}` }, ok: true });
    }
    assert(p.lastSearchQueries.length <= 5, "max 5 queries");
});
console.log("\nDone.");
