export function createPhaseHookRunner(hooks) {
    const sorted = [...hooks].sort((a, b) => a.priority - b.priority);
    return async function runPhaseHooks(phase, ctx) {
        const result = {};
        for (const hook of sorted) {
            if (hook.phase !== phase)
                continue;
            const hookResult = await hook.handler(ctx);
            if (hookResult.promptPrefix) {
                result.promptPrefix = (result.promptPrefix ?? "") + "\n" + hookResult.promptPrefix;
            }
            if (hookResult.promptSuffix) {
                result.promptSuffix = (result.promptSuffix ?? "") + "\n" + hookResult.promptSuffix;
            }
            if (hookResult.additionalTools) {
                result.additionalTools = [...(result.additionalTools ?? []), ...hookResult.additionalTools];
            }
            if (hookResult.skipPhase) {
                result.skipPhase = true;
                result.skipReason = hookResult.skipReason;
                break;
            }
        }
        return result;
    };
}
export function createContextFilterRunner(filters) {
    const sorted = [...filters].sort((a, b) => a.priority - b.priority);
    return async function runContextFilters(phase, context, memory) {
        let current = context;
        const warnings = [];
        for (const filter of sorted) {
            if (filter.phase !== phase)
                continue;
            const result = await filter.apply({ phase, context: current, memory });
            current = result.context;
            if (result.warnings)
                warnings.push(...result.warnings);
        }
        return { context: current, warnings };
    };
}
