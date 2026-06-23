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
import { parseLocalTextActions } from "./localTextToolParser.js";
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
import { checkEditPressurePolicy } from "./editPressurePolicy.js";

const MAX_STEPS = 24;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_CONSECUTIVE_INVALID = 3;
const PROVIDER_RETRY_DELAY_MS = 800;

export type AgentStopReason =
  | "final_block"
  | "plain_text"
  | "max_steps"
  | "invalid_output"
  | "no_verified_completion"
  | "no_change_answer"
  | "no_progress"
  | "search_after_read_loop"
  | "inspection_without_change"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "provider_error"
  | "blocked_by_policy"
  | "blocked_by_permission"
  | "blocked_by_safety";

export type FocusedAgentStatus =
  | "completed"
  | "partial"
  | "failed"
  | "waiting_for_user"
  | "waiting_for_approval"
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
  pendingOperations?: string[];
};

const ASK_TOOLS = ["search", "read", "ask_user"];
const PATCH_TOOLS = ["search", "read", "propose_edit", "create_file", "edit", "replace_lines", "check", "bash", "ask_user"];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientProviderError(error: string | undefined): boolean {
  if (!error) return true;
  const e = error.toLowerCase();
  if (/(401|403|invalid api key|unauthorized|forbidden|authentication)/.test(e)) return false;
  if (/(timeout|aborted|abort|econnreset|enotfound|econnrefused|fetch failed|socket|network|5\d\d|rate limit|429|overloaded|temporarily)/.test(e)) return true;
  return false;
}

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
  maxSteps?: number;
  signal?: AbortSignal;
}): Promise<FocusedAgentResult> {
  const { packet, leads, tools, provider, model, mode, runtimeIntent, config, root, db, events, projectRules, taskId, signal: userSignal } = input;
  const allowedTools = mode === "ask" ? ASK_TOOLS : PATCH_TOOLS;
  const toolDefs = tools.list();
  const budget = budgetForTokenLimit(config.context.maxPromptTokens);
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxSteps = input.maxSteps ?? MAX_STEPS;

  let memory = input.memory ?? createWorkingMemory(packet);
  const toolPrompt = renderLocalTextToolPrompt({ mode, allowedTools, runtimeIntent });
  const fullSystem = `${toolPrompt}`;
  const changedFiles: string[] = [];
  const checksRun: string[] = [];
  let finalText = "";
  let consecutiveInvalid = 0;
  let latestToolResultText = "";
  const metrics = createEmptyRunMetrics();
  const evidence = createEmptyRunEvidence();
  let progress: LocalToolProgress = createEmptyLocalToolProgress();
  const allowNoEditCompletion = isNoEditTask({ mode, taskGoal: packet.goal, successCriteria: packet.successCriteria, nonGoals: packet.nonGoals });
  const allowInspectedNoEditFinal = allowNoEditCompletion;

  events?.emit("task:phase", "tooling");

  for (let step = 0; step < maxSteps; step++) {
    if (userSignal?.aborted) {
      return buildFinal(memory, "Cancelled by user.", "blocked_by_policy", changedFiles, checksRun, metrics, evidence);
    }
    if (Date.now() > deadline) {
      return buildFinal(memory, finalText, "max_steps", changedFiles, checksRun, metrics, evidence);
    }

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
    const maxOut = Math.max(config.ollama.numPredict, budget.outputReserveTokens, 8192);

    metrics.modelTurns++;
    const promptTokens = estimateTokens(prompt);
    const systemTokens = estimateTokens(fullSystem);
    metrics.tokensEstimatedIn += promptTokens + systemTokens;

    events?.emit("context:usage", {
      promptTokens: promptTokens + systemTokens,
      budget: config.context.maxPromptTokens,
      phase: mode,
    });

    const timeoutSignal = AbortSignal.timeout(remaining);
    const combinedSignal = userSignal
      ? AbortSignal.any ? AbortSignal.any([timeoutSignal, userSignal]) : timeoutSignal
      : timeoutSignal;

    const genOpts = {
      system: fullSystem,
      maxTokens: maxOut,
      temperature: 0 as const,
      signal: combinedSignal,
    };

    let response = await provider.generate(model, prompt, genOpts);
    if (!response.ok && isTransientProviderError(response.error) && Date.now() < deadline) {
      metrics.providerRetries = (metrics.providerRetries ?? 0) + 1;
      await sleep(PROVIDER_RETRY_DELAY_MS);
      response = await provider.generate(model, prompt, genOpts);
    }

    if (!response.ok) {
      finalText = response.error || "Provider call failed";
      return buildFinal(memory, finalText, "provider_error", changedFiles, checksRun, metrics, evidence);
    }

    metrics.tokensEstimatedOut += estimateTokens(response.text);
    const actions = parseLocalTextActions(response.text);

    if (actions.some((a) => (a.kind === "tool_call" || a.kind === "final") && (a.repaired || (a.warnings && a.warnings.length > 0)))) {
      metrics.tagNormalizations++;
    }

    if (actions.length === 0) {
      metrics.invalidOutputs++;
      consecutiveInvalid++;
      if (consecutiveInvalid > MAX_CONSECUTIVE_INVALID) {
        finalText = `Too many empty/invalid responses. Last error: empty model output.`;
        return buildFinal(memory, finalText, "invalid_output", changedFiles, checksRun, metrics, evidence);
      }
      latestToolResultText = renderLocalTextToolResult({
        tool: "protocol", ok: false, summary: "Empty response.",
        nextActions: ["Output exactly one <tool_call> or <final> block."],
      });
      continue;
    }

    let actedThisTurn = false;
    let turnEnded = false;

    for (const action of actions) {
      events?.emit("task:phase", action.kind === "tool_call" ? `tool:${action.tool}` : action.kind);

      // ── Plain text ──
      if (action.kind === "plain_text") {
        // Prose interleaved with tool calls is ignored; only a lone prose turn is treated as an answer.
        if (actions.length === 1) {
          finalText = action.content;
          if (mode === "ask") { actedThisTurn = true; turnEnded = true; break; }

          const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion, allowInspectedNoEditFinal });
          if (gate.canComplete) { actedThisTurn = true; turnEnded = true; break; }

          latestToolResultText = renderLocalTextToolResult({
            tool: "protocol", ok: false,
            summary: "Plain answer is not enough in patch mode.",
            nextActions: ["Use read/edit/create_file/check, then output <final>."],
          });
        }
        continue;
      }

      // ── Final block ──
      if (action.kind === "final") {
        metrics.finalCalls++;
        finalText = action.content;
        const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion, allowInspectedNoEditFinal });
        if (gate.canComplete) { actedThisTurn = true; turnEnded = true; break; }
        latestToolResultText = renderLocalTextToolResult({
          tool: "protocol", ok: false,
          summary: buildNoEvidenceMessage({ mode, metrics, evidence, modelOutput: action.content, gateResult: gate }),
          nextActions: gate.warnings.length > 0 ? gate.warnings : ["Make the required edit, run a check, then output <final>."],
        });
        actedThisTurn = true;
        continue;
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

      // ── Tool call ──
      const { tool: toolName, args } = action;
      metrics.toolCallsRequested++;

      switch (toolName) {
        case "search": metrics.searches++; break;
        case "read": metrics.reads++; break;
        case "edit": metrics.edits++; break;
        case "replace_lines": metrics.replaceLineEdits++; break;
        case "create_file": break;
        case "propose_edit": metrics.proposeEditCalls++; break;
        case "check": metrics.checks++; break;
        case "bash": metrics.bashCalls++; break;
        case "ask_user": metrics.askUserCalls++; break;
      }

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
        actedThisTurn = true;
        turnEnded = true;
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



      if (runtimeIntent === "patch") {
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

      const meta = toolResult.metadata as Record<string, unknown> | undefined;
      if (meta?.pendingOperationId && meta?.queued) {
        evidence.pendingFileOperations.push(String(meta.pendingOperationId));
      }

      memory = await compactToolResult({ memory, toolName, toolArgs: args, rawResult: toolResult });
      progress = updateLocalToolProgress({ progress, toolName, args, ok: toolResult.ok });
      actedThisTurn = true;

      // If a tool queues approval, exit the loop immediately (preserves approval flow).
      if (meta?.queued && evidence.pendingFileOperations.length > 0 && toolResult.ok) {
        const pendingIds = evidence.pendingFileOperations.join(", ");
        events?.emit("task:phase", "waiting_for_approval");
        return {
          ok: true,
          status: "waiting_for_approval",
          finalText: `File changes queued for approval.\n\n${toolResult.summary}\n\nPending operations: ${pendingIds}`,
          changedFiles: [...new Set(changedFiles)],
          checksRun: [...new Set(checksRun)],
          metrics, evidence, stopReason: "waiting_for_approval",
          memory,
          pendingOperations: [...evidence.pendingFileOperations],
        };
      }

      if (toolName === "ask_user" && toolResult.ok) {
        const am = toolResult.metadata as Record<string, unknown> | undefined;
        events?.emit("task:phase", "waiting_for_user");
        return {
          ok: true, status: "waiting_for_user",
          finalText: toolResult.summary,
          changedFiles: [...new Set(changedFiles)],
          checksRun: [...new Set(checksRun)],
          metrics, evidence, stopReason: "waiting_for_user",
          memory,
          questionId: am?.questionId ? String(am.questionId) : undefined,
        };
      }
    }

    if (actedThisTurn) consecutiveInvalid = 0;
    if (turnEnded) break;
  }

  events?.emit("task:phase", "finishing");

  // ── Post-loop diagnostics (softened: prefer partial over failed when useful work happened) ──
  const changed = evidence.filesEdited.length > 0 || evidence.filesCreated.length > 0;
  const inspected = evidence.filesRead.length > 0;

  if (metrics.searches > 0 && metrics.reads === 0 && !changed && checksRun.length === 0) {
    finalText = finalText || `No progress: the agent searched ${metrics.searches} time(s) but never read a result or made a change. Try rephrasing the task.`;
    return buildFinal(memory, finalText, "no_progress", changedFiles, checksRun, metrics, evidence, "partial");
  }

  if (metrics.reads >= 2 && !changed && checksRun.length === 0 && finalText.trim().length === 0) {
    const files = evidence.filesRead.length > 0 ? [...new Set(evidence.filesRead)].slice(-4).join(", ") : "none";
    finalText = `Inspected ${files} but ran out of steps before making a change. Re-run, or provide more specific guidance.`;
    return buildFinal(memory, finalText, "inspection_without_change", changedFiles, checksRun, metrics, evidence, "partial");
  }

  metrics.totalSearches = progress.totalSearches;
  metrics.searchesAfterFirstRead = progress.searchesAfterFirstRead;
  const allowUsefulNoChange = mode === "patch" && runtimeIntent !== "patch";
  const gate = canCompleteRun({
    mode, finalText, metrics, evidence,
    allowNoEditCompletion,
    allowInspectedNoEditFinal,
    allowUsefulNoChangeAnswer: allowUsefulNoChange,
    runtimeIntent,
  });

  if (gate.status === "waiting_for_approval") {
    return {
      ok: true,
      status: "waiting_for_approval",
      finalText: finalText || "File changes queued for approval.",
      changedFiles: [...new Set(changedFiles)],
      checksRun: [...new Set(checksRun)],
      metrics, evidence,
      stopReason: "waiting_for_approval",
      memory,
      pendingOperations: [...evidence.pendingFileOperations],
    };
  }

  const hasPending = evidence.pendingFileOperations.length > 0;
  const defaultStop = gate.canComplete ? "final_block" : "no_verified_completion";
  const stopReason: AgentStopReason = (!gate.canComplete && !changed && inspected && finalText.trim().length > 0)
    ? "no_change_answer"
    : defaultStop;

  return {
    ok: gate.status !== "failed",
    status: gate.status,
    finalText: gate.canComplete ? finalText : buildNoEvidenceMessage({ mode, metrics, evidence, modelOutput: finalText, gateResult: gate }),
    changedFiles: [...new Set(changedFiles)],
    checksRun: [...new Set(checksRun)],
    metrics, evidence, stopReason,
    memory,
    ...(hasPending ? { pendingOperations: [...evidence.pendingFileOperations] } : {}),
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
