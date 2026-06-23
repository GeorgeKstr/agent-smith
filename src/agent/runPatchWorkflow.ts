import type { TaskPacket } from "../context/taskPacket.js";
import type { RetrievalLead } from "../context/retrievalLead.js";
import type { WorkingMemory } from "./workingMemory.js";
import type { ToolRegistry } from "./tools/toolRegistry.js";
import type { Provider } from "../providers/providers.js";
import type { SmithConfig } from "../types/index.js";
import type { SmithDatabase } from "../db/db.js";
import type { RuntimeIntent } from "./runtimeIntent.js";
import { runFocusedAgentLoop } from "./focusedAgentLoop.js";
import type { FocusedAgentResult } from "./focusedAgentLoop.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import type { AgentRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import type { RunEvidence } from "./runEvidence.js";

export type PatchWorkflowResult = {
  ok: boolean;
  status: "completed" | "partial" | "failed";
  finalText: string;
  changedFiles: string[];
  checksRun: string[];
  metrics: AgentRunMetrics;
  evidence: RunEvidence;
  memory: WorkingMemory;
};

export async function runPatchWorkflow(input: {
  packet: TaskPacket;
  leads: RetrievalLead[];
  memory: WorkingMemory;
  tools: ToolRegistry;
  provider: Provider;
  model: string;
  runtimeIntent: RuntimeIntent;
  config: SmithConfig;
  root: string;
  db: SmithDatabase;
  events?: NodeJS.EventEmitter;
  projectRules?: string;
  fileCards?: Array<{ path: string; purpose: string; exports: string[] }>;
  taskId?: string;
  timeoutMs?: number;
  skills?: string;
  signal?: AbortSignal;
}): Promise<PatchWorkflowResult> {
  const { packet, leads, tools, provider, model, runtimeIntent, config, root, db, events, projectRules, fileCards, taskId, signal } = input;

  const metrics = createEmptyRunMetrics();
  const evidence = createEmptyRunEvidence();

  const loopResult = await runFocusedAgentLoop({
    packet, leads, tools, provider, model, config, root, db, events, projectRules, fileCards, taskId,
    mode: "patch",
    runtimeIntent,
    memory: input.memory,
    timeoutMs: input.timeoutMs,
    signal,
  });

  metrics.modelTurns += loopResult.metrics.modelTurns;
  metrics.toolCallsRequested += loopResult.metrics.toolCallsRequested;
  metrics.toolCallsSucceeded += loopResult.metrics.toolCallsSucceeded;
  metrics.toolCallsFailed += loopResult.metrics.toolCallsFailed;

  evidence.filesRead.push(...loopResult.evidence.filesRead);
  evidence.filesEdited.push(...loopResult.evidence.filesEdited);
  evidence.filesCreated.push(...loopResult.evidence.filesCreated);
  for (const c of loopResult.evidence.checksRun) evidence.checksRun.push(c);

  return {
    ok: loopResult.ok,
    status: loopResult.status === "completed" ? "completed" : loopResult.status === "partial" ? "partial" : "failed",
    finalText: loopResult.finalText,
    changedFiles: loopResult.changedFiles,
    checksRun: loopResult.checksRun,
    metrics,
    evidence,
    memory: loopResult.memory,
  };
}
