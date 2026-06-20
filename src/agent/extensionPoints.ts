import type { AgentTool } from "./tools/toolRegistry.js";
import type { AgentWorkflowPhase } from "./workflowPhase.js";
import type { WorkingMemory } from "./workingMemory.js";
import type { RunEvidence } from "./runEvidence.js";
import type { SmithConfig } from "../types/index.js";
import type { SmithDatabase } from "../db/db.js";

export type PhaseHookContext = {
  phase: AgentWorkflowPhase;
  root: string;
  db: SmithDatabase;
  config: SmithConfig;
  memory: WorkingMemory;
  evidence: RunEvidence;
};

export type PhaseHookResult = {
  promptPrefix?: string;
  promptSuffix?: string;
  additionalTools?: string[];
  skipPhase?: boolean;
  skipReason?: string;
};

export type PhaseHook = {
  name: string;
  phase: AgentWorkflowPhase;
  priority: number;
  handler: (ctx: PhaseHookContext) => Promise<PhaseHookResult>;
};

export type ContextFilter = {
  name: string;
  phase: AgentWorkflowPhase;
  priority: number;
  apply: (input: {
    phase: AgentWorkflowPhase;
    context: string;
    memory: WorkingMemory;
  }) => Promise<{ context: string; warnings?: string[] }>;
};

export type Skill = {
  name: string;
  description: string;
  triggers: string[];
  prompt: string;
  tools?: string[];
  phase?: AgentWorkflowPhase;
};

export type AgentExtension = {
  name: string;
  description?: string;
  version?: string;
  tools?: AgentTool[];
  skills?: Skill[];
  contextFilters?: ContextFilter[];
  phaseHooks?: PhaseHook[];
};

export function createPhaseHookRunner(hooks: PhaseHook[]) {
  const sorted = [...hooks].sort((a, b) => a.priority - b.priority);

  return async function runPhaseHooks(
    phase: AgentWorkflowPhase,
    ctx: PhaseHookContext,
  ): Promise<PhaseHookResult> {
    const result: PhaseHookResult = {};

    for (const hook of sorted) {
      if (hook.phase !== phase) continue;
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

export function createContextFilterRunner(filters: ContextFilter[]) {
  const sorted = [...filters].sort((a, b) => a.priority - b.priority);

  return async function runContextFilters(
    phase: AgentWorkflowPhase,
    context: string,
    memory: WorkingMemory,
  ): Promise<{ context: string; warnings: string[] }> {
    let current = context;
    const warnings: string[] = [];

    for (const filter of sorted) {
      if (filter.phase !== phase) continue;
      const result = await filter.apply({ phase, context: current, memory });
      current = result.context;
      if (result.warnings) warnings.push(...result.warnings);
    }

    return { context: current, warnings };
  };
}
