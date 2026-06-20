import type { TaskPacket } from "../context/taskPacket.js";
import type { RetrievalLead } from "../context/retrievalLead.js";
import type { WorkingMemory } from "./workingMemory.js";
import { createWorkingMemory } from "./workingMemory.js";
import type { ToolRegistry } from "./tools/toolRegistry.js";
import type { ToolResult } from "./tools/toolRegistry.js";
import type { Provider } from "../providers/providers.js";
import type { SmithConfig } from "../types/index.js";
import type { SmithDatabase } from "../db/db.js";
import { budgetForTokenLimit } from "../context/contextBudget.js";
import { estimateTokens } from "../context/tokenEstimate.js";
import { compactToolResult } from "./compactToolResult.js";
import { renderLocalTextToolPrompt } from "./localTextToolPrompt.js";
import { renderPhaseToolPrompt } from "./phaseToolPrompt.js";
import type { AgentWorkflowPhase } from "./workflowPhase.js";
import { parseLocalTextAction } from "./localTextToolParser.js";
import type { ParsedLocalTextAction } from "./localTextToolParser.js";
import { renderLocalTextToolResult } from "./localTextToolResult.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import type { AgentRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import type { RunEvidence } from "./runEvidence.js";
import { canCompleteRun, buildNoEvidenceMessage } from "./completionGate.js";
import { isNoEditTask } from "./noEditTask.js";
import { isWriteTool } from "./toolPermissions.js";
import type { RuntimeIntent } from "./runtimeIntent.js";
import { createEmptyLocalToolProgress, updateLocalToolProgress } from "./localToolProgress.js";
import type { LocalToolProgress } from "./localToolProgress.js";
import { checkLocalToolProgressPolicy } from "./localToolProgressPolicy.js";
import { getPatchPhase } from "./patchPhase.js";
import { checkPatchPhasePolicy } from "./patchPhasePolicy.js";
import { checkEditPressurePolicy } from "./editPressurePolicy.js";

const MAX_STEPS = 12;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_CONSECUTIVE_INVALID = 2;

export type AgentStopReason =
  | "final_block"
  | "plain_text"
  | "max_steps"
  | "invalid_output"
  | "no_verified_completion"
  | "no_progress"
  | "search_after_read_loop"
  | "inspection_without_change"
  | "waiting_for_user"
  | "provider_error"
  | "blocked_by_policy"
  | "blocked_by_permission"
  | "blocked_by_safety";

export type FocusedAgentStatus =
  | "completed"
  | "partial"
  | "failed"
  | "waiting_for_user"
  | "blocked";

export type FocusedAgentResult = {
  ok: boolean;
  status: FocusedAgentStatus;
  finalText: string;
  changedFiles: string[];
  checksRun: string[];
  metrics: AgentRunMetrics;
  evidence: RunEvidence;
  stopReason: AgentStopReason;
  memory: WorkingMemory;
  rawMessages?: unknown[];
  questionId?: string;
};

const ASK_TOOLS = ["search", "read", "ask_user"];
const PATCH_TOOLS = ["search", "read", "propose_edit", "create_file", "edit", "replace_lines", "check", "ask_user"];

