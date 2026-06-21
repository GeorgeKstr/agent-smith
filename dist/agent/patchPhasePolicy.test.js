import { getPatchPhase } from "./patchPhase.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import { checkPatchPhasePolicy, isBroadSearchQuery } from "./patchPhasePolicy.js";
import { createEmptyLocalToolProgress, updateLocalToolProgress } from "./localToolProgress.js";
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
// ── Phase derivation
console.log("Patch phase derivation");
test("empty evidence -> locating", () => {
    const e = createEmptyRunEvidence();
    eq(getPatchPhase({ evidence: e }), "locating", "phase");
});
test("searched but no read -> inspecting", () => {
    const e = {
        ...createEmptyRunEvidence(),
        toolResults: [{ tool: "search", ok: true, summary: "found" }],
    };
    eq(getPatchPhase({ evidence: e }), "inspecting", "phase");
});
test("read a file -> ready_to_change", () => {
    const e = {
        ...createEmptyRunEvidence(),
        toolResults: [{ tool: "search", ok: true, summary: "found" }, { tool: "read", ok: true, summary: "ok" }],
        filesRead: ["src/test.ts"],
    };
    eq(getPatchPhase({ evidence: e }), "ready_to_change", "phase");
});
test("edited a file -> changed", () => {
    const e = {
        ...createEmptyRunEvidence(),
        toolResults: [{ tool: "edit", ok: true, summary: "ok" }],
        filesRead: ["src/test.ts"],
        filesEdited: ["src/test.ts"],
    };
    eq(getPatchPhase({ evidence: e }), "changed", "phase");
});
test("changed + check passed -> verified", () => {
    const e = {
        ...createEmptyRunEvidence(),
        toolResults: [{ tool: "edit", ok: true, summary: "ok" }, { tool: "check", ok: true, summary: "passed" }],
        filesRead: ["src/test.ts"],
        filesEdited: ["src/test.ts"],
        checksRun: [{ name: "check", ok: true }],
    };
    eq(getPatchPhase({ evidence: e }), "verified", "phase");
});
test("two reads -> ready_to_propose", () => {
    const e = {
        ...createEmptyRunEvidence(),
        toolResults: [{ tool: "read", ok: true, summary: "ok" }],
        filesRead: ["src/a.ts", "src/b.ts"],
    };
    eq(getPatchPhase({ evidence: e }), "ready_to_propose", "phase");
});
// ── Search after read rejection (Task 9.1)
console.log("T9.1: Broad search rejected after read");
test("broad query rejected even with reason", () => {
    const progress = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress, toolName: "read", args: { path: "test.ts" }, ok: true });
    const d = checkPatchPhasePolicy({
        phase: "ready_to_change",
        toolName: "search",
        args: { query: "mode", reason: "looking for mode" },
        progress: p2,
        maxTotalSearchesPerRun: 4,
        maxSearchesAfterFirstRead: 1,
        requireReasonForSearchAfterRead: true,
    });
    assert(!d.allowed, "rejected");
    if (!d.allowed) {
        assert(d.summary.includes("too broad"), "mentions broad query");
    }
});
test("broad query 'mode' rejected after read", () => {
    const progress = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress, toolName: "read", args: { path: "test.ts" }, ok: true });
    assert(p2.firstReadHappened, "first read happened");
    const d = checkPatchPhasePolicy({
        phase: "ready_to_change",
        toolName: "search",
        args: { query: "mode" },
        progress: p2,
        maxTotalSearchesPerRun: 4,
        maxSearchesAfterFirstRead: 1,
        requireReasonForSearchAfterRead: true,
    });
    assert(!d.allowed, "rejected");
    if (!d.allowed) {
        assert(d.summary.includes("reason"), "mentions missing reason (or broad query)");
    }
});
test("query 'config' is broad", () => {
    assert(isBroadSearchQuery("config"), "config is broad");
});
test("query 'handleRuntimeIntent' is not broad", () => {
    assert(!isBroadSearchQuery("handleRuntimeIntent"), "handleRuntimeIntent not broad");
});
// ── Search then read then edit allowed (Task 9.2)
console.log("T9.2: Search/read/edit allowed");
test("edit allowed after read", () => {
    const progress = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress, toolName: "read", args: { path: "test.ts" }, ok: true });
    const d = checkPatchPhasePolicy({
        phase: "ready_to_change",
        toolName: "edit",
        args: { path: "test.ts" },
        progress: p2,
        maxTotalSearchesPerRun: 4,
        maxSearchesAfterFirstRead: 1,
        requireReasonForSearchAfterRead: true,
    });
    assert(d.allowed, "edit allowed");
});
// ── Specific search with reason allowed (Task 9.3)
console.log("T9.3: Specific search with reason allowed");
test("specific search with reason allowed after read", () => {
    const progress = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress, toolName: "read", args: { path: "client.ts" }, ok: true });
    const d = checkPatchPhasePolicy({
        phase: "ready_to_change",
        toolName: "search",
        args: { query: "handleRuntimeIntent", reason: "referenced by client.ts" },
        progress: p2,
        maxTotalSearchesPerRun: 4,
        maxSearchesAfterFirstRead: 1,
        requireReasonForSearchAfterRead: true,
    });
    assert(d.allowed, "specific search allowed");
});
test("search without reason rejected after read", () => {
    const progress = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress, toolName: "read", args: { path: "client.ts" }, ok: true });
    const d = checkPatchPhasePolicy({
        phase: "ready_to_change",
        toolName: "search",
        args: { query: "handleRuntimeIntent" },
        progress: p2,
        maxTotalSearchesPerRun: 4,
        maxSearchesAfterFirstRead: 1,
        requireReasonForSearchAfterRead: true,
    });
    assert(!d.allowed, "rejected without reason");
    if (!d.allowed) {
        assert(d.summary.includes("reason"), "mentions reason");
    }
});
// ── Second post-read search rejected (Task 9.4)
console.log("T9.4: Second post-read search rejected");
test("second post-read search rejected", () => {
    const progress = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress, toolName: "read", args: { path: "client.ts" }, ok: true });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "search", args: { query: "handleRuntimeIntent", reason: "referenced" }, ok: true });
    eq(p3.searchesAfterFirstRead, 1, "searches after read = 1");
    const d = checkPatchPhasePolicy({
        phase: "ready_to_change",
        toolName: "search",
        args: { query: "otherSymbol", reason: "also referenced" },
        progress: p3,
        maxTotalSearchesPerRun: 4,
        maxSearchesAfterFirstRead: 1,
        requireReasonForSearchAfterRead: true,
    });
    assert(!d.allowed, "second post-read search rejected");
});
// ── Total search cap (Task 9.5)
console.log("T9.5: Total search cap");
test("5th search rejected with max 4", () => {
    let progress = createEmptyLocalToolProgress();
    for (let i = 0; i < 4; i++) {
        progress = updateLocalToolProgress({ progress, toolName: "search", args: { query: `q${i}` }, ok: true });
    }
    eq(progress.totalSearches, 4, "total searches = 4");
    const d = checkPatchPhasePolicy({
        phase: "locating",
        toolName: "search",
        args: { query: "q5" },
        progress,
        maxTotalSearchesPerRun: 4,
        maxSearchesAfterFirstRead: 1,
        requireReasonForSearchAfterRead: true,
    });
    assert(!d.allowed, "5th search rejected");
});
// ── Progress tracking
console.log("Progress tracking");
test("totalSearches increments", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "test" }, ok: true });
    eq(p2.totalSearches, 1, "total searches = 1");
});
test("searchesAfterFirstRead tracks post-read searches", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "a" }, ok: true });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "read", args: { path: "f.ts" }, ok: true });
    const p4 = updateLocalToolProgress({ progress: p3, toolName: "search", args: { query: "b", reason: "test" }, ok: true });
    eq(p4.searchesAfterFirstRead, 1, "searches after read = 1");
    eq(p4.firstReadHappened, true, "first read happened");
});
test("searchesAfterFirstRead only increments after read", () => {
    const p = createEmptyLocalToolProgress();
    const p2 = updateLocalToolProgress({ progress: p, toolName: "search", args: { query: "a" }, ok: true });
    const p3 = updateLocalToolProgress({ progress: p2, toolName: "search", args: { query: "b" }, ok: true });
    eq(p3.searchesAfterFirstRead, 0, "no searches after read yet");
    eq(p3.firstReadHappened, false, "first read not happened");
});
console.log("\nDone.");
