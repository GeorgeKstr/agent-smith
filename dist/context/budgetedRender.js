import { charDiv4Estimator } from "./tokenEstimate.js";
export function renderBudgetedSections(input) {
    const estimator = input.estimator ?? charDiv4Estimator;
    const omitted = [];
    const warnings = [];
    const parts = [];
    let totalUsed = 0;
    for (const section of input.sections) {
        const tokens = estimator.estimate(section.content);
        if (tokens <= section.maxTokens) {
            parts.push(section.content);
            totalUsed += tokens;
        }
        else {
            const trimmed = trimToTokenBudget(section.content, section.maxTokens, estimator);
            parts.push(trimmed);
            totalUsed += estimator.estimate(trimmed);
            omitted.push(section.name);
            warnings.push(`Section "${section.name}" was trimmed (${tokens} tokens > ${section.maxTokens} budget).`);
        }
    }
    return {
        text: parts.join("\n\n"),
        usedTokens: totalUsed,
        omitted,
        warnings,
    };
}
export function trimToTokenBudget(text, maxTokens, estimator = charDiv4Estimator) {
    const current = estimator.estimate(text);
    if (current <= maxTokens)
        return text;
    const lines = text.split("\n");
    const out = [];
    let used = 0;
    for (const line of lines) {
        const lineTokens = estimator.estimate(line + "\n");
        if (used + lineTokens > maxTokens) {
            break;
        }
        out.push(line);
        used += lineTokens;
    }
    if (out.length < lines.length) {
        out.push(`... [trimmed ${lines.length - out.length} lines to fit token budget]`);
    }
    return out.join("\n");
}