export async function runFocusedAgentLoop(input: {
  packet: TaskPacket;
  leads: RetrievalLead[];
  memory: WorkingMemory;
  tools: ToolRegistry;
  provider: Provider;
  model: string;
  mode: "ask" | "patch";
  runtimeIntent?: RuntimeIntent;
  config: SmithConfig;
  root: string;
  db: SmithDatabase;
  events?: NodeJS.EventEmitter;
  projectRules?: string;
  fileCards?: Array<{ path: string; purpose: string; exports: string[] }>;
  taskId?: string;
  timeoutMs?: number;
  phase?: AgentWorkflowPhase;
  allowedToolsOverride?: string[];
  phaseGoal?: string;
  phaseExitCriteria?: string[];
  maxSteps?: number;
  skipEditPressure?: boolean;
  skipPatchPhasePolicy?: boolean;
  phaseOnToolCall?: (toolName: string, args: Record<string, unknown>) => void;
}): Promise<FocusedAgentResult> {
  const { packet, leads, tools, provider, model, mode, runtimeIntent, config, root, db, events, projectRules, taskId } = input;
  const phase = input.phase;
  const allowedTools = input.allowedToolsOverride ?? (mode === "ask" ? ASK_TOOLS : PATCH_TOOLS);
  const toolDefs = tools.list();
  const budget = budgetForTokenLimit(config.context.maxPromptTokens);
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxSteps = input.maxSteps ?? MAX_STEPS;
  const skipEditPressure = input.skipEditPressure ?? false;
  const skipPatchPhasePolicy = input.skipPatchPhasePolicy ?? false;

  let memory = input.memory ?? createWorkingMemory(packet);
  const toolPrompt = phase
    ? renderPhaseToolPrompt({ phase, allowedTools, phaseGoal: input.phaseGoal, phaseExitCriteria: input.phaseExitCriteria })
    : renderLocalTextToolPrompt({ mode, allowedTools, runtimeIntent });
  const fullSystem = `${toolPrompt}`;
  const changedFiles: string[] = [];
  const checksRun: string[] = [];
  let finalText = "";
  let consecutiveInvalid = 0;
  let latestToolResultText = "";
  const metrics = createEmptyRunMetrics();
  const evidence = createEmptyRunEvidence();
  let progress: LocalToolProgress = createEmptyLocalToolProgress();
  const allowNoEdit = isNoEditTask({ mode, taskGoal: packet.goal, successCriteria: packet.successCriteria, nonGoals: packet.nonGoals });

  events?.emit("task:phase", "tooling");

  for (let step = 0; step < maxSteps; step++) {
    if (Date.now() > deadline) {
      return buildFinal(memory, finalText, "max_steps", changedFiles, checksRun, metrics, evidence);
    }

    // Build compact prompt
    const prompt = buildCompactPrompt({
      packet,
      projectRules: projectRules ?? "",
      memory,
      leads: step === 0 ? leads : [],
      fileCards: step === 0 ? (input.fileCards ?? []) : [],
      latestToolResult: step > 0 ? latestToolResultText : "",
      budget,
    });

    const remaining = Math.max(0, deadline - Date.now());
    const maxOut = Math.max(config.ollama.numPredict, budget.outputReserveTokens);

    metrics.modelTurns++;
    const promptTokens = estimateTokens(prompt);
    const systemTokens = estimateTokens(fullSystem);
    metrics.tokensEstimatedIn += promptTokens + systemTokens;

    const contextBudget = config.context.maxPromptTokens;
    events?.emit("context:usage", {
      promptTokens: promptTokens + systemTokens,
      budget: contextBudget,
      phase: phase ?? mode,
    });

    const response = await provider.generate(model, prompt, {
      system: fullSystem,
      maxTokens: maxOut,
      temperature: 0,
      signal: AbortSignal.timeout(remaining),
    });

    if (!response.ok) {
      finalText = response.error || "Provider call failed";
      return buildFinal(memory, finalText, "provider_error", changedFiles, checksRun, metrics, evidence);
    }

    metrics.tokensEstimatedOut += estimateTokens(response.text);
    const action: ParsedLocalTextAction = parseLocalTextAction(response.text);

    if ("repaired" in action && action.repaired || ("warnings" in action && action.warnings && action.warnings.length > 0)) {
      metrics.tagNormalizations++;
    }

    events?.emit("task:phase", action.kind === "tool_call" ? `tool:${action.tool}` : action.kind);

    // ── Plain text ──
    if (action.kind === "plain_text") {
      finalText = action.content;
      if (mode === "ask") break;

      const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion: allowNoEdit, allowInspectedNoEditFinal: allowNoEdit });
      if (gate.canComplete) break;

      finalText = buildNoEvidenceMessage({ mode, metrics, evidence, modelOutput: action.content, gateResult: gate });
      return buildFinal(memory, finalText, "no_verified_completion", changedFiles, checksRun, metrics, evidence, gate.status);
    }

    // ── Final block ──
    if (action.kind === "final") {
      metrics.finalCalls++;
      finalText = action.content;

      const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion: allowNoEdit, allowInspectedNoEditFinal: allowNoEdit });
      if (gate.canComplete) break;

      finalText = buildNoEvidenceMessage({ mode, metrics, evidence, modelOutput: action.content, gateResult: gate });
      return buildFinal(memory, finalText, "no_verified_completion", changedFiles, checksRun, metrics, evidence, gate.status);
    }

    // ── Invalid ──
    if (action.kind === "invalid") {
      metrics.invalidOutputs++;
      consecutiveInvalid++;
      if (consecutiveInvalid > MAX_CONSECUTIVE_INVALID) {
        finalText = `Too many invalid responses. Last error: ${action.error}`;
        return buildFinal(memory, finalText, "invalid_output", changedFiles, checksRun, metrics, evidence);
      }
      latestToolResultText = renderLocalTextToolResult({
        tool: "protocol", ok: false, summary: action.error,
        nextActions: ["Output exactly one <tool_call> or <final> block."],
      });
      continue;
    }
    consecutiveInvalid = 0;

    // ── Tool call ──
    const { tool: toolName, args } = action;
    metrics.toolCallsRequested++;

    // Increment per-tool counters
    switch (toolName) {
      case "search": metrics.searches++; break;
      case "read": metrics.reads++; break;
      case "edit": metrics.edits++; break;
      case "replace_lines": metrics.replaceLineEdits++; break;
      case "create_file": /* counted as toolCallsRequested */ break;
      case "propose_edit": metrics.proposeEditCalls++; break;
      case "check": metrics.checks++; break;
      case "ask_user": metrics.askUserCalls++; break;
    }

    // Enforce allowed tools
    if (!allowedTools.includes(toolName) && toolName !== "finish") {
      metrics.toolCallsFailed++;
      evidence.toolResults.push({ tool: toolName, ok: false, summary: `Not allowed in ${mode} mode.` });
      latestToolResultText = renderLocalTextToolResult({
        tool: toolName, ok: false,
        summary: `Tool "${toolName}" is not allowed in ${mode} mode.`,
        nextActions: [`Allowed tools: ${allowedTools.join(", ")}, finish`],
      });
      continue;
    }

    if (runtimeIntent && runtimeIntent !== "patch" && isWriteTool(toolName)) {
      metrics.toolCallsFailed++;
      evidence.toolResults.push({ tool: toolName, ok: false, summary: `Write tool blocked for ${runtimeIntent} intent.` });
      latestToolResultText = renderLocalTextToolResult({
        tool: toolName, ok: false,
        summary: `Tool "${toolName}" is not allowed for ${runtimeIntent} intent. Only patch intent can write files.`,
        nextActions: runtimeIntent === "ask"
          ? ["Use search or read to get information, then answer with <final>."]
          : ["Answer conversationally with <final>."],
      });
      continue;
    }

    if (toolName === "finish") {
      metrics.toolCallsSucceeded++;
      finalText = typeof args.summary === "string" ? args.summary : "Task completed.";
      break;
    }

    const toolDef = toolDefs.find((t) => t.name === toolName);
    if (!toolDef) {
      metrics.toolCallsFailed++;
      evidence.toolResults.push({ tool: toolName, ok: false, summary: `Unknown tool.` });
      latestToolResultText = renderLocalTextToolResult({
        tool: toolName, ok: false, summary: `Unknown tool: ${toolName}`,
        nextActions: [`Allowed tools: ${allowedTools.join(", ")}, finish`],
      });
      continue;
    }

    // ── Progress policy ──
    const progressDecision = checkLocalToolProgressPolicy({
      toolName,
      args,
      progress,
      maxConsecutiveSearches: 2,
      maxConsecutiveReads: 4,
    });

    if (!progressDecision.allowed) {
      metrics.toolCallsFailed++;
      metrics.progressPolicyRejections++;
      evidence.toolResults.push({ tool: toolName, ok: false, summary: progressDecision.summary });
      latestToolResultText = renderLocalTextToolResult({
        tool: toolName, ok: false,
        summary: progressDecision.summary,
        nextActions: progressDecision.nextActions,
      });
      continue;
    }

    if (mode === "patch" && !skipPatchPhasePolicy) {
      const patchPhase = getPatchPhase({ evidence });
      const phaseDecision = checkPatchPhasePolicy({
        phase: patchPhase,
        toolName,
        args,
        progress,
        maxTotalSearchesPerRun: config.localText?.maxTotalSearchesPerRun ?? 4,
        maxSearchesAfterFirstRead: config.localText?.maxSearchesAfterFirstRead ?? 1,
        requireReasonForSearchAfterRead: config.localText?.requireReasonForSearchAfterRead ?? true,
      });

      if (!phaseDecision.allowed) {
        metrics.toolCallsFailed++;
        metrics.progressPolicyRejections++;
        metrics.patchPhasePolicyRejections++;
        evidence.toolResults.push({ tool: toolName, ok: false, summary: phaseDecision.summary });
        latestToolResultText = renderLocalTextToolResult({
          tool: toolName, ok: false,
          summary: phaseDecision.summary,
          nextActions: phaseDecision.nextActions,
        });

        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (query && query.length <= 3) {
          metrics.broadSearchRejections++;
        } else if (progress.firstReadHappened && progress.searchesAfterFirstRead >= 1) {
          metrics.postReadSearchRejections++;
        }

        continue;
      }
    }

    if (runtimeIntent === "patch" && !skipEditPressure) {
      const editPressure = checkEditPressurePolicy({
        runtimeIntent,
        toolName,
        evidence,
        totalSearches: metrics.searches,
        maxReadsBeforeEditPressure: config.localText?.maxReadsBeforeEditPressure ?? 2,
        maxSearchesBeforeEditPressure: config.localText?.maxSearchesBeforeEditPressure ?? 3,
        allowReadAfterEditPressure: config.localText?.allowReadAfterEditPressure ?? true,
      });

      if (!editPressure.allowed) {
        metrics.toolCallsFailed++;
        metrics.editPressureRejections++;
        evidence.toolResults.push({ tool: toolName, ok: false, summary: editPressure.summary });
        latestToolResultText = renderLocalTextToolResult({
          tool: toolName, ok: false,
          summary: editPressure.summary,
          nextActions: editPressure.nextActions,
        });
        continue;
      }
    }

    events?.emit("task:phase", `tool:${toolName}`);
    input.phaseOnToolCall?.(toolName, args);

    let toolResult: ToolResult;
    try {
      toolResult = await toolDef.handler(args, { root, db, config, events, memory, taskId });
    } catch (err) {
      toolResult = { ok: false, summary: `Tool error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (toolResult.ok) metrics.toolCallsSucceeded++;
    else metrics.toolCallsFailed++;

    if (toolName === "propose_edit") {
      if (toolResult.ok) metrics.proposeEditAccepted++;
      else metrics.proposeEditRejected++;
    }

    latestToolResultText = renderLocalTextToolResult({
      tool: toolName, ok: toolResult.ok, summary: toolResult.summary,
      content: toolResult.content, nextActions: toolResult.nextActions, truncated: toolResult.truncated,
    });

    evidence.toolResults.push({ tool: toolName, ok: toolResult.ok, summary: toolResult.summary });

    // Track evidence
    if (toolName === "read" && toolResult.ok) {
      const meta = toolResult.metadata as Record<string, unknown> | undefined;
      if (meta?.path) evidence.filesRead.push(String(meta.path));
    }
    if ((toolName === "edit" || toolName === "replace_lines") && toolResult.ok) {
      const meta = toolResult.metadata as Record<string, unknown> | undefined;
      if (meta?.path) {
        evidence.filesEdited.push(String(meta.path));
        changedFiles.push(String(meta.path));
      }
    }
    if (toolName === "create_file" && toolResult.ok) {
      const meta = toolResult.metadata as Record<string, unknown> | undefined;
      if (meta?.path) {
        evidence.filesCreated.push(String(meta.path));
        changedFiles.push(String(meta.path));
      }
    }
    if (toolName === "check") {
      evidence.checksRun.push({ name: toolName, ok: toolResult.ok, summary: toolResult.summary });
      checksRun.push(toolName);
    }

    memory = await compactToolResult({ memory, toolName, toolArgs: args, rawResult: toolResult });

    progress = updateLocalToolProgress({ progress, toolName, args, ok: toolResult.ok });

    if (toolName === "ask_user" && toolResult.ok) {
      const meta = toolResult.metadata as Record<string, unknown> | undefined;
      events?.emit("task:phase", "waiting_for_user");
      return {
        ok: true, status: "waiting_for_user",
        finalText: toolResult.summary,
        changedFiles: [...new Set(changedFiles)],
        checksRun: [...new Set(checksRun)],
        metrics, evidence, stopReason: "waiting_for_user",
        memory,
        questionId: meta?.questionId ? String(meta.questionId) : undefined,
      };
      }
    }

  events?.emit("task:phase", "finishing");

  if (metrics.searches > 0 && metrics.reads === 0 && changedFiles.length === 0 && checksRun.length === 0) {
    finalText = `No progress made. The agent searched repeatedly (${metrics.searches} searches) but never read a result or made a change.\n\nLikely cause:\n- search results did not provide actionable read suggestions, or\n- the model ignored the read step.\n\nNext fix:\n- improve search result rendering\n- enforce max consecutive searches`;
    return buildFinal(memory, finalText, "no_progress", changedFiles, checksRun, metrics, evidence);
  }

  if (metrics.searches >= 4 && metrics.reads >= 1 && metrics.edits === 0 && checksRun.length === 0) {
    const inspected = evidence.filesRead.length > 0 ? evidence.filesRead.join(", ") : "none";
    finalText = `The agent inspected a file but then kept searching instead of making a change.\n\nFiles inspected:\n- ${inspected}\n\nNext fix:\n- enforce patch phase policy\n- block broad search after read\n- force edit or final after inspection`;
    return buildFinal(memory, finalText, "search_after_read_loop", changedFiles, checksRun, metrics, evidence);
  }

  if (metrics.reads >= 2 && metrics.edits === 0 && evidence.filesCreated.length === 0 && checksRun.length === 0) {
    const inspected = evidence.filesRead.length > 0 ? evidence.filesRead.join(", ") : "none";
    finalText = `The agent inspected files but never proposed or applied an edit.\n\nFiles inspected:\n- ${inspected}\n\nLikely cause:\n- patch loop allowed more searching/reading instead of forcing edit proposal.\n\nNext fix:\n- enable edit pressure policy\n- add propose_edit tool\n- block further search/read after enough inspection`;
    return buildFinal(memory, finalText, "inspection_without_change", changedFiles, checksRun, metrics, evidence);
  }

  // Determine final status
  metrics.totalSearches = progress.totalSearches;
  metrics.searchesAfterFirstRead = progress.searchesAfterFirstRead;
  const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion: allowNoEdit, allowInspectedNoEditFinal: allowNoEdit });
  const stopReason: AgentStopReason = gate.canComplete ? "final_block" : "no_verified_completion";

  return {
    ok: gate.status !== "failed",
    status: gate.status,
    finalText: gate.canComplete ? finalText : buildNoEvidenceMessage({ mode, metrics, evidence, modelOutput: finalText, gateResult: gate }),
    changedFiles: [...new Set(changedFiles)],
    checksRun: [...new Set(checksRun)],
    metrics, evidence, stopReason,
    memory,
  };
}

function buildCompactPrompt(input: {
  packet: TaskPacket;
  projectRules: string;
  memory: WorkingMemory;
  leads: RetrievalLead[];
  fileCards: Array<{ path: string; purpose: string; exports: string[] }>;
  latestToolResult: string;
  budget: ReturnType<typeof budgetForTokenLimit>;
}): string {
  const parts: string[] = [];

  if (input.projectRules) {
    parts.push(`## PROJECT RULES\n${input.projectRules.slice(0, input.budget.projectRulesTokens * 4)}`);
  }

  parts.push(`## TASK
Goal: ${input.packet.goal}
Success: ${input.packet.successCriteria.join(" | ")}
Non-goals: ${input.packet.nonGoals.join("; ")}`);

  if (input.memory.confirmedFacts.length > 0) {
    parts.push(`## FACTS\n${input.memory.confirmedFacts.slice(0, 6).join("\n")}`);
  }
  if (input.memory.filesRead.length > 0) {
    const fi = input.memory.filesRead.slice(0, 4).map((f) => `${f.path} (${f.ranges.join(", ")}): ${f.summary}`).join("\n");
    parts.push(`## FILES READ\n${fi}`);
  }
  if (input.memory.editsApplied.length > 0) {
    parts.push(`## EDITS\n${input.memory.editsApplied.slice(0, 6).join("\n")}`);
  }
  if (input.memory.checkResults.length > 0) {
    parts.push(`## CHECKS\n${input.memory.checkResults.slice(0, 4).join("\n")}`);
  }

  if (input.latestToolResult) {
    parts.push(`## LATEST RESULT\n${input.latestToolResult}`);
  }

  if (input.leads.length > 0) {
    const lt = input.leads.slice(0, 6).map((l) => `${l.path}: ${l.reason}`).join("\n");
    parts.push(`## RELEVANT FILES\n${lt}`);
  }
  if (input.fileCards.length > 0) {
    const ct = input.fileCards.slice(0, 4).map((c) => `${c.path}: ${c.purpose}`).join("\n");
    parts.push(`## FILE CARDS\n${ct}`);
  }

  return parts.join("\n\n");
}

function buildFinal(
  memory: WorkingMemory,
  text: string,
  stopReason: AgentStopReason,
  files: string[],
  checks: string[],
  metrics: AgentRunMetrics,
  evidence: RunEvidence,
  overrideStatus?: FocusedAgentStatus,
): FocusedAgentResult {
  const status = overrideStatus ?? (metrics.toolCallsSucceeded > 0 ? "partial" : "failed");
  return {
    ok: status !== "failed",
    status,
    finalText: text || "Task stopped without producing output.",
    changedFiles: [...new Set(files)],
    checksRun: [...new Set(checks)],
    metrics, evidence, stopReason,
    memory,
  };
}
