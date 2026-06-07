import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { SmithConfig, PatchOutcome, ContextPacket, CheckResult, TaskClassification, PromptPlan } from "../types/index.js";
import type { SmithDatabase } from "./db.js";
import type { Indexer } from "./indexer.js";
import { extractJson } from "./ollama.js";
import { generateWithProvider, isProviderAvailable, listProviderModels, resolveProviderModelName } from "./providers.js";
import { classifyTask, retrieve } from "./retriever.js";
import { packContext } from "./contextPacker.js";
import { validateUnifiedDiff, stripFences, extractDiffFiles, countChangedLines } from "./patch.js";
import { checkPatchSafety } from "./safety.js";
import { runChecks } from "./checks.js";
import { reindexAffected } from "./reindexer.js";
import { createTask, recordEdit, recordTestRun, finishTask } from "./memory.js";
import { evaluatePrompt } from "./intent.js";
import { runQwenFunctionLoop } from "./qwenTools.js";
import { createLocalProjectTools } from "./localProjectTools.js";

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

/** Classify -> retrieve -> pack -> (optionally) answer with the local model. */
export async function runAsk(
  deps: RunnerDeps,
  task: string,
  options: { modelOverride?: string; signal?: AbortSignal } = {}
): Promise<AskResult> {
  const { db, root, config, events } = deps;
  const ollamaReady = await isProviderAvailable(config);
  const installed = ollamaReady ? await listProviderModels(config) : [];
  const answerModel = options.modelOverride
    ? await resolveProviderModelName(config, options.modelOverride, installed)
    : await resolveProviderModelName(config, config.models.patcher, installed);

  events.emit("task:phase", "triaging");
  const plan = await evaluatePrompt({
    config,
    prompt: task,
    ollamaReady,
    model: answerModel
  });
  const emptyPacket: ContextPacket = {
    task,
    prompt: task,
    estimatedTokens: 0,
    files: [],
    symbols: []
  };
  const intent = plan.intent;
  events.emit("task:intent", intent);

  if (intent.kind !== "task") {
    if (!ollamaReady) {
      events.emit("task:context", emptyPacket)
      return {
        ok: true,
        answer: "",
        packet: emptyPacket,
        message: `Intent=${intent.kind} (${intent.reason}). No provider available — no chat/meta reply generated.`
      };
    }

    events.emit("task:phase", "thinking");
    const chat = await generateWithProvider(
      config,
      answerModel,
      task,
      {
        system: "You are Smith. For chat/meta prompts, respond concisely and helpfully. Do not propose patches or diffs unless asked.",
        maxTokens: 400,
        signal: options.signal,
        onToken: (_, text) => { events.emit("task:stream", { text }); }
      }
    );
    const answer = await finalizeAnswer({
      signal: options.signal,
      config,
      model: answerModel,
      basePrompt: task,
      raw: chat.text,
      fallback: "I can help with that. Ask me about your project, architecture, or a coding task."
    });

    events.emit("task:context", emptyPacket)
    events.emit("task:answer", answer)
    return {
      ok: chat.ok,
      answer,
      packet: emptyPacket,
      message: `Intent=${intent.kind} (${intent.reason})${chat.error ? ` | ${chat.error}` : ""}`
    };
  }

  const toolNotes = [
    ...runPlanningTools(db, plan),
    ...(await runQwenPlanningTools(deps, task, plan, answerModel))
  ];
  const effectiveTask = composeEffectiveTask(task, plan, toolNotes);

  events.emit("task:phase", "classifying");

  const baseClassification = await classifyTask({ db, config, task: effectiveTask });
  let classification = mergeClassification(baseClassification, plan);
  if (isTechnicalPromptPlan(effectiveTask, plan)) {
    classification = enrichClassificationWithImportantFiles(db, classification, effectiveTask, plan);
  }
  events.emit("task:phase", "retrieving");
  const { files, seedSymbols } = await retrieve({ db, root, config, task: effectiveTask, classification });

  events.emit("task:phase", "packing");
  const packet = await packContext({
    db,
    root,
    config,
    task: effectiveTask,
    mode: "ask",
    classification,
    files,
    seedSymbols
  });
  events.emit("task:context", packet);

  if (!ollamaReady) {
    return {
      ok: true,
      answer: "",
      packet,
      message: "No provider available — context packet built but no answer generated."
    };
  }

  events.emit("task:phase", "thinking");
  const result = await generateWithProvider(
    config,
    answerModel,
    packet.prompt,
    {
      signal: options.signal,
      onToken: (_, text) => { events.emit("task:stream", { text }); }
    }
  );
  const answer = await finalizeAnswer({
    signal: options.signal,
    config,
    model: answerModel,
    basePrompt: packet.prompt,
    raw: result.text,
    fallback: buildAskFallback(task, packet)
  });
  events.emit("task:answer", answer);

  return { ok: result.ok, answer, packet, message: result.error };
}

