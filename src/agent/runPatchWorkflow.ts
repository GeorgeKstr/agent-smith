import type { TaskPacket, TaskKind } from "../context/taskPacket.js";
import fs from "node:fs/promises";
import path from "node:path";
import type { RetrievalLead } from "../context/retrievalLead.js";
import type { WorkingMemory } from "./workingMemory.js";
import { createWorkingMemory } from "./workingMemory.js";
import { mergeWorkingMemory } from "./workingMemory.js";
import type { ToolRegistry } from "./tools/toolRegistry.js";
import type { Provider } from "../providers/providers.js";
import type { SmithConfig } from "../types/index.js";
import type { SmithDatabase } from "../db/db.js";
import type { RuntimeIntent } from "./runtimeIntent.js";
import type { AgentWorkflowPhase } from "./workflowPhase.js";
import { toolsForPhase } from "./phaseTools.js";
import {
  buildExplorationResult,
  renderExplorationForPlan,
  renderExplorationForApply,
  emptyExplorationResult,
} from "./artifacts/explorationResult.js";
import type { ExplorationResult } from "./artifacts/explorationResult.js";
import { buildPatchPlan, renderPatchPlanForApply, emptyPatchPlan } from "./artifacts/patchPlan.js";
import type { PatchPlan } from "./artifacts/patchPlan.js";
import { buildApplicationResult, emptyApplicationResult } from "./artifacts/patchApplicationResult.js";
import type { PatchApplicationResult } from "./artifacts/patchApplicationResult.js";
import {
  shouldExitExplore,
  shouldExitPlanPatch,
  shouldExitApplyPatch,
  shouldExitVerify,
  shouldExitExploreForTask,
} from "./phaseTransitions.js";
import { runFocusedAgentLoop } from "./focusedAgentLoop.js";
import type { FocusedAgentResult } from "./focusedAgentLoop.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import type { AgentRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import type { RunEvidence } from "./runEvidence.js";
import { createProviders, resolveModelProvider } from "../providers/providers.js";
import { suggestBackgroundPatch, extractColorFromPrompt, renderStyleSuggestionAsToolCall } from "./stylePatchSuggestion.js";

const EXPLORE_MAX_STEPS = 6;
const EXPLORE_MAX_STEPS_STYLE = 3;
const PLAN_MAX_STEPS = 4;
const APPLY_MAX_STEPS = 5;
const VERIFY_MAX_STEPS = 4;

const EXPLORE_MAX_SEARCHES = 3;
const EXPLORE_MAX_SEARCHES_STYLE = 2;
const EXPLORE_MAX_READS = 3;
const EXPLORE_MAX_READS_STYLE = 2;

const VERIFY_MAX_CHECK_ATTEMPTS = 3;

