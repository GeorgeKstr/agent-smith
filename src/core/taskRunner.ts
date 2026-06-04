import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { SmithConfig, PatchOutcome, ContextPacket, CheckResult } from "../types/index.js";
import type { SmithDatabase } from "./db.js";
import type { Indexer } from "./indexer.js";
import { isOllamaAvailable, listOllamaModels, resolveModelName, generateWithOllama, optionsFromConfig } from "./ollama.js";
import { classifyTask, retrieve } from "./retriever.js";
import { packContext } from "./contextPacker.js";
import { validateUnifiedDiff, stripFences, extractDiffFiles, countChangedLines } from "./patch.js";
import { checkPatchSafety } from "./safety.js";
import { runChecks } from "./checks.js";
import { reindexAffected } from "./reindexer.js";
import { createTask, recordEdit, recordTestRun, finishTask } from "./memory.js";

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
export async function runAsk(deps: RunnerDeps, task: string): Promise<AskResult> {
  const { db, root, config, events } = deps;
  const ollamaReady = await isOllamaAvailable(config.ollama.baseUrl);
  const installed = ollamaReady ? await listOllamaModels(config.ollama.baseUrl) : [];
  const answerModel = resolveModelName(config.models.patcher, installed);
  const classifierModel = resolveModelName(config.models.tagger, installed);
  events.emit("task:phase", "classifying");

  const classification = await classifyTask({ config, task, ollamaReady, model: classifierModel });
  events.emit("task:phase", "retrieving");
  const { files, seedSymbols } = await retrieve({ db, root, config, task, classification });

  events.emit("task:phase", "packing");
  const packet = await packContext({
    db,
    root,
    config,
    task,
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
      message: "Ollama offline — context packet built but no answer generated."
    };
  }

  events.emit("task:phase", "thinking");
  const result = await generateWithOllama({
    baseUrl: config.ollama.baseUrl,
    model: answerModel,
    prompt: packet.prompt,
    options: optionsFromConfig(config)
  });

  return { ok: result.ok, answer: result.text.trim(), packet, message: result.error };
}

/**
 * Full patch loop:
 * classify -> retrieve -> pack -> generate diff -> validate -> safety ->
 * git apply --check -> apply -> reindex -> checks -> repair (max retries).
 */
export async function runPatch(
  deps: RunnerDeps,
  task: string,
  options: { apply: boolean } = { apply: true }
): Promise<PatchOutcome> {
  const { db, root, config, events } = deps;
  const checks: CheckResult[] = [];

  const ollamaReady = await isOllamaAvailable(config.ollama.baseUrl);
  if (!ollamaReady) {
    return {
      ok: false,
      applied: false,
      attempts: 0,
      files: [],
      checks,
      message: "Ollama offline — cannot generate a patch."
    };
  }

  const taskId = createTask(db, task, config.models.patcher);
  const maxAttempts = 3; // 1 initial attempt + up to 2 repairs
  const installed = await listOllamaModels(config.ollama.baseUrl);
  const patcherModel = resolveModelName(config.models.patcher, installed);
  const debuggerModel = resolveModelName(config.models.debugger || config.models.patcher, installed);
  const classifierModel = resolveModelName(config.models.tagger, installed);

  events.emit("task:phase", "classifying");
  const classification = await classifyTask({ config, task, ollamaReady, model: classifierModel });
  events.emit("task:phase", "retrieving");
  const retrieval = await retrieve({ db, root, config, task, classification });

  events.emit("task:phase", "packing");
  const packet = await packContext({
    db,
    root,
    config,
    task,
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

    const generation = await generateWithOllama({
      baseUrl: config.ollama.baseUrl,
      model: attempt === 1 ? patcherModel : debuggerModel,
      prompt,
      options: optionsFromConfig(config)
    });

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