/**
 * Full patch loop:
 * classify -> retrieve -> pack -> generate diff -> validate -> safety ->
 * git apply --check -> apply -> reindex -> checks -> repair (max retries).
 */
export async function runPatch(
  deps: RunnerDeps,
  task: string,
  options: { apply: boolean; modelOverride?: string; signal?: AbortSignal } = { apply: true }
): Promise<PatchOutcome> {
  const { db, root, config, events } = deps;
  const checks: CheckResult[] = [];

  const ollamaReady = await isProviderAvailable(config);
  if (!ollamaReady) {
    events.emit("task:context", { task, prompt: task, estimatedTokens: 0, files: [], symbols: [] });
    return {
      ok: false,
      applied: false,
      attempts: 0,
      files: [],
      checks,
      message: "No AI provider available — cannot generate a patch."
    };
  }

  const taskId = createTask(db, task, config.models.patcher);
  const maxAttempts = 3;
  const installed = await listProviderModels(config);
  const patcherModel = options.modelOverride
    ? await resolveProviderModelName(config, options.modelOverride, installed)
    : await resolveProviderModelName(config, config.models.patcher, installed);
  const debuggerModel = options.modelOverride
    ? await resolveProviderModelName(config, options.modelOverride, installed)
    : await resolveProviderModelName(config, config.models.debugger || config.models.patcher, installed);

  events.emit("task:phase", "triaging");
  const plan = await evaluatePrompt({
    config,
    prompt: task,
    ollamaReady,
    model: patcherModel
  });
  const intent = plan.intent;
  events.emit("task:intent", intent);
  if (intent.kind !== "task") {
    events.emit("task:context", { task, prompt: task, estimatedTokens: 0, files: [], symbols: [] });
    const chat = await generateWithProvider(
      config,
      patcherModel,
      task,
      {
        system: "You are Smith. User is in build mode but prompt is non-task. Reply helpfully and ask a concise follow-up if needed.",
        maxTokens: 320,
        signal: options.signal,
        onToken: (_, text) => { events.emit("task:stream", { text }); }
      }
    );
    const answer = await finalizeAnswer({
      signal: options.signal,
      config,
      model: patcherModel,
      basePrompt: task,
      raw: chat.text,
      fallback: "This looks non-build. Tell me what code/task you want changed and I can switch into build flow."
    });
    events.emit("task:answer", answer);
    return {
      ok: chat.ok,
      applied: false,
      attempts: 0,
      answer,
      files: [],
      checks,
      message: `Prompt categorized as ${intent.kind} (${intent.reason}). Returned a direct response instead of patch generation.`
    };
  }

  const toolNotes = [
    ...runPlanningTools(db, plan),
    ...(await runQwenPlanningTools(deps, task, plan, patcherModel))
  ];
  const effectiveTask = composeEffectiveTask(task, plan, toolNotes);

  events.emit("task:phase", "classifying");
  const baseClassification = await classifyTask({ db, config, task: effectiveTask });
  let classification = mergeClassification(baseClassification, plan);
  if (isTechnicalPromptPlan(effectiveTask, plan)) {
    classification = enrichClassificationWithImportantFiles(db, classification, effectiveTask, plan);
  }
  events.emit("task:phase", "retrieving");
  const retrieval = await retrieve({ db, root, config, task: effectiveTask, classification });

  events.emit("task:phase", "packing");
  const packet = await packContext({
    db,
    root,
    config,
    task: effectiveTask,
    mode: "patch",
    classification,
    files: retrieval.files,
    seedSymbols: retrieval.seedSymbols
  });
  events.emit("task:context", packet);

  let prompt = packet.prompt;
  let lastError = "";
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    events.emit("task:phase", attempt === 1 ? "patching" : `repairing (${attempt - 1})`);

    const generation = await generateWithProvider(
      config,
      attempt === 1 ? patcherModel : debuggerModel,
      prompt,
      {
        signal: options.signal,
        onToken: (_, text) => { events.emit("task:stream", { text }); }
      }
    );

    if (!generation.ok) {
      lastError = generation.error ?? "generation failed";
      continue;
    }

    const diff = stripFences(generation.text).trim();
    events.emit("task:patch", diff);

    // 1. Format validation.
    const validation = validateUnifiedDiff(diff);
    if (!validation.ok) {
      lastError = `invalid diff: ${validation.errors.join("; ")}`;
      prompt = repairPrompt(packet.prompt, diff, lastError);
      continue;
    }

    const files = extractDiffFiles(diff);
    const changedLines = countChangedLines(diff);

    // 2. Safety.
    const safety = checkPatchSafety({ root, config, files, changedLines });
    if (!safety.ok) {
      lastError = `safety: ${safety.violations.join("; ")}`;
      finishTask(db, taskId, false);
      return { ok: false, applied: false, attempts, diff, files, checks, message: lastError };
    }

    // 3. git apply --check
    const checkApply = await gitApply(root, diff, true);
    if (!checkApply.ok) {
      lastError = `git apply --check failed: ${checkApply.stderr}`;
      prompt = repairPrompt(packet.prompt, diff, lastError);
      continue;
    }

    if (!options.apply) {
      finishTask(db, taskId, true);
      return {
        ok: true,
        applied: false,
        attempts,
        diff,
        files,
        checks,
        message: "Patch validated (dry run, not applied)."
      };
    }

    // 4. Apply.
    const applied = await gitApply(root, diff, false);
    if (!applied.ok) {
      lastError = `git apply failed: ${applied.stderr}`;
      prompt = repairPrompt(packet.prompt, diff, lastError);
      continue;
    }
    events.emit("task:phase", "reindexing");
    for (const file of files) recordEdit(db, taskId, file, diff);
    await reindexAffected(deps.indexer, files);

    // 5. Checks.
    events.emit("task:phase", "checking");
    const runResults = await runChecks(root, config.commands, ["typecheck", "test"]);
    checks.push(...runResults);
    for (const r of runResults) recordTestRun(db, taskId, r);

    const failed = runResults.filter((r) => !r.ok);
    if (failed.length === 0) {
      finishTask(db, taskId, true);
      return {
        ok: true,
        applied: true,
        attempts,
        diff,
        files,
        checks,
        message: `Patch applied to ${files.length} file(s); checks passed.`
      };
    }

    // Checks failed: revert and feed failure into a repair attempt.
    await gitApply(root, diff, false, true);
    await reindexAffected(deps.indexer, files);
    lastError = failed.map((f) => `${f.name} failed:\n${f.stderr || f.stdout}`).join("\n\n");
    prompt = repairPrompt(packet.prompt, diff, lastError);
  }

  finishTask(db, taskId, false);
  return {
    ok: false,
    applied: false,
    attempts,
    files: [],
    checks,
    message: `Failed after ${attempts} attempt(s). Last error: ${truncate(lastError, 400)}`
  };
}

