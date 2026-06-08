import type { PromptPlan, TaskClassification, SmithConfig, ContextPlan } from "../types/index.js";

export function buildContextPlan(
  promptPlan: PromptPlan,
  classification: TaskClassification,
  config: SmithConfig
): ContextPlan {
  return {
    mode: promptPlan.intent.kind,
    objective: promptPlan.objective,
    searchQueries: promptPlan.keywords,
    fileHints: classification.likelyFiles,
    symbolHints: classification.likelySymbols,
    tagHints: classification.tagIds,
    requiredFiles: [],
    forbiddenFiles: [],
    includeTests: classification.needsTests || config.context.includeTests,
    includeTypes: classification.needsTypes || config.context.includeTypes,
    includeSummaries: config.context.includeSummaries,
    graphDepth: config.context.graphDepth,
    maxFiles: config.context.maxFiles,
    maxSymbols: config.context.maxSymbols,
    maxTokens: config.context.maxPromptTokens
  };
}
