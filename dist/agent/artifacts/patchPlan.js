export function emptyPatchPlan(goal) {
    return {
        goal,
        edits: [],
        checks: [],
        risk: "low",
        needsUserInput: false,
        questions: [],
    };
}
export function buildPatchPlan(input) {
    const lines = input.planText.split("\n").filter((l) => l.trim().length > 0);
    const edits = [];
    for (const line of lines) {
        const trimmed = line.replace(/^[-*\d.]\s*/, "").trim();
        if (!trimmed)
            continue;
        const pathMatch = trimmed.match(/\b([\w./-]+\.[a-z]{2,6})\b/i);
        const path = pathMatch ? pathMatch[1] : "";
        const isCreate = /create|new file/i.test(trimmed);
        const isReplace = /replace[_ ]?lines|line replacement/i.test(trimmed);
        edits.push({
            path,
            target: trimmed.slice(0, 120),
            change: trimmed,
            reason: "from plan",
            preferredTool: isCreate ? "create_file" : isReplace ? "replace_lines" : "edit",
        });
    }
    const riskLevel = edits.length > 3 ? "high" : edits.length > 1 ? "medium" : "low";
    return {
        goal: input.goal,
        edits: edits.slice(0, 10),
        checks: [],
        risk: riskLevel,
        needsUserInput: false,
        questions: [],
    };
}
export function renderPatchPlanForApply(plan) {
    if (plan.edits.length === 0)
        return "No edits in plan.";
    const lines = [];
    lines.push("## PATCH PLAN");
    lines.push(`Goal: ${plan.goal}`);
    lines.push(`Risk: ${plan.risk}`);
    lines.push(`Edits: ${plan.edits.length}`);
    for (let i = 0; i < plan.edits.length; i++) {
        const e = plan.edits[i];
        lines.push(`\n${i + 1}. File: ${e.path || "TBD"}`);
        lines.push(`   Target: ${e.target}`);
        lines.push(`   Change: ${e.change}`);
        lines.push(`   Tool: ${e.preferredTool}`);
    }
    if (plan.checks.length > 0) {
        lines.push(`\nChecks: ${plan.checks.join(", ")}`);
    }
    if (plan.questions.length > 0) {
        lines.push("\nPending questions:");
        for (const q of plan.questions) {
            lines.push(`- ${q}`);
        }
    }
    return lines.join("\n");
}
