import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { SmithConfig, PatchOutcome, ContextPacket, CheckResult } from "../types/index.js";
import type { SmithDatabase } from "../db/db.js";
import type { Indexer } from "../index/indexer.js";
import { isProviderAvailable, listProviderModels, resolveProviderModelName, createProviders, resolveModelProvider } from "../providers/providers.js";
import { classifyTask, retrieve } from "../context/retriever.js";
import { runChecks } from "./checks.js";
import { reindexAffected } from "../index/reindexer.js";
import { createTask, recordEdit, recordTestRun, finishTask } from "./memory.js";
import { buildHeuristicTaskPacket } from "../context/taskPacket.js";
import type { TaskPacket } from "../context/taskPacket.js";
import { retrieveLeads } from "../context/retrievalLead.js";
import type { RetrievalLead } from "../context/retrievalLead.js";
import { packFocusedBriefing } from "../context/focusedBriefing.js";
import { budgetForTokenLimit } from "../context/contextBudget.js";
import { createWorkingMemory } from "./workingMemory.js";
import { ToolRegistry } from "./tools/toolRegistry.js";
import { searchTool } from "./tools/searchTool.js";
import { readTool } from "./tools/readTool.js";
import { editTool } from "./tools/editTool.js";
import { replaceLinesTool } from "./tools/replaceLinesTool.js";
import { checkTool } from "./tools/checkTool.js";
import { finishTool } from "./tools/finishTool.js";
import { askUserTool } from "./tools/askUserTool.js";
import { createFileTool } from "./tools/createFileTool.js";
import { runFocusedAgentLoop } from "./focusedAgentLoop.js";
import { loadProjectRules } from "../context/projectRules.js";
import { getFileCards } from "../index/fileCards.js";
export type RunnerDeps = {
  db: SmithDatabase;
  root: string;
  config: SmithConfig;
  events: NodeJS.EventEmitter;
  indexer: Indexer;
};

export type AskResult = {
  ok: boolean;
  answer: string;
  packet: ContextPacket;
  message?: string;
};

export async function runAsk(
  deps: RunnerDeps,
  task: string,
  options: { modelOverride?: string; signal?: AbortSignal } = {}
): Promise<AskResult> {
  const { db, root, config, events } = deps;
  const emptyPacket: ContextPacket = { task, prompt: task, estimatedTokens: 0, files: [], symbols: [] };

  const ollamaReady = await isProviderAvailable(config);
  const installed = ollamaReady ? await listProviderModels(config) : [];
  const answerModel = options.modelOverride
    ? await resolveProviderModelName(config, options.modelOverride, installed)
    : await resolveProviderModelName(config, config.models.patcher, installed);

  events.emit("task:phase", "distilling");
  const packet = await buildTaskPacket(config, task, answerModel);

  events.emit("task:phase", "leading");
  const leads = await buildRetrievalLeads(deps, task, packet);

  const projectRules = await loadProjectRules({ root }).then((r) => r.rendered).catch(() => "");
  const memory = createWorkingMemory(packet);

  const cardPaths = leads.slice(0, config.context.maxFileCards ?? 8).map((l) => l.path);
  const fileCards = cardPaths.length > 0 ? getFileCards(db, cardPaths) : [];
  const cardBriefs = fileCards.map((c) => ({ path: c.path, purpose: c.purpose, exports: c.exports }));

  if (!ollamaReady) {
    const budget = budgetForTokenLimit(config.context.maxPromptTokens);
    const briefing = packFocusedBriefing({ packet, leads, projectRules, workingMemory: memory, fileCards: cardBriefs, tokenBudget: budget, mode: "ask" });
    return { ok: true, answer: "No provider available. Context built.", packet: briefing, message: "No provider." };
  }

  const resolved = resolveFocusedProvider(config, answerModel, installed);
  if (!resolved) {
    return { ok: true, answer: "No provider resolved.", packet: emptyPacket, message: "No provider." };
  }

  events.emit("task:phase", "briefing");
  const tools = buildToolRegistry("ask");
  const result = await runFocusedAgentLoop({
    packet,
    leads,
    memory,
    tools,
    provider: resolved.provider,
    model: resolved.model,
    mode: "ask",
    config,
    root,
    db,
    events,
    projectRules,
    fileCards: cardBriefs,
  });

  events.emit("task:answer", result.finalText);
  const askMsg = result.status === "waiting_for_user"
    ? "Agent is waiting for your answer."
    : result.stopReason === "no_verified_completion"
      ? "Agent could not verify completion."
      : undefined;
  return {
    ok: result.ok,
    answer: result.finalText,
    packet: emptyPacket,
    message: askMsg,
  };
}

