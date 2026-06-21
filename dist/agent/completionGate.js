export function canCompleteRun(input) {
    const { mode, finalText, metrics, evidence } = input;
    if (mode === "ask") {
        if (finalText.trim().length > 0) {
            return { canComplete: true, status: "completed", warnings: [], reason: "Ask mode produced a final answer." };
        }
        return { canComplete: false, status: "failed", warnings: ["Ask mode produced no final answer."], reason: "No final text." };
    }
    // Patch mode
    const changed = evidence.filesEdited.length > 0 || evidence.filesCreated.length > 0;
    const checkPassed = evidence.checksRun.some((c) => c.ok);
    const hasPending = (evidence.pendingFileOperations?.length ?? 0) > 0;
    if (hasPending) {
        return {
            canComplete: false,
            status: "waiting_for_approval",
            warnings: [`${evidence.pendingFileOperations?.length ?? 0} file operation(s) are pending user approval.`],
            reason: "The agent proposed file changes, but they have not been approved/applied yet.",
        };
    }
    if (input.allowNoEditCompletion && finalText.trim().length > 0) {
        return { canComplete: true, status: "completed", warnings: ["No edits were required for this task."], reason: "Patch mode allowed to complete without edits." };
    }
    if (input.allowInspectedNoEditFinal &&
        evidence.filesRead.length > 0 &&
        finalText.trim().length > 80) {
        return {
            canComplete: true,
            status: "completed",
            warnings: ["No file changes were made after inspection."],
            reason: "The agent inspected relevant files and explained that no edit was needed."
        };
    }
    if (input.allowUsefulNoChangeAnswer &&
        isUsefulNoChangeAnswer({ finalText, evidence })) {
        return {
            canComplete: true,
            status: "completed",
            warnings: ["Answered without making file changes."],
            reason: "The model inspected files and produced a useful no-change answer.",
        };
    }
    // Plain non-code file creation doesn't need code checks
    if (!evidence.filesEdited.length && evidence.filesCreated.length > 0 &&
        evidence.filesCreated.every((p) => !/[.](ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|cpp|h|hpp|cs|php|rb|swift|kt)$/i.test(p))) {
        return { canComplete: true, status: "completed", warnings: ["No code check was required for plain file creation."], reason: "Plain non-code file was created successfully." };
    }
    // Style patches: CSS/HTML changes with no configured checks
    if (input.taskKind === "ui_style_patch" && changed) {
        const hasCodeFile = [...evidence.filesEdited, ...evidence.filesCreated]
            .some((p) => /\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp)$/i.test(p));
        if (!hasCodeFile) {
            return {
                canComplete: true,
                status: "completed",
                warnings: evidence.checksRun.length === 0 ? ["No checks were run (CSS-only change)."] : [],
                reason: "CSS/style file was changed successfully.",
            };
        }
    }
    if (changed && checkPassed) {
        return { canComplete: true, status: "completed", warnings: [], reason: "Files were changed and at least one check passed." };
    }
    const warnings = [];
    if (metrics.toolCallsRequested === 0)
        warnings.push("No tools were called.");
    if (!changed)
        warnings.push("No files were changed.");
    if (evidence.filesCreated.length > 0 && !evidence.filesEdited.length)
        warnings.push("Files were created but no code edits or checks verified.");
    if (evidence.checksRun.length === 0)
        warnings.push("No checks were run.");
    else if (!checkPassed)
        warnings.push("No checks passed.");
    if (metrics.progressPolicyRejections > 0)
        warnings.push(`${metrics.progressPolicyRejections} tool call(s) were blocked by progress policy (search/read loops).`);
    if (metrics.searches > 2 && metrics.reads === 0)
        warnings.push("Search-only loop detected: multiple searches with no reads.");
    return {
        canComplete: false,
        status: changed ? "partial" : "failed",
        warnings,
        reason: "Patch mode completion requires verified change evidence.",
    };
}
export function buildNoEvidenceMessage(input) {
    const lines = [input.gateResult.reason];
    if (input.modelOutput) {
        const clipped = input.modelOutput.length > 300 ? input.modelOutput.slice(0, 300) + "..." : input.modelOutput;
        lines.push(`\nModel output: ${clipped}`);
    }
    lines.push(`\nEvidence:`);
    lines.push(`- Model turns: ${input.metrics.modelTurns}`);
    lines.push(`- Tool calls: ${input.metrics.toolCallsRequested} (${input.metrics.toolCallsSucceeded} ok, ${input.metrics.toolCallsFailed} failed)`);
    lines.push(`- Searches: ${input.metrics.searches}, Reads: ${input.metrics.reads}, Edits: ${input.metrics.edits}, Checks: ${input.metrics.checks}`);
    if (input.metrics.progressPolicyRejections > 0) {
        lines.push(`- Progress policy rejections: ${input.metrics.progressPolicyRejections}`);
    }
    if (input.metrics.tagNormalizations > 0) {
        lines.push(`- Tag normalizations: ${input.metrics.tagNormalizations}`);
    }
    lines.push(`- Files read: ${input.evidence.filesRead.length}, Files edited: ${input.evidence.filesEdited.length}`);
    lines.push(`- Checks run: ${input.evidence.checksRun.length}`);
    // Surface recent tool failures
    const recentFailures = input.evidence.toolResults
        .filter((r) => !r.ok)
        .slice(-4);
    if (recentFailures.length > 0) {
        lines.push(`\nRecent tool failures:`);
        for (const f of recentFailures) {
            lines.push(`- ${f.tool}: ${f.summary}`);
        }
    }
    // Surface what was read
    if (input.evidence.filesRead.length > 0) {
        const unique = [...new Set(input.evidence.filesRead)].slice(-4);
        lines.push(`\nFiles inspected: ${unique.join(", ")}`);
    }
    if (input.gateResult.warnings.length > 0) {
        lines.push(`\nWarnings:`);
        for (const w of input.gateResult.warnings)
            lines.push(`- ${w}`);
    }
    return lines.join("\n");
}
function isUsefulNoChangeAnswer(input) {
    const text = input.finalText.trim();
    if (text.length < 40)
        return false;
    const bad = /^(done|fixed|task completed|completed|ok|finished|ready|success)$/i.test(text);
    if (bad)
        return false;
    if (input.evidence.filesRead.length === 0 && text.length < 120)
        return false;
    return true;
}