function repairPrompt(basePrompt: string, previousDiff: string, error: string): string {
  return `${basePrompt}

## PREVIOUS ATTEMPT (rejected)
${truncate(previousDiff, 2000)}

## FAILURE
${truncate(error, 1500)}

## INSTRUCTION
Produce a corrected unified diff that fixes the failure above. Return ONLY the diff.`;
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

type FinalizeAnswerArgs = {
  config: SmithConfig;
  model: string;
  basePrompt: string;
  raw: string;
  fallback: string;
  signal?: AbortSignal;
};

async function finalizeAnswer(args: FinalizeAnswerArgs): Promise<string> {
  const first = normalizeAnswer(args.raw);
  if (first) return first;

  const structured = summarizeStructuredPayload(args.raw);
  if (structured) return structured;

  // Retry once with an explicit anti-wrapper instruction.
  const retry = await generateWithProvider(
    args.config,
    args.model,
    `${args.basePrompt}\n\nPrevious output was unusable. Provide a direct final answer in plain text now.`,
    {
      system: "Return plain text only. Never return JSON wrappers, code fences, or placeholder expressions like obj['output'].",
      maxTokens: 350,
      signal: args.signal,
    }
  );
  const second = normalizeAnswer(retry.text);
  if (second) return second;

  const retryStructured = summarizeStructuredPayload(retry.text);
  return retryStructured || args.fallback;
}

function normalizeAnswer(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  // Try structured wrappers first.
  const parsed = extractJson<unknown>(trimmed);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>;
    for (const key of ["answer", "response", "output", "final", "text", "message", "content", "result"]) {
      const value = rec[key];
      if (typeof value === "string" && value.trim()) {
        const candidate = value.trim();
        if (!isPlaceholderJunk(candidate)) return candidate;
      }
    }

    // Model sometimes returns planning JSON (intent/tasks/toolRequests/etc).
    // If no explicit answer-like field exists, force a plain-text retry.
    if (looksLikeJsonEnvelope(trimmed)) return "";
  }

  const unfenced = stripFences(trimmed).trim();
  if (looksLikeJsonEnvelope(unfenced)) return "";
  if (!unfenced || isPlaceholderJunk(unfenced)) return "";
  return unfenced;
}