export async function runPatch(
  deps: RunnerDeps,
  task: string,
  options: { apply: boolean; review?: boolean; modelOverride?: string; taskId?: string; signal?: AbortSignal } = { apply: true }
): Promise<PatchOutcome> {
  const { db, root, config, events } = deps;
  const checks: CheckResult[] = [];

  const ollamaReady = await isProviderAvailable(config);
  if (!ollamaReady) {
    return {
      ok: false, applied: false, attempts: 0, files: [], checks,
      message: "No AI provider available."
    };
  }

  const taskId = createTask(db, task, config.models.patcher);
  const installed = await listProviderModels(config);
  const patcherModel = options.modelOverride
    ? await resolveProviderModelName(config, options.modelOverride, installed)
    : await resolveProviderModelName(config, config.models.patcher, installed);

  events.emit("task:phase", "distilling");
  const packet = await buildTaskPacket(config, task, patcherModel);

  events.emit("task:phase", "leading");
  const leads = await buildRetrievalLeads(deps, task, packet);

  const projectRules = await loadProjectRules({ root }).then((r) => r.rendered).catch(() => "");
  const memory = createWorkingMemory(packet);

  const cardPaths = leads.slice(0, config.context.maxFileCards ?? 8).map((l) => l.path);
  const fileCards = cardPaths.length > 0 ? getFileCards(db, cardPaths) : [];
  const cardBriefs = fileCards.map((c) => ({ path: c.path, purpose: c.purpose, exports: c.exports }));

  const resolved = resolveFocusedProvider(config, patcherModel, installed);
  if (!resolved) {
    return {
      ok: false, applied: false, attempts: 0, files: [], checks,
      message: "No provider resolved."
    };
  }

  events.emit("task:phase", "briefing");
  const tools = buildToolRegistry("patch");
  const result = await runFocusedAgentLoop({
    packet,
    leads,
    memory,
    tools,
    provider: resolved.provider,
    model: resolved.model,
    mode: "patch",
    config,
    root,
    db,
    events,
    projectRules,
    fileCards: cardBriefs,
  });

  for (const file of result.changedFiles) {
    recordEdit(db, taskId, file, "");
  }

  if (result.checksRun.length > 0) {
    const runResults = await runChecks(root, config.commands, ["typecheck", "test"]);
    checks.push(...runResults);
    for (const r of runResults) recordTestRun(db, taskId, r);
  }

  finishTask(db, taskId, result.ok);

  events.emit("task:answer", result.finalText);

  const m = result.metrics;
  const e = result.evidence;
  const statusMsg = result.status === "waiting_for_user"
    ? "Agent is waiting for your answer."
    : result.status === "completed"
      ? `Agent completed. Changed: ${result.changedFiles.length} (edited: ${e.filesEdited.length}, created: ${e.filesCreated.length}). Checks: ${result.checksRun.length}. Turns: ${m.modelTurns}, Tools: ${m.toolCallsRequested}.`
      : `Agent ${result.status}. Reason: ${result.stopReason}. Changed: ${result.changedFiles.length} (edited: ${e.filesEdited.length}, created: ${e.filesCreated.length}). Checks: ${result.checksRun.length}. Turns: ${m.modelTurns}, Tools: ${m.toolCallsRequested}.`;

  return {
    ok: result.ok,
    applied: result.changedFiles.length > 0,
    attempts: 1,
    answer: result.finalText,
    files: result.changedFiles,
    checks,
    message: statusMsg,
    changeSetId: result.questionId,
  };
}

