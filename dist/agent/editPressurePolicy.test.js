import { checkEditPressurePolicy } from "./editPressurePolicy.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
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
// ── Task 8.1: Search blocked after reads ──
console.log("T8.1: Search blocked after inspection");
test("search blocked after 2 reads", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts", "src/b.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "search",
        evidence: e,
        totalSearches: 2,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(!d.allowed, "rejected");
    if (!d.allowed) {
        assert(d.summary.includes("Enough context"), "summary mentions context");
        assert(d.nextActions.some(a => a.includes("propose_edit")), "suggests propose_edit");
    }
});
test("search blocked after 3 searches even with only 1 read", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "search",
        evidence: e,
        totalSearches: 3,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(!d.allowed, "rejected");
});
test("search allowed below threshold", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "search",
        evidence: e,
        totalSearches: 1,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(d.allowed, "allowed");
});
test("search not blocked in ask intent", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts", "src/b.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "ask",
        toolName: "search",
        evidence: e,
        totalSearches: 5,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(d.allowed, "allowed in ask");
});
// ── Task 8.2: Edit tools allowed under pressure ──
console.log("T8.2: Edit tools allowed under pressure");
test("propose_edit allowed after 2 reads", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts", "src/b.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "propose_edit",
        evidence: e,
        totalSearches: 2,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(d.allowed, "propose_edit allowed");
});
test("edit allowed under pressure", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts", "src/b.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "edit",
        evidence: e,
        totalSearches: 3,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(d.allowed, "edit allowed");
});
test("read allowed under pressure when enabled", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts", "src/b.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "read",
        evidence: e,
        totalSearches: 3,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(d.allowed, "read allowed with flag");
});
test("read blocked under pressure when disabled", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts", "src/b.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "read",
        evidence: e,
        totalSearches: 3,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: false,
    });
    assert(!d.allowed, "read blocked without flag");
});
// ── Task 8.3: Change resets pressure ──
console.log("T8.3: Change resets pressure");
test("search allowed after an edit", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts", "src/b.ts", "src/c.ts"],
        filesEdited: ["src/a.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "search",
        evidence: e,
        totalSearches: 5,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(d.allowed, "search allowed after changes");
});
test("search allowed after create_file", () => {
    const e = {
        ...createEmptyRunEvidence(),
        filesRead: ["src/a.ts"],
        filesCreated: ["src/new.ts"],
    };
    const d = checkEditPressurePolicy({
        runtimeIntent: "patch",
        toolName: "search",
        evidence: e,
        totalSearches: 5,
        maxReadsBeforeEditPressure: 2,
        maxSearchesBeforeEditPressure: 3,
        allowReadAfterEditPressure: true,
    });
    assert(d.allowed, "search allowed after create");
});
console.log("\nDone.");
