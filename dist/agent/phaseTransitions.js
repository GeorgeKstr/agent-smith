export function shouldExitExplore(input) {
    const searchesDone = input.evidence.toolResults.filter((r) => r.tool === "search").length;
    const readsDone = input.evidence.filesRead.length;
    if (readsDone >= input.maxReads) {
        return { shouldExit: true, reason: `Reached max reads (${readsDone}/${input.maxReads}).` };
    }
    if (searchesDone >= input.maxSearches && readsDone >= 1) {
        return { shouldExit: true, reason: `Explored enough (${searchesDone} searches, ${readsDone} reads).` };
    }
    if (searchesDone >= input.maxSearches + 2 && readsDone === 0) {
        return { shouldExit: true, reason: `No relevant files found after ${searchesDone} searches.` };
    }
    return { shouldExit: false, reason: "" };
}
export function shouldExitPlanPatch(plan) {
    if (plan.edits.length > 0) {
        return { shouldExit: true, reason: `Patch plan has ${plan.edits.length} edit(s).` };
    }
    if (plan.needsUserInput) {
        return { shouldExit: true, reason: "Patch plan needs user input." };
    }
    return { shouldExit: false, reason: "Plan has no edits and no user questions." };
}
export function shouldExitApplyPatch(result) {
    if (result.changed) {
        return {
            shouldExit: true,
            reason: `Applied: ${result.filesEdited.length} edited, ${result.filesCreated.length} created.`,
        };
    }
    if (result.failedEdits.length >= 3) {
        return {
            shouldExit: true,
            reason: `Too many failed edits (${result.failedEdits.length}).`,
        };
    }
    return { shouldExit: false, reason: "No changes applied yet." };
}
export function shouldExitVerify(input) {
    if (input.checksRun.some((c) => c.ok)) {
        return { shouldExit: true, reason: "At least one check passed." };
    }
    if (input.checksRun.length >= input.maxCheckAttempts) {
        return {
            shouldExit: true,
            reason: `Reached max check attempts (${input.checksRun.length}).`,
        };
    }
    return { shouldExit: false, reason: "" };
}
export function shouldExitExploreForTask(input) {
    const { taskKind, filesRead, totalSearches, totalReads } = input;
    if (taskKind === "ui_style_patch") {
        const stylesheetRead = filesRead.some((path) => /\.(css|scss|sass|less)$/i.test(path));
        if (stylesheetRead) {
            return {
                shouldExit: true,
                reason: "Stylesheet inspected. Enough context for style patch.",
            };
        }
        if (totalReads >= 2) {
            return {
                shouldExit: true,
                reason: "Two files read for style task. Proceeding to apply.",
            };
        }
        if (totalSearches >= 3) {
            return {
                shouldExit: true,
                reason: "Max searches reached for style task exploration.",
            };
        }
        return { shouldExit: false, reason: "" };
    }
    if (taskKind === "file_create") {
        if (totalSearches >= 2) {
            return {
                shouldExit: true,
                reason: "Enough context for file creation.",
            };
        }
        return { shouldExit: false, reason: "" };
    }
    return { shouldExit: false, reason: "" };
}
