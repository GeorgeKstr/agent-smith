export const charDiv4Estimator = {
    name: "char_div_4",
    estimate(text) {
        return Math.ceil(text.length / 4);
    },
};
const cl100kEstimator = {
    name: "cl100k_base",
    estimate(text) {
        try {
            const tiktoken = globalThis.tiktoken;
            if (!tiktoken?.encoding_for_model)
                throw new Error("tiktoken not available");
            const enc = tiktoken.encoding_for_model("gpt-4");
            const tokens = enc.encode(text).length;
            enc.free();
            return tokens;
        }
        catch {
            return Math.ceil(text.length / 4);
        }
    },
};
export function estimateTokens(text) {
    return charDiv4Estimator.estimate(text);
}
export function estimatorForModel(model) {
    if (/gpt|openai|claude|anthropic/i.test(model))
        return cl100kEstimator;
    // char/4 is a reasonable approximation for most local models
    return charDiv4Estimator;
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
        if (used + lineTokens > maxTokens)
            break;
        out.push(line);
        used += lineTokens;
    }
    if (out.length < lines.length) {
        out.push(`... [trimmed ${lines.length - out.length} lines to fit token budget]`);
    }
    return out.join("\n");
}