function looksLikeJsonEnvelope(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const jsonish = (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
  if (!jsonish) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function summarizeStructuredPayload(raw: string): string {
  const parsed = extractJson<unknown>((raw ?? "").trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const rec = parsed as Record<string, unknown>;

  const objective = typeof rec.objective === "string" ? rec.objective.trim() : "";
  const tasks = Array.isArray(rec.tasks)
    ? rec.tasks.map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
    : [];
  const likelyFiles = Array.isArray(rec.likelyFiles)
    ? rec.likelyFiles.map((f) => String(f).trim()).filter(Boolean).slice(0, 6)
    : [];
  const likelySymbols = Array.isArray(rec.likelySymbols)
    ? rec.likelySymbols.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
    : [];

  if (!objective && tasks.length === 0 && likelyFiles.length === 0 && likelySymbols.length === 0) return "";

  const lines: string[] = [];
  lines.push("I got a structured planner payload instead of a direct answer. Here is the useful part:");
  if (objective) lines.push(`Objective: ${objective}`);
  if (tasks.length) lines.push(`Steps: ${tasks.join(" | ")}`);
  if (likelyFiles.length) lines.push(`Likely files: ${likelyFiles.join(", ")}`);
  if (likelySymbols.length) lines.push(`Likely symbols: ${likelySymbols.join(", ")}`);
  return lines.join("\n");
}

function buildAskFallback(task: string, packet: ContextPacket): string {
  const files = packet.files.slice(0, 6).map((f) => f.path);
  const symbols = packet.symbols.slice(0, 6).map((s) => `${s.name} (${s.path})`);

  const lines: string[] = [];
  lines.push("Model output was unusable, but retrieval/context succeeded.");
  lines.push(`Task: ${task}`);
  if (files.length) lines.push(`Most relevant files: ${files.join(", ")}`);
  if (symbols.length) lines.push(`Relevant symbols: ${symbols.join(" | ")}`);
  lines.push("Run the same prompt again, or ask a narrower question against one of the files above.");
  return lines.join("\n");
}

function isPlaceholderJunk(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^obj\[['"]output['"]\]$/i.test(t)) return true;
  if (/^output$/i.test(t)) return true;
  if (/^\{\s*"?(output|response|answer)"?\s*:\s*null\s*\}$/i.test(t)) return true;
  return false;
}

function mergeClassification(base: TaskClassification, plan: PromptPlan): TaskClassification {
  const uniq = (values: string[], max: number) => [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, max);
  return {
    ...base,
    keywords: uniq([...plan.keywords, ...base.keywords], 14),
    likelyFiles: uniq([...plan.likelyFiles, ...base.likelyFiles], 10),
    likelySymbols: uniq([...plan.likelySymbols, ...base.likelySymbols], 10)
  };
}

function isTechnicalPromptPlan(task: string, plan: PromptPlan): boolean {
  if (plan.intent.kind !== "task") return false;
  const text = `${task}\n${plan.objective}\n${plan.tasks.join(" ")}\n${plan.keywords.join(" ")}`.toLowerCase();
  return /(code|function|class|module|file|symbol|bug|error|fix|refactor|implement|patch|test|type|schema|api|query|database|build|compile|debug|architecture|design|performance|optimi[sz]e)/i.test(
    text
  );
}

function enrichClassificationWithImportantFiles(
  db: SmithDatabase,
  classification: TaskClassification,
  task: string,
  plan: PromptPlan
): TaskClassification {
  const important = importantFileHints(db, task, plan);
  if (important.length === 0) return classification;
  return {
    ...classification,
    likelyFiles: [...new Set([...important, ...classification.likelyFiles])].slice(0, 12)
  };
}

function importantFileHints(db: SmithDatabase, task: string, plan: PromptPlan): string[] {
  const hints: string[] = [];

  const weighted = db
    .prepare(
      `SELECT
         f.path AS path,
         (CASE WHEN f.path LIKE 'src/%' THEN 4 ELSE 0 END) +
         IFNULL(inb.c,0) * 3 +
         IFNULL(outb.c,0) +
         IFNULL(sym.c,0) * 0.5 AS score
       FROM files f
       LEFT JOIN (SELECT to_file_id AS fid, COUNT(*) AS c FROM imports GROUP BY to_file_id) inb ON inb.fid = f.id
       LEFT JOIN (SELECT from_file_id AS fid, COUNT(*) AS c FROM imports GROUP BY from_file_id) outb ON outb.fid = f.id
       LEFT JOIN (SELECT file_id AS fid, COUNT(*) AS c FROM symbols GROUP BY file_id) sym ON sym.fid = f.id
       WHERE f.path NOT LIKE '.agent/%'
       ORDER BY score DESC, f.path
       LIMIT 8`
    )
    .all() as Array<{ path: string; score: number }>;
  for (const row of weighted) {
    if (row.path) hints.push(row.path);
  }

  const text = `${task}\n${plan.objective}\n${plan.tasks.join(" ")}\n${plan.keywords.join(" ")}`.toLowerCase();

  if (/(architect|design|system|overview|plan|structure|flow)/.test(text)) {
    hints.push(
      ...existingPaths(db, [
        "README.md",
        "docs/00-product-vision.md",
        "docs/01-architecture.md",
        "docs/04-implementation-plan.md"
      ])
    );
  }

  if (/(model|mode|history|state|sync|ui|web|cli|server|lan|prompt|chat)/.test(text)) {
    hints.push(...existingPaths(db, ["src/core/lanServer.ts", "src/tui/App.tsx", "src/core/taskRunner.ts", "src/cli.ts"]));
  }

  return [...new Set(hints)].slice(0, 12);
}

function existingPaths(db: SmithDatabase, paths: string[]): string[] {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT path FROM files WHERE path IN (${placeholders})`)
    .all(...unique) as Array<{ path: string }>;
  return rows.map((r) => r.path);
}

function composeEffectiveTask(original: string, plan: PromptPlan, toolNotes: string[]): string {
  const checklist = plan.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const notes = toolNotes.length ? `\n## TOOL RESULTS\n${toolNotes.join("\n")}` : "";
  return `${original}\n\n## OBJECTIVE\n${plan.objective}\n\n## EXECUTION CHECKLIST\n${checklist}${notes}`;
}


async function runQwenPlanningTools(
  deps: RunnerDeps,
  originalTask: string,
  plan: PromptPlan,
  model: string
): Promise<string[]> {
  const { config, db, root, events } = deps;
  const tools = createLocalProjectTools({ root, db });

  events.emit("task:phase", "tooling");

  const planSummary = {
    objective: plan.objective,
    tasks: plan.tasks,
    keywords: plan.keywords,
    likelyFiles: plan.likelyFiles,
    likelySymbols: plan.likelySymbols,
    toolRequests: plan.toolRequests
  };

  const result = await runQwenFunctionLoop({
    config,
    modelSpec: model,
    think: false,
    maxToolRounds: 3,
    tools,
    messages: [
      {
        role: "system",
        content:
          "You are the navigation layer of a local coding agent. Use tools only when they help identify relevant project files, symbols, or nearby imports. Do not generate patches. After using tools, return concise plain-text notes with: relevant files, relevant symbols, and why they matter. If the initial plan is enough, answer without tool calls."
      },
      {
        role: "user",
        content: `USER TASK:
${originalTask}

INITIAL PLAN JSON:
${JSON.stringify(planSummary, null, 2)}

Inspect the project only as needed, then return navigation notes for the main agent.`
      }
    ],
    onToolCall: (call) => events.emit("task:phase", `tool:${call.name}`)
  });

  if (!result.ok) {
    return result.error ? [`[qwen_tools:error] ${truncate(result.error, 400)}`] : [];
  }

  const notes: string[] = [];
  const used = result.messages
    .filter((message) => message.role === "function" && message.name)
    .map((message) => message.name as string);

  if (used.length > 0) {
    notes.push(`[qwen_tools] used ${result.toolCallCount} call(s): ${[...new Set(used)].join(", ")}`);
  }

  const finalText = result.finalText.trim();
  if (finalText) {
    notes.push(`[qwen_navigation_notes]
${truncate(finalText, 1800)}`);
  }

  return notes;
}

function runPlanningTools(db: SmithDatabase, plan: PromptPlan): string[] {
  const notes: string[] = [];
  for (const request of plan.toolRequests.slice(0, 4)) {
    if (request.tool === "find_files") {
      const rows = db
        .prepare("SELECT path FROM files WHERE path LIKE ? ORDER BY path LIMIT 6")
        .all(`%${request.query}%`) as Array<{ path: string }>;
      notes.push(
        `[find_files:${request.query}] ${rows.length ? rows.map((r) => r.path).join(", ") : "no matches"}`
      );
    } else if (request.tool === "find_symbols") {
      const rows = db
        .prepare(
          "SELECT s.name, f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name LIKE ? ORDER BY s.name LIMIT 8"
        )
        .all(`%${request.query}%`) as Array<{ name: string; path: string }>;
      notes.push(
        `[find_symbols:${request.query}] ${rows.length ? rows.map((r) => `${r.name}@${r.path}`).join(", ") : "no matches"}`
      );
    }
  }
  return notes;
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