export type PatchWorkflowResult = {
  ok: boolean;
  status: "completed" | "partial" | "failed";
  finalText: string;
  changedFiles: string[];
  checksRun: string[];
  metrics: AgentRunMetrics;
  evidence: RunEvidence;
  memory: WorkingMemory;
  workflowPhase: AgentWorkflowPhase;
  exploration: ExplorationResult;
  patchPlan: PatchPlan;
  applicationResult: PatchApplicationResult;
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
  phaseModels?: Partial<Record<AgentWorkflowPhase, string>>;
  installedModels?: string[];
  skills?: string;
  taskKind?: TaskKind;
}): Promise<PatchWorkflowResult> {
  const {
    packet, leads, tools, provider, model, runtimeIntent, config, root, db,
    events, projectRules, fileCards, taskId,
  } = input;

  const changedFiles: string[] = [];
  const checksRun: string[] = [];
  const metrics = createEmptyRunMetrics();
  const overallEvidence = createEmptyRunEvidence();
  let memory = input.memory ?? createWorkingMemory(packet);

  const installed = input.installedModels ?? [];
  const providers = createProviders(config);

  function resolvePhaseModel(phase: AgentWorkflowPhase): { provider: Provider; model: string } {
    const phaseModel = input.phaseModels?.[phase];
    if (phaseModel) {
      const resolved = resolveModelProvider(phaseModel, config.defaultProvider, providers);
      if (resolved) return resolved;
    }
    return { provider, model };
  }

  const sharedInputBase = {
    packet, config, root, db, events, projectRules, fileCards, taskId,
    runtimeIntent, tools, mode: "patch" as const,
  };

  // ═══════════════════════════════════════════════════════════════════
  // Phase 1: EXPLORE
  // ═══════════════════════════════════════════════════════════════════
  events?.emit("task:phase", "explore");

  const exploreModel = resolvePhaseModel("explore");
  const isStyleTask = input.taskKind === "ui_style_patch";
  const exploreMaxSteps = isStyleTask ? EXPLORE_MAX_STEPS_STYLE : EXPLORE_MAX_STEPS;
  const exploreMaxSearches = isStyleTask ? EXPLORE_MAX_SEARCHES_STYLE : EXPLORE_MAX_SEARCHES;
  const exploreMaxReads = isStyleTask ? EXPLORE_MAX_READS_STYLE : EXPLORE_MAX_READS;

  const exploreResult = await runFocusedAgentLoop({
    ...sharedInputBase,
    provider: exploreModel.provider,
    model: exploreModel.model,
    leads,
    memory,
    phase: "explore",
    allowedToolsOverride: toolsForPhase("explore"),
    phaseGoal: `Find relevant files for: ${packet.goal}`,
    phaseExitCriteria: [
      "At least one relevant file inspected",
      `At most ${exploreMaxSearches} searches (style tasks: read CSS immediately)`,
      "Return an exploration summary with inspected files and likely edit targets",
    ],
    maxSteps: exploreMaxSteps,
    skipEditPressure: true,
    skipPatchPhasePolicy: true,
    phaseOnToolCall(toolName) {
      events?.emit("task:phase", `explore:${toolName}`);
    },
  });

  // Merge metrics and evidence
  mergeMetricsInto(metrics, exploreResult.metrics);
  mergeEvidenceInto(overallEvidence, exploreResult.evidence);
  memory = exploreResult.memory;

  const exploration = buildExplorationResult({
    filesRead: memory.filesRead,
    toolResults: overallEvidence.toolResults,
    remainingUnknowns: memory.remainingUnknowns,
  });

  // Check task-specific explore exit
  const taskExploreExit = shouldExitExploreForTask({
    taskKind: input.taskKind ?? "unknown",
    filesRead: overallEvidence.filesRead,
    totalSearches: exploreResult.metrics.searches,
    totalReads: exploreResult.metrics.reads,
  });

  const exploreTransition = shouldExitExplore({
    evidence: overallEvidence,
    maxSearches: exploreMaxSearches,
    maxReads: exploreMaxReads,
  });

  if (taskExploreExit.shouldExit) {
    exploration.enoughContext = true;
  }

  if (!exploration.enoughContext && exploreTransition.shouldExit) {
    return buildNoChangeResult({
      memory, exploration,
      finalText: `No relevant files found.\n${exploreTransition.reason}\nInspected: ${exploration.inspectedFiles.map(f => f.path).join(", ") || "none"}`,
      changedFiles, checksRun, metrics: exploreResult.metrics, evidence: overallEvidence,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Shortcut for UI/style tasks: skip plan, go straight to apply_style
  // ═══════════════════════════════════════════════════════════════════
  if (input.taskKind === "ui_style_patch") {
    events?.emit("task:phase", "apply_style_patch");

    const styleApplyContext = renderExplorationForApply({ exploration, plan: emptyPatchPlan(packet.goal) });

    const styleMemory = createWorkingMemory({ ...packet });
    const exploredReads = exploration.inspectedFiles.map((f) => ({
      path: f.path, ranges: f.ranges, summary: f.reason,
    }));
    const styleSeeded = mergeWorkingMemory(styleMemory, { filesRead: exploredReads });

    // Build deterministic CSS suggestion from explored stylesheets
    let styleSuggestion = "";
    const color = extractColorFromPrompt(packet.rawUserPrompt);
    const cssFile = exploredReads.find((f: { path: string }) =>
      /\.css$/i.test(f.path)
    );
    if (color && cssFile) {
      try {
        const cssContent = await fs.readFile(path.join(root, cssFile.path), "utf8");
        const suggestion = suggestBackgroundPatch({
          css: cssContent,
          desiredColor: color,
          path: cssFile.path,
        });
        if (suggestion) {
          styleSuggestion = `\n\nSuggested edit for ${cssFile.path}:\n${renderStyleSuggestionAsToolCall(suggestion)}`;
        }
      } catch {}
    }

    const applyStyleModel = resolvePhaseModel("apply_style_patch");
    const applyStyleResult = await runFocusedAgentLoop({
      ...sharedInputBase,
      provider: applyStyleModel.provider,
      model: applyStyleModel.model,
      leads: [],
      memory: styleSeeded,
      phase: "apply_style_patch",
      allowedToolsOverride: toolsForPhase("apply_style_patch"),
      phaseGoal: "Apply the visual/style change.",
      phaseExitCriteria: ["Edit applied or explained why no edit is needed"],
      maxSteps: 4,
      skipEditPressure: true,
      skipPatchPhasePolicy: true,
      phaseOnToolCall(toolName) { events?.emit("task:phase", `style:${toolName}`); },
      projectRules: [projectRules ?? "", styleApplyContext, styleSuggestion].filter(Boolean).join("\n\n"),
    });

    mergeMetricsInto(metrics, applyStyleResult.metrics);
    mergeEvidenceInto(overallEvidence, applyStyleResult.evidence);
    memory = applyStyleResult.memory;

    const styleAppResult = buildApplicationResult({
      filesEdited: overallEvidence.filesEdited,
      filesCreated: overallEvidence.filesCreated,
      toolResults: overallEvidence.toolResults,
    });

    for (const f of styleAppResult.filesEdited) changedFiles.push(f);
    for (const f of styleAppResult.filesCreated) changedFiles.push(f);

    if (styleAppResult.changed) {
      // Verify
      events?.emit("task:phase", "verify");
      const verifyModel = resolvePhaseModel("verify");
      const verifyMemory = createWorkingMemory({ ...packet, goal: "Run checks if configured." });
      const verifyResult = await runFocusedAgentLoop({
        ...sharedInputBase,
        provider: verifyModel.provider, model: verifyModel.model,
        leads: [], memory: verifyMemory,
        phase: "verify",
        allowedToolsOverride: toolsForPhase("verify"),
        phaseGoal: "Run checks on changed files.",
        phaseExitCriteria: ["At most 2 check attempts"],
        maxSteps: 3,
        skipEditPressure: true, skipPatchPhasePolicy: true,
        phaseOnToolCall(toolName) { events?.emit("task:phase", `verify:${toolName}`); },
      });
      mergeMetricsInto(metrics, verifyResult.metrics);
      mergeEvidenceInto(overallEvidence, verifyResult.evidence);
      for (const c of overallEvidence.checksRun) checksRun.push(c.name || "check");
    }

    events?.emit("task:phase", "finalize");
    const uniqueChanged = [...new Set(changedFiles)];
    const uniqueChecks = [...new Set(checksRun)];
    const finalText = [
      `Changed files: ${uniqueChanged.length > 0 ? uniqueChanged.join(", ") : "none"}`,
      `Checks run: ${uniqueChecks.length > 0 ? uniqueChecks.join(", ") : "none (CSS-only change)"}`,
      styleAppResult.failedEdits.length > 0
        ? `Failed edits: ${styleAppResult.failedEdits.map((e) => e.path).join(", ")}`
        : "",
    ].filter(Boolean).join("\n");

    return {
      ok: styleAppResult.changed,
      status: styleAppResult.changed ? "completed" as const : "failed" as const,
      finalText,
      changedFiles: uniqueChanged, checksRun: uniqueChecks,
      metrics, evidence: overallEvidence, memory,
      workflowPhase: "finalize",
      exploration,
      patchPlan: emptyPatchPlan(packet.goal),
      applicationResult: styleAppResult,
    };
  }

  events?.emit("task:phase", "plan_patch");

  // ═══════════════════════════════════════════════════════════════════
  // Phase 2: PLAN PATCH
  // ═══════════════════════════════════════════════════════════════════

  const explorationContext = renderExplorationForPlan({ exploration, packetGoal: packet.goal });

  const planMemory = createWorkingMemory({
    ...packet,
    goal: `Create a patch plan: ${packet.goal}`,
  });

  const planModel = resolvePhaseModel("plan_patch");

  const planResult = await runFocusedAgentLoop({
    ...sharedInputBase,
    provider: planModel.provider,
    model: planModel.model,
    leads: [],
    memory: planMemory,
    phase: "plan_patch",
    allowedToolsOverride: toolsForPhase("plan_patch"),
    phaseGoal: "Create a concrete edit plan based on the exploration results.",
    phaseExitCriteria: [
      "At least one specific edit proposed",
      "Or explain why no edit is needed",
    ],
    maxSteps: PLAN_MAX_STEPS,
    skipEditPressure: true,
    skipPatchPhasePolicy: true,
    phaseOnToolCall(toolName) {
      events?.emit("task:phase", `plan:${toolName}`);
    },
    fileCards: [],
    projectRules: [
      projectRules ?? "",
      explorationContext,
    ].filter(Boolean).join("\n\n"),
  });

  mergeMetricsInto(metrics, planResult.metrics);
  mergeEvidenceInto(overallEvidence, planResult.evidence);

  const patchPlan = buildPatchPlan({
    goal: packet.goal,
    planText: planResult.finalText,
  });

  const planTransition = shouldExitPlanPatch(patchPlan);
  if (!planTransition.shouldExit || patchPlan.edits.length === 0) {
    const noEditText = planResult.finalText || "Patch plan has no edits.";
    return buildNoChangeResult({
      memory: mergeWorkingMemory(memory, { currentHypothesis: "No edits needed per patch plan." }),
      exploration, finalText: noEditText,
      changedFiles, checksRun, metrics, evidence: overallEvidence,
    });
  }

  events?.emit("task:phase", "apply_patch");

  // ═══════════════════════════════════════════════════════════════════
  // Phase 3: APPLY PATCH
  // ═══════════════════════════════════════════════════════════════════

  const applyContext = [
    renderExplorationForApply({ exploration, plan: patchPlan }),
    renderPatchPlanForApply(patchPlan),
  ].join("\n\n");

  const applyMemory = createWorkingMemory({
    ...packet,
    goal: `Apply the patch plan: ${packet.goal}`,
  });

  // Pre-populate memory with file read info from exploration so edit tool's
  // read-before-edit check passes.
  const exploredReads = exploration.inspectedFiles.map((f) => ({
    path: f.path,
    ranges: f.ranges,
    summary: f.reason,
  }));

  const seededMemory = mergeWorkingMemory(applyMemory, {
    filesRead: exploredReads,
    editPlan: patchPlan.edits.map((e) => `${e.path}: ${e.change}`),
  });

  const applyModel = resolvePhaseModel("apply_patch");

  const applyResult = await runFocusedAgentLoop({
    ...sharedInputBase,
    provider: applyModel.provider,
    model: applyModel.model,
    leads: [],
    memory: seededMemory,
    phase: "apply_patch",
    allowedToolsOverride: toolsForPhase("apply_patch"),
    phaseGoal: "Apply the patch plan edits.",
    phaseExitCriteria: [
      "All planned edits applied (or failed)",
      "Return summary of changed files",
    ],
    maxSteps: APPLY_MAX_STEPS,
    skipEditPressure: true,
    skipPatchPhasePolicy: true,
    phaseOnToolCall(toolName) {
      events?.emit("task:phase", `apply:${toolName}`);
    },
    projectRules: [
      projectRules ?? "",
      applyContext,
    ].filter(Boolean).join("\n\n"),
  });

  mergeMetricsInto(metrics, applyResult.metrics);
  mergeEvidenceInto(overallEvidence, applyResult.evidence);
  memory = applyResult.memory;

  const applicationResult = buildApplicationResult({
    filesEdited: overallEvidence.filesEdited,
    filesCreated: overallEvidence.filesCreated,
    toolResults: overallEvidence.toolResults,
  });

  for (const f of applicationResult.filesEdited) changedFiles.push(f);
  for (const f of applicationResult.filesCreated) changedFiles.push(f);

  if (!applicationResult.changed) {
    return buildNoChangeResult({
      memory, exploration, finalText: "No edits were applied.\n\nFailed edits:\n" + applicationResult.failedEdits.map(e => `- ${e.path}: ${e.reason}`).join("\n"),
      changedFiles, checksRun, metrics, evidence: overallEvidence,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 4: VERIFY
  // ═══════════════════════════════════════════════════════════════════
  events?.emit("task:phase", "verify");

  const verifyMemory = createWorkingMemory({
    ...packet,
    goal: `Verify the applied patch and run checks.`,
  });

  const verifyModel = resolvePhaseModel("verify");

  const verifyResult = await runFocusedAgentLoop({
    ...sharedInputBase,
    provider: verifyModel.provider,
    model: verifyModel.model,
    leads: [],
    memory: verifyMemory,
    phase: "verify",
    allowedToolsOverride: toolsForPhase("verify"),
    phaseGoal: "Run checks on changed files. Repair if checks fail.",
    phaseExitCriteria: [
      "At least one check passed",
      `Run at most ${VERIFY_MAX_CHECK_ATTEMPTS} checks`,
    ],
    maxSteps: VERIFY_MAX_STEPS,
    skipEditPressure: true,
    skipPatchPhasePolicy: true,
    phaseOnToolCall(toolName) {
      events?.emit("task:phase", `verify:${toolName}`);
    },
  });

  mergeMetricsInto(metrics, verifyResult.metrics);
  mergeEvidenceInto(overallEvidence, verifyResult.evidence);
  memory = mergeWorkingMemory(memory, { checkResults: verifyResult.memory.checkResults });

  for (const c of overallEvidence.checksRun) {
    checksRun.push(c.name || "check");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 5: FINALIZE
  // ═══════════════════════════════════════════════════════════════════
  events?.emit("task:phase", "finalize");

  const uniqueChanged = [...new Set(changedFiles)];
  const uniqueChecks = [...new Set(checksRun)];

  const finalText = [
    `Changed files: ${uniqueChanged.length > 0 ? uniqueChanged.join(", ") : "none"}`,
    `Checks run: ${uniqueChecks.length > 0 ? uniqueChecks.join(", ") : "none"}`,
    applicationResult.failedEdits.length > 0
      ? `Failed edits: ${applicationResult.failedEdits.map((e) => e.path).join(", ")}`
      : "",
    verifyResult.finalText ? `\n${verifyResult.finalText}` : "",
  ].filter(Boolean).join("\n");

  return {
    ok: true,
    status: "completed",
    finalText,
    changedFiles: uniqueChanged,
    checksRun: uniqueChecks,
    metrics,
    evidence: overallEvidence,
    memory,
    workflowPhase: "finalize",
    exploration,
    patchPlan,
    applicationResult,
  };
}

function mergeMetricsInto(target: AgentRunMetrics, source: AgentRunMetrics): void {
  target.modelTurns += source.modelTurns;
  target.toolCallsRequested += source.toolCallsRequested;
  target.toolCallsSucceeded += source.toolCallsSucceeded;
  target.toolCallsFailed += source.toolCallsFailed;
  target.searches += source.searches;
  target.reads += source.reads;
  target.edits += source.edits;
  target.replaceLineEdits += source.replaceLineEdits;
  target.checks += source.checks;
  target.askUserCalls += source.askUserCalls;
  target.finalCalls += source.finalCalls;
  target.invalidOutputs += source.invalidOutputs;
  target.tokensEstimatedIn += source.tokensEstimatedIn;
  target.tokensEstimatedOut += source.tokensEstimatedOut;
  target.progressPolicyRejections += source.progressPolicyRejections;
  target.tagNormalizations += source.tagNormalizations;
  target.patchPhasePolicyRejections += source.patchPhasePolicyRejections;
  target.totalSearches += source.totalSearches;
  target.searchesAfterFirstRead += source.searchesAfterFirstRead;
  target.broadSearchRejections += source.broadSearchRejections;
  target.postReadSearchRejections += source.postReadSearchRejections;
  target.editPressureRejections += source.editPressureRejections;
  target.proposeEditCalls += source.proposeEditCalls;
  target.proposeEditAccepted += source.proposeEditAccepted;
  target.proposeEditRejected += source.proposeEditRejected;
}

function mergeEvidenceInto(target: RunEvidence, source: RunEvidence): void {
  for (const f of source.filesRead) {
    if (!target.filesRead.includes(f)) target.filesRead.push(f);
  }
  for (const f of source.filesEdited) {
    if (!target.filesEdited.includes(f)) target.filesEdited.push(f);
  }
  for (const f of source.filesCreated) {
    if (!target.filesCreated.includes(f)) target.filesCreated.push(f);
  }
  for (const c of source.checksRun) {
    target.checksRun.push(c);
  }
  for (const r of source.toolResults) {
    target.toolResults.push(r);
  }
}

function buildNoChangeResult(input: {
  memory: WorkingMemory;
  exploration: ExplorationResult;
  finalText: string;
  changedFiles: string[];
  checksRun: string[];
  metrics: AgentRunMetrics;
  evidence: RunEvidence;
}): PatchWorkflowResult {
  return {
    ok: false,
    status: "failed",
    finalText: input.finalText,
    changedFiles: input.changedFiles,
    checksRun: input.checksRun,
    metrics: input.metrics,
    evidence: input.evidence,
    memory: input.memory,
    workflowPhase: "finalize",
    exploration: input.exploration,
    patchPlan: emptyPatchPlan(input.memory.goal),
    applicationResult: emptyApplicationResult(),
  };
}
