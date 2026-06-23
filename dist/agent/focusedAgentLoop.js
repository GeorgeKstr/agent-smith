import { createWorkingMemory } from "./workingMemory.js";
import { budgetForTokenLimit } from "../context/contextBudget.js";
import { estimateTokens } from "../context/tokenEstimate.js";
import { compactToolResult } from "./compactToolResult.js";
import { renderLocalTextToolPrompt } from "./localTextToolPrompt.js";
import { renderPhaseToolPrompt } from "./phaseToolPrompt.js";
import { toolsForPhase } from "./phaseTools.js";
import { parseLocalTextActions } from "./localTextToolParser.js";
import { renderLocalTextToolResult } from "./localTextToolResult.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import { canCompleteRun, buildNoEvidenceMessage } from "./completionGate.js";
import { isNoEditTask } from "./noEditTask.js";
import { isWriteTool, WRITE_TOOLS } from "./toolPermissions.js";
import { createEmptyLocalToolProgress, updateLocalToolProgress } from "./localToolProgress.js";
import { checkLocalToolProgressPolicy } from "./localToolProgressPolicy.js";
import { getPatchPhase } from "./patchPhase.js";
import { checkPatchPhasePolicy } from "./patchPhasePolicy.js";
import { checkEditPressurePolicy } from "./editPressurePolicy.js";
const MAX_STEPS = 24;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_CONSECUTIVE_INVALID = 3;
const PROVIDER_RETRY_DELAY_MS = 800;
const ASK_TOOLS = ["search", "read", "ask_user"];
const PATCH_TOOLS = ["search", "read", "propose_edit", "create_file", "edit", "replace_lines", "check", "ask_user"];
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function isTransientProviderError(error) {
    if (!error)
        return true;
    const e = error.toLowerCase();
    if (/(401|403|invalid api key|unauthorized|forbidden|authentication)/.test(e))
        return false;
    if (/(timeout|aborted|abort|econnreset|enotfound|econnrefused|fetch failed|socket|network|5\d\d|rate limit|429|overloaded|temporarily)/.test(e))
        return true;
    return false;
}
export async function runFocusedAgentLoop(input) {
    const { packet, leads, tools, provider, model, mode, runtimeIntent, config, root, db, events, projectRules, taskId } = input;
    const phase = input.phase;
    const allowedTools = input.allowedToolsOverride ?? (phase ? toolsForPhase(phase) : (mode === "ask" ? ASK_TOOLS : PATCH_TOOLS));
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
    const changedFiles = [];
    const checksRun = [];
    let finalText = "";
    let consecutiveInvalid = 0;
    let latestToolResultText = "";
    const metrics = createEmptyRunMetrics();
    const evidence = createEmptyRunEvidence();
    let progress = createEmptyLocalToolProgress();
    const allowNoEdit = isNoEditTask({ mode, taskGoal: packet.goal, successCriteria: packet.successCriteria, nonGoals: packet.nonGoals });
    const phaseHasWriteTools = allowedTools.some((t) => WRITE_TOOLS.includes(t));
    const phaseHasRead = allowedTools.includes("read");
    const allowPhaseNoEdit = phase != null && !phaseHasWriteTools;
    const phaseNoEditNeedsRead = allowPhaseNoEdit && phaseHasRead;
    const phaseNoEditNeedsText = allowPhaseNoEdit && !phaseHasRead;
    const allowNoEditCompletion = allowNoEdit || phaseNoEditNeedsText;
    const allowInspectedNoEditFinal = allowNoEdit || phaseNoEditNeedsRead;
    events?.emit("task:phase", "tooling");
    for (let step = 0; step < maxSteps; step++) {
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
            phase: phase ?? mode,
        });
        const genOpts = {
            system: fullSystem,
            maxTokens: maxOut,
            temperature: 0,
            signal: AbortSignal.timeout(remaining),
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
                    if (mode === "ask") {
                        actedThisTurn = true;
                        turnEnded = true;
                        break;
                    }
                    const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion, allowInspectedNoEditFinal });
                    if (gate.canComplete) {
                        actedThisTurn = true;
                        turnEnded = true;
                        break;
                    }
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
                // In a phased workflow, <final> ends this phase's loop. The workflow
                // decides downstream (via phase exit criteria) whether to proceed.
                // The strict patch-mode completion gate only applies to the top-level
                // (non-phase) loop, so non-write phases like explore can exit via <final>
                // instead of burning all their steps after emitting a phase summary.
                if (phase) {
                    actedThisTurn = true;
                    turnEnded = true;
                    break;
                }
                const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion, allowInspectedNoEditFinal });
                if (gate.canComplete) {
                    actedThisTurn = true;
                    turnEnded = true;
                    break;
                }
                // Not verifiable yet — nudge and keep going (there may be more actions this turn).
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
                case "search":
                    metrics.searches++;
                    break;
                case "read":
                    metrics.reads++;
                    break;
                case "edit":
                    metrics.edits++;
                    break;
                case "replace_lines":
                    metrics.replaceLineEdits++;
                    break;
                case "create_file": break;
                case "propose_edit":
                    metrics.proposeEditCalls++;
                    break;
                case "check":
                    metrics.checks++;
                    break;
                case "ask_user":
                    metrics.askUserCalls++;
                    break;
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
                    }
                    else if (progress.firstReadHappened && progress.searchesAfterFirstRead >= 1) {
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
            let toolResult;
            try {
                toolResult = await toolDef.handler(args, { root, db, config, events, memory, taskId });
            }
            catch (err) {
                toolResult = { ok: false, summary: `Tool error: ${err instanceof Error ? err.message : String(err)}` };
            }
            if (toolResult.ok)
                metrics.toolCallsSucceeded++;
            else
                metrics.toolCallsFailed++;
            if (toolName === "propose_edit") {
                if (toolResult.ok)
                    metrics.proposeEditAccepted++;
                else
                    metrics.proposeEditRejected++;
            }
            latestToolResultText = renderLocalTextToolResult({
                tool: toolName, ok: toolResult.ok, summary: toolResult.summary,
                content: toolResult.content, nextActions: toolResult.nextActions, truncated: toolResult.truncated,
            });
            evidence.toolResults.push({ tool: toolName, ok: toolResult.ok, summary: toolResult.summary });
            if (toolName === "read" && toolResult.ok) {
                const meta = toolResult.metadata;
                if (meta?.path)
                    evidence.filesRead.push(String(meta.path));
            }
            if ((toolName === "edit" || toolName === "replace_lines") && toolResult.ok) {
                const meta = toolResult.metadata;
                if (meta?.path) {
                    evidence.filesEdited.push(String(meta.path));
                    changedFiles.push(String(meta.path));
                }
            }
            if (toolName === "create_file" && toolResult.ok) {
                const meta = toolResult.metadata;
                if (meta?.path) {
                    evidence.filesCreated.push(String(meta.path));
                    changedFiles.push(String(meta.path));
                }
            }
            if (toolName === "check") {
                evidence.checksRun.push({ name: toolName, ok: toolResult.ok, summary: toolResult.summary });
                checksRun.push(toolName);
            }
            const meta = toolResult.metadata;
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
                const am = toolResult.metadata;
                // In phased workflow mode (explore/plan/apply/verify), treat ask_user
                // as a soft nudge — tell the model to proceed without asking, rather
                // than blocking the entire workflow. Only the top-level (non-phase)
                // loop returns waiting_for_user for genuine interactive TUI sessions.
                if (phase) {
                    latestToolResultText = renderLocalTextToolResult({
                        tool: "ask_user", ok: true,
                        summary: "In this phase, proceed without asking. Make your best decision and continue.",
                        nextActions: ["Use the available tools to proceed. Do not use ask_user in this phase."],
                    });
                    continue;
                }
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
        if (actedThisTurn)
            consecutiveInvalid = 0;
        if (turnEnded)
            break;
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
    const stopReason = (!gate.canComplete && !changed && inspected && finalText.trim().length > 0)
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
function buildCompactPrompt(input) {
    const parts = [];
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
function buildFinal(memory, text, stopReason, files, checks, metrics, evidence, overrideStatus) {
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
