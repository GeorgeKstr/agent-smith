import { createWorkingMemory } from "./workingMemory.js";
import { budgetForTokenLimit } from "../context/contextBudget.js";
import { estimateTokens } from "../context/tokenEstimate.js";
import { compactToolResult } from "./compactToolResult.js";
import { renderLocalTextToolPrompt } from "./localTextToolPrompt.js";
import { parseLocalTextAction } from "./localTextToolParser.js";
import { renderLocalTextToolResult } from "./localTextToolResult.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import { canCompleteRun, buildNoEvidenceMessage } from "./completionGate.js";
import { isNoEditTask } from "./noEditTask.js";
const MAX_STEPS = 12;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_CONSECUTIVE_INVALID = 2;
const ASK_TOOLS = ["search", "read", "ask_user"];
const PATCH_TOOLS = ["search", "read", "create_file", "edit", "replace_lines", "check", "ask_user"];
export async function runFocusedAgentLoop(input) {
    const { packet, leads, tools, provider, model, mode, config, root, db, events, projectRules, taskId } = input;
    const allowedTools = mode === "ask" ? ASK_TOOLS : PATCH_TOOLS;
    const toolDefs = tools.list();
    const budget = budgetForTokenLimit(config.context.maxPromptTokens);
    const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let memory = input.memory ?? createWorkingMemory(packet);
    const toolPrompt = renderLocalTextToolPrompt({ mode, allowedTools });
    const fullSystem = `${toolPrompt}`;
    const changedFiles = [];
    const checksRun = [];
    let finalText = "";
    let consecutiveInvalid = 0;
    let latestToolResultText = "";
    const metrics = createEmptyRunMetrics();
    const evidence = createEmptyRunEvidence();
    const allowNoEdit = isNoEditTask({ mode, taskGoal: packet.goal, successCriteria: packet.successCriteria, nonGoals: packet.nonGoals });
    events?.emit("task:phase", "tooling");
    for (let step = 0; step < MAX_STEPS; step++) {
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
        metrics.tokensEstimatedIn += estimateTokens(prompt);
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
        const action = parseLocalTextAction(response.text);
        events?.emit("task:phase", action.kind === "tool_call" ? `tool:${action.tool}` : action.kind);
        // ── Plain text ──
        if (action.kind === "plain_text") {
            finalText = action.content;
            if (mode === "ask")
                break;
            const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion: allowNoEdit });
            if (gate.canComplete)
                break;
            finalText = buildNoEvidenceMessage({ mode, metrics, evidence, modelOutput: action.content, gateResult: gate });
            return buildFinal(memory, finalText, "no_verified_completion", changedFiles, checksRun, metrics, evidence, gate.status);
        }
        // ── Final block ──
        if (action.kind === "final") {
            metrics.finalCalls++;
            finalText = action.content;
            const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion: allowNoEdit });
            if (gate.canComplete)
                break;
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
            case "create_file": /* counted as toolCallsRequested */ break;
            case "check":
                metrics.checks++;
                break;
            case "ask_user":
                metrics.askUserCalls++;
                break;
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
        events?.emit("task:phase", `tool:${toolName}`);
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
        latestToolResultText = renderLocalTextToolResult({
            tool: toolName, ok: toolResult.ok, summary: toolResult.summary,
            content: toolResult.content, nextActions: toolResult.nextActions, truncated: toolResult.truncated,
        });
        evidence.toolResults.push({ tool: toolName, ok: toolResult.ok, summary: toolResult.summary });
        // Track evidence
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
        memory = await compactToolResult({ memory, toolName, toolArgs: args, rawResult: toolResult });
        if (toolName === "ask_user" && toolResult.ok) {
            const meta = toolResult.metadata;
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
    // Determine final status
    const gate = canCompleteRun({ mode, finalText, metrics, evidence, allowNoEditCompletion: allowNoEdit });
    const stopReason = gate.canComplete ? "final_block" : "no_verified_completion";
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
