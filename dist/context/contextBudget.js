export const DEFAULT_4K_BUDGET = {
    maxPromptTokens: 4096,
    systemTokens: 400,
    projectRulesTokens: 300,
    taskPacketTokens: 600,
    fileCardsTokens: 800,
    liveCodeTokens: 900,
    toolHistoryTokens: 400,
    outputReserveTokens: 600,
};
export const DEFAULT_8K_BUDGET = {
    maxPromptTokens: 8192,
    systemTokens: 700,
    projectRulesTokens: 600,
    taskPacketTokens: 900,
    fileCardsTokens: 1200,
    liveCodeTokens: 2500,
    toolHistoryTokens: 1000,
    outputReserveTokens: 1500,
};
export function budgetForTokenLimit(maxPromptTokens) {
    if (maxPromptTokens <= 4096)
        return { ...DEFAULT_4K_BUDGET, maxPromptTokens };
    return { ...DEFAULT_8K_BUDGET, maxPromptTokens };
}
export function defaultBudgetFromTokens(maxPromptTokens) {
    const base = maxPromptTokens <= 4096 ? DEFAULT_4K_BUDGET : DEFAULT_8K_BUDGET;
    return { ...base, maxPromptTokens };
}