export async function undoPatchFromDiff(
  deps: RunnerDeps,
  diff: string
): Promise<{ ok: boolean; files: string[]; message: string }> {
  const files = extractDiffFiles(diff);
  const reversed = await gitApply(deps.root, diff, false, true);
  if (!reversed.ok) {
    return { ok: false, files, message: `git apply --reverse failed: ${reversed.stderr}` };
  }
  await reindexAffected(deps.indexer, files);
  return { ok: true, files, message: `Reverted ${files.length} file(s).` };
}

// ── Helpers ───────────────────────────────────────────────────────

function shouldDistill(prompt: string): boolean {
  if (prompt.length < 20) return false;
  const lower = prompt.toLowerCase();
  const trivialPattern = /^(hi|hello|hey|thanks|ok|help|what is|who are|how are)\b/i;
  if (trivialPattern.test(lower)) return false;
  const codeWords = /(fix|implement|refactor|change|update|remove|add|debug|bug|error|broken|patch|diff|function|class|file|code|type|schema|build|test|deploy|explain|show|find|search|how|why|where)/i;
  if (!codeWords.test(lower) && prompt.length < 60) return false;
  return true;
}

async function buildTaskPacket(
  config: SmithConfig,
  task: string,
  model: string
): Promise<TaskPacket> {
  const heuristic = buildHeuristicTaskPacket(task);
  if (!shouldDistill(task)) return heuristic;

  const ollamaReady = await isProviderAvailable(config);
  if (!ollamaReady) return heuristic;

  try {
    const providers = createProviders(config);
    const resolved = resolveModelProvider(model, config.defaultProvider, providers);
    if (!resolved) return heuristic;

    const { distillTaskPacket } = await import("../context/taskDistiller.js");
    return distillTaskPacket({
      userPrompt: task,
      provider: resolved.provider,
      model: resolved.model,
      fallback: heuristic,
    });
  } catch {
    return heuristic;
  }
}

async function buildRetrievalLeads(
  deps: RunnerDeps,
  task: string,
  packet: TaskPacket
): Promise<RetrievalLead[]> {
  const { db, root, config } = deps;
  const classification = await classifyTask({ db, config, task });
  const retrieval = await retrieve({ db, root, config, task, classification });
  const result = await retrieveLeads({
    db,
    root,
    packet,
    scoredFiles: retrieval.files,
    maxLeads: config.context.maxLeads,
    maxEvidencePerLead: config.context.maxEvidencePerLead,
  });
  return result.leads;
}

function buildToolRegistry(mode: "ask" | "patch"): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerAll([searchTool, readTool, askUserTool, finishTool]);
  if (mode === "patch") {
    registry.registerAll([createFileTool, editTool, replaceLinesTool, checkTool]);
  }
  return registry;
}

function resolveFocusedProvider(
  config: SmithConfig,
  preferred: string,
  installed: string[]
) {
  const providers = createProviders(config);
  const resolved = resolveModelProvider(preferred, config.defaultProvider, providers);
  if (!resolved && installed.length > 0) {
    return resolveModelProvider(installed[0], config.defaultProvider, providers) ?? null;
  }
  return resolved;
}

function extractDiffFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const m = line.match(/^(?:\+\+\+|---)\s+[ab]\/(.+)$/);
    if (m) files.add(m[1]);
  }
  return [...files];
}

async function gitApply(
  root: string,
  diff: string,
  checkOnly: boolean,
  reverse = false
): Promise<{ ok: boolean; stderr: string }> {
  const tmp = path.join(os.tmpdir(), `agent-smith-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
  try {
    await fs.writeFile(tmp, diff.endsWith("\n") ? diff : diff + "\n", "utf8");
    const args = ["apply", "--whitespace=nowarn"];
    if (checkOnly) args.push("--check");
    if (reverse) args.push("--reverse");
    args.push(tmp);
    const result = await execa("git", args, { cwd: root, reject: false });
    return { ok: (result.exitCode ?? 1) === 0, stderr: result.stderr ?? "" };
  } catch (error) {
    return { ok: false, stderr: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
