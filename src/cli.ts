import React from "react";
import fs from "node:fs/promises";
import path from "node:path";
import type { SmithConfig } from "./types/index.js";
import { Command } from "commander";
import { render } from "ink";
import { detectProjectRoot } from "./config/projectRoot.js";
import { ensureConfig, loadConfig, DEFAULT_CONFIG } from "./config/config.js";
import { createEventBus } from "./events/events.js";
import { openDatabase } from "./db/db.js";
import { createIndexer } from "./index/indexer.js";
import { createWatcher } from "./index/watcher.js";
import { isProviderAvailable, listProviderModels } from "./providers/providers.js";
import { createSmithRuntime } from "./runtime/smithRuntime.js";
import { fileNeighbors, renderFileGraph } from "./index/graph.js";
import { tagName } from "./index/tags.js";
import { startApiServer } from "./api/server.js";
import { createWorkItem, listWorkItems, getWorkItem, updateWorkItemStatus, deleteWorkItem, listWorkItemChangeSets } from "./tasks/taskStore.js";
import { createTaskPlanStep, listTaskPlanSteps, getTaskPlanStep, updateTaskPlanStepStatus, updateTaskPlanStepNotes, deleteTaskPlanStep, replaceTaskPlan, markPlanProgressForPhase } from "./tasks/taskPlanStore.js";
import { generateTaskPlan, fallbackTaskPlan } from "./tasks/taskPlanGenerator.js";
import { importLocalTasks, importOrganizerTasks } from "./tasks/taskImport.js";
import { TASK_FLOW_TEMPLATES } from "./tasks/taskFlowTemplates.js";
import { renderTaskFlowTemplate } from "./tasks/taskFlowTemplateRenderer.js";
import { startOrganizerHeartbeat } from "./organizer/heartbeat.js";
import { startOrganizerServer } from "./organizer/server.js";
import { formatLanUrls, getLanAddresses } from "./utils/network.js";
import { createGitCheckpoint, revertCheckpoint } from "./checkpoints/gitCheckpoint.js";
import { listCheckpoints, getCheckpoint, deleteCheckpoint } from "./checkpoints/checkpointStore.js";
import { createChangeSet, listChangeSets, getChangeSet, listChangedFiles, listChangedHunks, getAcceptedHunkRefs, updateChangeSetStatus, updateChangedFileStatus, updateChangedHunkStatus, updateChangedHunksForFile, deleteChangeSet } from "./changes/changeSetStore.js";
import { buildAcceptedHunksDiff } from "./changes/hunkDiffBuilder.js";
import { applyAcceptedChangeSet, validateAcceptedHunksDiff, applyAcceptedHunksChangeSet } from "./changes/changeSetApply.js";
import { App } from "./tui/App.js";

async function bootstrap(rootOverride?: string) {
  const root = rootOverride ?? await detectProjectRoot(process.cwd());
  await ensureConfig(root);
  const config = await loadConfig(root);
  const db = openDatabase(root);
  const events = createEventBus();
  return { root, config, db, events };
}

function getConfigValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setConfigValue(obj: Record<string, unknown>, keyPath: string, rawValue: string): void {
  const parts = keyPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  const existing = current[lastKey];
  if (typeof existing === "number") {
    current[lastKey] = Number(rawValue);
  } else if (typeof existing === "boolean") {
    current[lastKey] = rawValue === "true" || rawValue === "1";
  } else if (Array.isArray(existing)) {
    try {
      current[lastKey] = JSON.parse(rawValue);
    } catch {
      current[lastKey] = rawValue.split(",").map((s) => s.trim());
    }
  } else {
    try { current[lastKey] = JSON.parse(rawValue); } catch { current[lastKey] = rawValue; }
  }
}

function unsetConfigValue(obj: Record<string, unknown>, keyPath: string): void {
  const parts = keyPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) return;
    current = current[parts[i]] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]];
}

export function createCli() {
  const program = new Command();

  program
    .name("smith")
    .description("Matrix-themed local-first terminal coding agent")
    .version("0.1.0");

  program
    .command("index")
    .description("Run a full scan/index bootstrap (files, symbols, graph, tags)")
    .option("--summarize", "also run the model intelligence pass (slower)", false)
    .action(async (opts: { summarize: boolean }) => {
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events, enableIntel: opts.summarize });
      await indexer.quickStartupScan();
      if (opts.summarize) await indexer.whenIdle();
      const stats = indexer.getStats();
      console.log(JSON.stringify({ root, ...stats }, null, 2));
      db.close();
    });

  program
    .command("status")
    .description("Show project/index status")
    .action(async () => {
      const { root, config, db } = await bootstrap();
      const files = (db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c;
      const symbols = (db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }).c;
      const imports = (db.prepare("SELECT COUNT(*) AS c FROM imports WHERE to_file_id IS NOT NULL").get() as { c: number }).c;
      const tagged = (db.prepare("SELECT COUNT(DISTINCT file_id) AS c FROM file_tags").get() as { c: number }).c;
      const available = await isProviderAvailable(config);
      const models = available ? await listProviderModels(config) : [];
      console.log(
        JSON.stringify(
          {
            root,
            patcherModel: config.models.patcher,
            defaultProvider: config.defaultProvider,
            providers: Object.keys(config.providers).length > 0 ? Object.keys(config.providers) : ["ollama"],
            providerAvailable: available,
            installedModels: models,
            files,
            symbols,
            localImports: imports,
            taggedFiles: tagged
          },
          null,
          2
        )
      );
      db.close();
    });

  program
    .command("ask")
    .description("Ask a question; builds dense context and answers with the local model")
    .argument("<task...>")
    .action(async (taskParts: string[]) => {
      const task = taskParts.join(" ");
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const runtime = createSmithRuntime({ db, root, config, events, indexer });
      const result = await runtime.dispatch({ kind: "ask", prompt: task });

      console.log("\n— CONTEXT —");
      console.log(`tokens ~${result.packet?.estimatedTokens ?? 0} | files: ${result.packet?.files.map((f) => f.path).join(", ") || "(none)"}`);
      if (result.message) console.log(`note: ${result.message}`);
      if (result.answer) {
        console.log("\n— ANSWER —");
        console.log(result.answer);
      }
      db.close();
    });

  program
    .command("patch")
    .description("Generate a unified-diff patch for a task (reviews by default)")
    .argument("<task...>")
    .option("--apply", "immediately apply the patch")
    .option("--review", "store as proposed change set (default)")
    .option("--dry-run", "validate without storing or applying")
    .action(async (taskParts: string[], opts: { apply: boolean; review: boolean; dryRun: boolean }) => {
      const task = taskParts.join(" ");
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const runtime = createSmithRuntime({ db, root, config, events, indexer });

      const dry = opts.dryRun;
      const apl = opts.apply && !dry;
      const outcome = await runtime.dispatch({ kind: "patch", prompt: task, apply: apl, dryRun: dry });

      console.log(`\n— PATCH —`);
      console.log(outcome.message);
      if (outcome.answer) {
        console.log("\n— ANSWER —");
        console.log(outcome.answer);
      }
      if (outcome.files?.length) console.log(`files: ${outcome.files.join(", ")}`);
      if (outcome.diff) {
        console.log("\n— DIFF —");
        console.log(outcome.diff);
      }
      for (const check of outcome.checks ?? []) {
        console.log(`\n[check ${check.name}] ${check.ok ? "PASS" : "FAIL"} (exit ${check.exitCode})`);
        if (!check.ok) console.log((check.stderr || check.stdout).slice(0, 1500));
      }
      const data = outcome.data as Record<string, unknown> | undefined;
      if (data?.changeSetId) {
        console.log(`\n— REVIEW —`);
        console.log(`Proposed change set: ${data.changeSetId}`);
        console.log(`Review:`);
        console.log(`  smith changes show ${data.changeSetId}`);
        console.log(`  smith changes accept ${data.changeSetId}`);
        console.log(`  smith changes apply ${data.changeSetId}`);
      }
      await indexer.whenIdle();
      db.close();
      process.exitCode = outcome.ok ? 0 : 1;
    });

  program
    .command("retrieve")
    .description("Show which files and symbols would be retrieved for a task (no model call)")
    .argument("<task...>")
    .option("--json", "output JSON")
    .action(async (taskParts: string[], opts: { json: boolean }) => {
      const task = taskParts.join(" ");
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const runtime = createSmithRuntime({ db, root, config, events, indexer });
      const result = await runtime.dispatch({ kind: "retrieve", prompt: task, json: opts.json });

      if (opts.json) {
        console.log(JSON.stringify(result.data ?? result, null, 2));
        db.close();
        return;
      }

      const data = result.data as Record<string, unknown> | undefined;
      const plan = data?.promptPlan as Record<string, unknown> | undefined;
      const files = (data?.files ?? []) as Array<{ path: string; score: number; reasons: string[] }>;
      const seedSymbols = (data?.seedSymbols ?? []) as Array<{ name: string; path: string; kind: string; startLine: number; endLine: number }>;

      if (plan?.objective) console.log(`objective: ${plan.objective}`);
      console.log("\n— RETRIEVAL —");
      if (files.length) {
        console.log("files:");
        for (const f of files) {
          console.log(`  ${f.score.toFixed(1).padStart(5)}  ${f.path}  ${f.reasons.join(", ")}`);
        }
      } else {
        console.log("files: (none)");
      }
      if (seedSymbols.length) {
        console.log("\nsymbols:");
        for (const s of seedSymbols) {
          console.log(`  ${s.kind} ${s.name} ${s.path}:L${s.startLine}-L${s.endLine}`);
        }
      }
      db.close();
    });

  program
    .command("context")
    .description("Build a context packet for a task without calling the model")
    .argument("<task...>")
    .option("--json", "output JSON")
    .option("--print-prompt", "print the full assembled prompt")
    .action(async (taskParts: string[], opts: { json: boolean; printPrompt: boolean }) => {
      const task = taskParts.join(" ");
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const runtime = createSmithRuntime({ db, root, config, events, indexer });
      const result = await runtime.dispatch({ kind: "context", prompt: task, json: opts.json });

      if (opts.json) {
        console.log(JSON.stringify({
          ok: result.ok,
          message: result.message,
          packet: result.packet,
          data: result.data
        }, null, 2));
        db.close();
        return;
      }

      if (opts.printPrompt && result.packet) {
        console.log(result.packet.prompt);
        db.close();
        return;
      }

      console.log("\n— CONTEXT PACKET —");
      console.log(`estimated tokens: ${result.packet?.estimatedTokens ?? 0}`);
      console.log(`files: ${result.packet?.files.map((f) => f.path).join(", ") || "(none)"}`);
      console.log(`symbols: ${result.packet?.symbols.map((s) => `${s.name} (${s.path})`).join(", ") || "(none)"}`);
      if (result.packet) {
        console.log("\n— PROMPT PREVIEW —");
        console.log(result.packet.prompt.slice(0, 1200));
        if (result.packet.prompt.length > 1200) console.log("...");
      }
      db.close();
    });

  const taskCmd = program
    .command("task")
    .description("Manage work items (task list)");

  taskCmd
    .command("add")
    .description("Add a work item")
    .argument("<title...>")
    .option("--json", "output JSON")
    .option("--priority <n>", "priority", "0")
    .option("--source <source>", "source: user, agent, organizer, api", "user")
    .action(async (titleParts: string[], opts: { json: boolean; priority: string; source: string }) => {
      const { db } = await bootstrap();
      const title = titleParts.join(" ");
      const item = createWorkItem(db, {
        title,
        priority: Number(opts.priority),
        source: opts.source as "user" | "agent" | "organizer" | "api"
      });
      if (opts.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        console.log(`Created task ${item.id}: ${item.title}`);
      }
      db.close();
    });

  taskCmd
    .command("list")
    .description("List work items")
    .option("--json", "output JSON")
    .option("--status <status>", "filter by status")
    .option("--source <source>", "filter by source")
    .action(async (opts: { json: boolean; status?: string; source?: string }) => {
      const { db } = await bootstrap();
      const items = listWorkItems(db, {
        status: opts.status as "todo" | "in_progress" | "blocked" | "needs_review" | "done" | "cancelled" | "failed" | undefined,
        source: opts.source as "user" | "agent" | "organizer" | "api" | undefined
      });
      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else if (items.length === 0) {
        console.log("No work items.");
      } else {
        for (const item of items) {
          console.log(`${item.id}  [${item.status}]  p${item.priority}  ${item.title}`);
        }
      }
      db.close();
    });

  taskCmd
    .command("show")
    .description("Show a work item")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { db } = await bootstrap();
      const item = getWorkItem(db, id);
      if (!item) {
        console.log(`Task not found: ${id}`);
        db.close();
        return;
      }
      console.log(JSON.stringify(item, null, 2));
      db.close();
    });

  taskCmd
    .command("start")
    .description("Mark a work item as in_progress")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const item = updateWorkItemStatus(db, id, "in_progress");
      if (item) {
        console.log(`Started: ${item.id} — ${item.title}`);
      } else {
        console.log(`Task not found: ${id}`);
      }
      db.close();
    });

  taskCmd
    .command("done")
    .description("Mark a work item as done")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const item = updateWorkItemStatus(db, id, "done");
      if (item) {
        console.log(`Done: ${item.id} — ${item.title}`);
      } else {
        console.log(`Task not found: ${id}`);
      }
      db.close();
    });

  taskCmd
    .command("cancel")
    .description("Mark a work item as cancelled")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const item = updateWorkItemStatus(db, id, "cancelled");
      if (item) {
        console.log(`Cancelled: ${item.id} — ${item.title}`);
      } else {
        console.log(`Task not found: ${id}`);
      }
      db.close();
    });

  taskCmd
    .command("delete")
    .description("Delete a work item")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const deleted = deleteWorkItem(db, id);
      if (deleted) {
        console.log(`Deleted: ${id}`);
      } else {
        console.log(`Task not found: ${id}`);
      }
      db.close();
    });

  taskCmd
    .command("patch")
    .description("Generate a patch for a work item (reviews by default)")
    .argument("<id>")
    .option("--apply", "immediately apply the patch")
    .option("--dry-run", "validate without storing or applying")
    .option("--review", "store as proposed change set (default)")
    .action(async (id: string, opts: { apply: boolean; dryRun: boolean; review: boolean }) => {
      const { root, config, db, events } = await bootstrap();
      const item = getWorkItem(db, id);
      if (!item) {
        console.log(`Task not found: ${id}`);
        db.close();
        return;
      }
      let prompt = item.title;
      if (item.description) prompt += "\n\n" + item.description;

      const steps = listTaskPlanSteps(db, id);
      if (steps.length > 0) {
        const chars: Record<string, string> = { todo: "[ ]", doing: "[~]", done: "[x]", skipped: "[-]", failed: "[!]" };
        const planLines = steps.map((s) => {
          const line = `${chars[s.status] ?? "[?]"} ${s.title}`;
          return s.notes ? `${line} — ${s.notes}` : line;
        });
        prompt += "\n\nTask plan:\n" + planLines.join("\n");
      } else {
        console.log("No plan found. Generate one with: smith task plan-generate " + id);
      }

      updateWorkItemStatus(db, id, "in_progress");
      const contextChanged = markPlanProgressForPhase(db, id, "context");

      const indexer = createIndexer({ root, config, db, events });
      const runtime = createSmithRuntime({ db, root, config, events, indexer });

      const dry = opts.dryRun;
      const apl = opts.apply && !dry;
      const result = await runtime.dispatch({ kind: "patch", prompt, taskId: id, apply: apl, dryRun: dry });

      const planChanged = [...contextChanged];

      if (result.ok) {
        planChanged.push(...markPlanProgressForPhase(db, id, "implementation"));
        if (result.checks && result.checks.length > 0) {
          if (result.checks.every((c) => c.ok)) {
            planChanged.push(...markPlanProgressForPhase(db, id, "checks"));
          } else {
            planChanged.push(...markPlanProgressForPhase(db, id, "failed"));
          }
        }
        const data = result.data as Record<string, unknown> | undefined;
        if (apl) {
          planChanged.push(...markPlanProgressForPhase(db, id, "completed"));
          updateWorkItemStatus(db, id, "done");
        } else if (data?.changeSetId) {
          planChanged.push(...markPlanProgressForPhase(db, id, "review"));
          updateWorkItemStatus(db, id, "needs_review");
        }
      } else {
        planChanged.push(...markPlanProgressForPhase(db, id, "failed"));
        updateWorkItemStatus(db, id, "failed");
      }

      console.log(`\n— TASK ${id} —`);
      console.log(item.title);
      console.log(`\n${result.ok ? "✓" : "✗"} ${result.message}`);
      if (result.files?.length) console.log(`files: ${result.files.join(", ")}`);
      if (result.diff) {
        console.log("\n— DIFF —");
        console.log(result.diff);
      }
      for (const check of result.checks ?? []) {
        console.log(`\n[check ${check.name}] ${check.ok ? "PASS" : "FAIL"} (exit ${check.exitCode})`);
      }
      const data = result.data as Record<string, unknown> | undefined;
      if (data?.changeSetId) {
        console.log(`\n— REVIEW —`);
        console.log(`Change set: ${data.changeSetId}`);
        console.log(`Review:`);
        console.log(`  smith changes show ${data.changeSetId}`);
        console.log(`  smith changes accept ${data.changeSetId}`);
        console.log(`  smith changes apply ${data.changeSetId}`);
      }
      if (planChanged.length > 0) {
        const chars: Record<string, string> = { todo: "[ ]", doing: "[~]", done: "[x]", skipped: "[-]", failed: "[!]" };
        console.log("\n— PLAN —");
        for (const s of planChanged) {
          console.log(`${chars[s.status] ?? "[?]"} ${s.title}`);
        }
      }
      db.close();
    });

  taskCmd
    .command("changes")
    .description("List change sets for a work item")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { db } = await bootstrap();
      const sets = listWorkItemChangeSets(db, id);
      if (opts.json) {
        console.log(JSON.stringify(sets, null, 2));
      } else if (sets.length === 0) {
        console.log(`No change sets for task ${id}.`);
      } else {
        for (const cs of sets) {
          console.log(`${cs.id}  [${cs.status}]  ${new Date(cs.createdAt).toISOString()}  ${cs.summary ?? ""}`);
        }
      }
      db.close();
    });

  taskCmd
    .command("plan")
    .description("Show plan steps for a work item")
    .argument("<taskId>")
    .option("--json", "output JSON")
    .action(async (taskId: string, opts: { json: boolean }) => {
      const { db } = await bootstrap();
      const item = getWorkItem(db, taskId);
      const steps = listTaskPlanSteps(db, taskId);
      if (opts.json) {
        console.log(JSON.stringify({ task: item, steps }, null, 2));
      } else {
        if (item) console.log(`${item.title} [${item.status}]`);
        if (steps.length === 0) {
          console.log("No plan steps.");
        } else {
          const chars: Record<string, string> = { todo: "[ ]", doing: "[~]", done: "[x]", skipped: "[-]", failed: "[!]" };
          for (const s of steps) {
            console.log(`${chars[s.status] ?? "[?]"} ${s.title}`);
          }
        }
      }
      db.close();
    });

  taskCmd
    .command("plan-add")
    .description("Add a plan step to a work item")
    .argument("<taskId>")
    .argument("<title...>")
    .action(async (taskId: string, titleParts: string[]) => {
      const { db } = await bootstrap();
      const title = titleParts.join(" ");
      const step = createTaskPlanStep(db, { taskId, title });
      console.log(`Created step ${step.id}: ${step.title}`);
      db.close();
    });

  taskCmd
    .command("plan-set")
    .description("Replace all plan steps from a file")
    .argument("<taskId>")
    .requiredOption("--file <path>", "path to plan file")
    .action(async (taskId: string, opts: { file: string }) => {
      const { root, db } = await bootstrap();
      let content: string;
      try {
        content = await fs.readFile(path.join(root, opts.file), "utf8");
      } catch {
        console.log(`Failed to read file: ${opts.file}`);
        db.close();
        return;
      }
      const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
      const steps = lines.map((l) => {
        let t = l
          .replace(/^-\s*\[\s*[x ]?\s*\]\s*/i, "")
          .replace(/^TODO:\s*/i, "")
          .replace(/^DONE:\s*/i, "")
          .replace(/^\d+\.\s*/, "")
          .trim();
        return t ? { title: t } : null;
      }).filter((s): s is { title: string } => s !== null);
      const inserted = replaceTaskPlan(db, taskId, steps);
      console.log(`Replaced plan for task ${taskId} with ${inserted.length} step(s).`);
      db.close();
    });

  taskCmd
    .command("plan-clear")
    .description("Clear all plan steps for a work item")
    .argument("<taskId>")
    .action(async (taskId: string) => {
      const { db } = await bootstrap();
      replaceTaskPlan(db, taskId, []);
      console.log(`Cleared plan for task ${taskId}.`);
      db.close();
    });

  taskCmd
    .command("plan-step")
    .description("Update a plan step status")
    .argument("<stepId>")
    .argument("<status>")
    .action(async (stepId: string, status: string) => {
      const valid = ["todo", "doing", "done", "skipped", "failed"];
      if (!valid.includes(status)) {
        console.log(`Invalid status: ${status}. Use: ${valid.join(", ")}`);
        return;
      }
      const { db } = await bootstrap();
      const step = updateTaskPlanStepStatus(db, stepId, status as "todo" | "doing" | "done" | "skipped" | "failed");
      if (step) {
        console.log(`Updated step ${step.id} to ${status}: ${step.title}`);
      } else {
        console.log(`Step not found: ${stepId}`);
      }
      db.close();
    });

  taskCmd
    .command("plan-note")
    .description("Set notes on a plan step")
    .argument("<stepId>")
    .argument("<notes...>")
    .action(async (stepId: string, notesParts: string[]) => {
      const { db } = await bootstrap();
      const notes = notesParts.join(" ");
      const step = updateTaskPlanStepNotes(db, stepId, notes);
      if (step) {
        console.log(`Notes updated for step ${step.id}: ${step.title}`);
      } else {
        console.log(`Step not found: ${stepId}`);
      }
      db.close();
    });

  taskCmd
    .command("plan-delete")
    .description("Delete a plan step")
    .argument("<stepId>")
    .action(async (stepId: string) => {
      const { db } = await bootstrap();
      const deleted = deleteTaskPlanStep(db, stepId);
      if (deleted) {
        console.log(`Deleted step: ${stepId}`);
      } else {
        console.log(`Step not found: ${stepId}`);
      }
      db.close();
    });

  taskCmd
    .command("plan-generate")
    .description("Generate a task plan using the provider model")
    .argument("<taskId>")
    .option("--model <model>", "override model")
    .option("--fallback", "use deterministic fallback plan")
    .option("--json", "output JSON")
    .action(async (taskId: string, opts: { model?: string; fallback: boolean; json: boolean }) => {
      const { config, db } = await bootstrap();
      const item = getWorkItem(db, taskId);
      if (!item) {
        console.log(`Task not found: ${taskId}`);
        db.close();
        return;
      }

      let steps: Array<{ title: string; notes?: string }>;
      let generated = false;

      if (opts.fallback) {
        steps = fallbackTaskPlan(item.title);
      } else {
        const result = await generateTaskPlan({
          config,
          taskTitle: item.title,
          taskDescription: item.description,
          model: opts.model
        });
        if (!result.ok) {
          console.log(`✗ Plan generation failed: ${result.error}`);
          console.log(`Hint: use --fallback for a deterministic plan.`);
          db.close();
          return;
        }
        steps = result.steps;
        generated = true;
      }

      const inserted = replaceTaskPlan(db, taskId, steps);
      if (opts.json) {
        console.log(JSON.stringify({ task: item, steps: inserted, generated: generated || undefined, fallback: opts.fallback || undefined }, null, 2));
      } else {
        console.log(`Generated ${inserted.length} step(s) for task ${taskId}.`);
      }
      db.close();
    });

  taskCmd
    .command("import")
    .description("Import tasks from pasted text or file")
    .option("--file <path>", "read from file")
    .option("--text <text>", "inline text")
    .option("--format <format>", "auto|plain|markdown|csv|json")
    .option("--json", "output JSON")
    .option("--skip-duplicates", "skip tasks with same title")
    .action(async (opts: { file?: string; text?: string; format?: string; json: boolean; skipDuplicates: boolean }) => {
      const { root, db } = await bootstrap();
      let text = opts.text ?? "";
      if (opts.file) {
        try { text = await fs.readFile(path.join(root, opts.file), "utf8"); } catch { console.log(`Failed to read: ${opts.file}`); db.close(); return; }
      }
      if (!text.trim()) { console.log("No input. Use --file or --text."); db.close(); return; }
      const result = importLocalTasks({
        db,
        text,
        format: (opts.format as "auto" | "plain" | "markdown" | "csv" | "json") ?? "auto",
        options: { skipDuplicates: opts.skipDuplicates }
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Created ${result.created} task(s), skipped ${result.skipped}`);
        for (const w of result.warnings) console.log(`WARNING: ${w}`);
      }
      db.close();
    });

  taskCmd
    .command("template")
    .description("List or render task flow templates")
    .argument("[action]", "list or render")
    .option("--id <id>", "template ID to render")
    .option("--format <format>", "output format: markdown, json, csv, plain")
    .option("--out <path>", "write to file")
    .action(async (action: string | undefined, opts: { id?: string; format?: string; out?: string }) => {
      if (!action || action === "list") {
        console.log("Available templates:");
        for (const t of TASK_FLOW_TEMPLATES) {
          console.log(`  ${t.id.padEnd(30)} ${t.title}`);
          console.log(`    ${t.description}`);
          console.log(`    Formats: ${t.recommendedFormats.join(", ")}`);
        }
        return;
      }
      if (action === "render" && opts.id) {
        const format = (opts.format ?? "markdown") as "markdown" | "json" | "csv" | "plain";
        try {
          const result = renderTaskFlowTemplate({ templateId: opts.id, format });
          if (opts.out) {
            await fs.writeFile(opts.out, result.content, "utf8");
            console.log(`Written to ${opts.out}`);
          } else {
            console.log(result.content);
          }
        } catch (err) {
          console.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      console.log("Usage: smith task template [list|render --id <id> --format <fmt> [--out <path>]]");
    });

  const checkpointCmd = program
    .command("checkpoint")
    .description("Manage Git-backed checkpoints / revert points");

  checkpointCmd
    .command("create")
    .description("Create a Git checkpoint of the current working tree")
    .argument("<label...>")
    .option("--json", "output JSON")
    .action(async (labelParts: string[], opts: { json: boolean }) => {
      const { root, db } = await bootstrap();
      const label = labelParts.join(" ");
      const cp = await createGitCheckpoint({ root, db, label });
      if (opts.json) {
        console.log(JSON.stringify(cp, null, 2));
      } else {
        const headShort = cp.gitHead ? cp.gitHead.slice(0, 7) : "(no git)";
        console.log(`Checkpoint ${cp.id}`);
        console.log(`  label: ${cp.label}`);
        console.log(`  HEAD: ${headShort}`);
        console.log(`  dirty: ${cp.dirtyBefore}`);
        console.log(`  files: ${cp.files.length}`);
      }
      db.close();
    });

  checkpointCmd
    .command("list")
    .description("List all checkpoints")
    .option("--json", "output JSON")
    .action(async (opts: { json: boolean }) => {
      const { db } = await bootstrap();
      const items = listCheckpoints(db);
      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else if (items.length === 0) {
        console.log("No checkpoints.");
      } else {
        for (const cp of items) {
          const headShort = cp.gitHead ? cp.gitHead.slice(0, 7) : "-";
          console.log(`${cp.id}  ${headShort}  dirty=${cp.dirtyBefore}  files=${cp.files.length}  ${cp.label}`);
        }
      }
      db.close();
    });

  checkpointCmd
    .command("show")
    .description("Show a checkpoint")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { db } = await bootstrap();
      const cp = getCheckpoint(db, id);
      if (!cp) {
        console.log(`Checkpoint not found: ${id}`);
        db.close();
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(cp, null, 2));
      } else {
        console.log(`id: ${cp.id}`);
        console.log(`label: ${cp.label}`);
        console.log(`HEAD: ${cp.gitHead ?? "(none)"}`);
        console.log(`dirty before: ${cp.dirtyBefore}`);
        console.log(`pre diff: ${cp.preDiffPath ?? "(none)"}`);
        console.log(`applied diff: ${cp.appliedDiffPath ?? "(none)"}`);
        console.log(`files (${cp.files.length}): ${cp.files.join(", ") || "(none)"}`);
      }
      db.close();
    });

  checkpointCmd
    .command("revert")
    .description("Revert an applied checkpoint diff")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { root, db } = await bootstrap();
      const result = await revertCheckpoint({ root, db, id });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.ok ? "✓" : "✗", result.message);
        if (result.files.length) console.log(`files: ${result.files.join(", ")}`);
      }
      db.close();
    });

  checkpointCmd
    .command("delete")
    .description("Delete a checkpoint record")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const deleted = deleteCheckpoint(db, id);
      if (deleted) {
        console.log(`Deleted: ${id}`);
      } else {
        console.log(`Checkpoint not found: ${id}`);
      }
      db.close();
    });

  const changesCmd = program
    .command("changes")
    .description("Manage change sets and file reviews");

  changesCmd
    .command("list")
    .description("List change sets")
    .option("--json", "output JSON")
    .option("--status <status>", "filter by status")
    .action(async (opts: { json: boolean; status?: string }) => {
      const { db } = await bootstrap();
      const items = listChangeSets(db, { status: opts.status as "proposed" | "partially_accepted" | "accepted" | "rejected" | "applied" | "reverted" | undefined });
      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else if (items.length === 0) {
        console.log("No change sets.");
      } else {
        for (const cs of items) {
          const files = listChangedFiles(db, cs.id);
          console.log(`${cs.id}  [${cs.status}]  files=${files.length}  ${cs.summary ?? "(no summary)"}`);
        }
      }
      db.close();
    });

  changesCmd
    .command("show")
    .description("Show a change set and its files")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { db } = await bootstrap();
      const cs = getChangeSet(db, id);
      if (!cs) {
        console.log(`Change set not found: ${id}`);
        db.close();
        return;
      }
      const files = listChangedFiles(db, id);
      if (opts.json) {
        console.log(JSON.stringify({ changeSet: cs, files }, null, 2));
      } else {
        console.log(`id: ${cs.id}`);
        console.log(`status: ${cs.status}`);
        console.log(`summary: ${cs.summary ?? "(none)"}`);
        console.log(`task: ${cs.taskId ?? "(none)"}`);
        console.log(`checkpoint: ${cs.checkpointId ?? "(none)"}`);
        console.log(`created: ${new Date(cs.createdAt).toISOString()}`);
        console.log(`\nchanged files (${files.length}):`);
        for (const f of files) {
          console.log(`  [${f.status}] ${f.path}  +${f.additions} -${f.deletions}`);
        }
      }
      db.close();
    });

  changesCmd
    .command("create")
    .description("Create a change set from a diff file")
    .requiredOption("--diff-file <path>", "path to diff file")
    .option("--json", "output JSON")
    .option("--summary <text>", "change set summary")
    .option("--task <id>", "associated task ID")
    .option("--checkpoint <id>", "associated checkpoint ID")
    .action(async (opts: { diffFile: string; json: boolean; summary?: string; task?: string; checkpoint?: string }) => {
      const { root, db } = await bootstrap();
      const diffPath = path.join(root, opts.diffFile);
      let diff: string;
      try {
        diff = await fs.readFile(diffPath, "utf8");
      } catch {
        console.log(`Failed to read diff file: ${diffPath}`);
        db.close();
        return;
      }
      const cs = createChangeSet(db, {
        diff,
        summary: opts.summary,
        taskId: opts.task,
        checkpointId: opts.checkpoint
      });
      const files = listChangedFiles(db, cs.id);
      if (opts.json) {
        console.log(JSON.stringify({ changeSet: cs, files }, null, 2));
      } else {
        console.log(`Created change set ${cs.id} (${files.length} files)`);
      }
      db.close();
    });

  changesCmd
    .command("accept")
    .description("Accept an entire change set")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const cs = updateChangeSetStatus(db, id, "accepted");
      if (cs) {
        console.log(`Accepted: ${cs.id}`);
      } else {
        console.log(`Change set not found: ${id}`);
      }
      db.close();
    });

  changesCmd
    .command("reject")
    .description("Reject an entire change set")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const cs = updateChangeSetStatus(db, id, "rejected");
      if (cs) {
        console.log(`Rejected: ${cs.id}`);
      } else {
        console.log(`Change set not found: ${id}`);
      }
      db.close();
    });

  changesCmd
    .command("accept-file")
    .description("Accept a single file in a change set")
    .argument("<id>")
    .argument("<path>")
    .action(async (id: string, filePath: string) => {
      const { db } = await bootstrap();
      const review = updateChangedFileStatus(db, id, filePath, "accepted");
      if (review) {
        const cs = getChangeSet(db, id);
        console.log(`Accepted file: ${filePath} (set status: ${cs?.status ?? "?"})`);
      } else {
        console.log(`File not found in change set: ${filePath}`);
      }
      db.close();
    });

  changesCmd
    .command("reject-file")
    .description("Reject a single file in a change set")
    .argument("<id>")
    .argument("<path>")
    .action(async (id: string, filePath: string) => {
      const { db } = await bootstrap();
      const review = updateChangedFileStatus(db, id, filePath, "rejected");
      if (review) {
        const cs = getChangeSet(db, id);
        console.log(`Rejected file: ${filePath} (set status: ${cs?.status ?? "?"})`);
      } else {
        console.log(`File not found in change set: ${filePath}`);
      }
      db.close();
    });

  changesCmd
    .command("hunks")
    .description("List hunks for a change set")
    .argument("<id>")
    .argument("[path]", "optional file path filter")
    .option("--json", "output JSON")
    .action(async (id: string, pathFilter: string | undefined, opts: { json: boolean }) => {
      const { db } = await bootstrap();
      const hunks = listChangedHunks(db, id, pathFilter || undefined);
      if (opts.json) {
        console.log(JSON.stringify(hunks, null, 2));
      } else if (hunks.length === 0) {
        console.log("No hunks stored for this change set. Recreate the change set to populate hunks.");
      } else {
        for (const h of hunks) {
          console.log(`${h.id}  [${h.status}]  ${h.path}#${h.hunkIndex}  ${h.header}  +${h.additions} -${h.deletions}`);
        }
      }
      db.close();
    });

  changesCmd
    .command("accept-hunk")
    .description("Accept a single hunk")
    .argument("<hunkId>")
    .action(async (hunkId: string) => {
      const { db } = await bootstrap();
      const hunk = updateChangedHunkStatus(db, hunkId, "accepted");
      if (hunk) {
        const cs = getChangeSet(db, hunk.changeSetId);
        console.log(`Accepted hunk ${hunk.id} (${hunk.path}#${hunk.hunkIndex}, set: ${cs?.status ?? "?"})`);
      } else {
        console.log(`Hunk not found: ${hunkId}`);
      }
      db.close();
    });

  changesCmd
    .command("reject-hunk")
    .description("Reject a single hunk")
    .argument("<hunkId>")
    .action(async (hunkId: string) => {
      const { db } = await bootstrap();
      const hunk = updateChangedHunkStatus(db, hunkId, "rejected");
      if (hunk) {
        const cs = getChangeSet(db, hunk.changeSetId);
        console.log(`Rejected hunk ${hunk.id} (${hunk.path}#${hunk.hunkIndex}, set: ${cs?.status ?? "?"})`);
      } else {
        console.log(`Hunk not found: ${hunkId}`);
      }
      db.close();
    });

  changesCmd
    .command("accept-file-hunks")
    .description("Accept all hunks for a file")
    .argument("<id>")
    .argument("<path>")
    .action(async (id: string, filePath: string) => {
      const { db } = await bootstrap();
      const count = updateChangedHunksForFile(db, id, filePath, "accepted");
      if (count > 0) {
        const cs = getChangeSet(db, id);
        console.log(`Accepted ${count} hunk(s) in ${filePath} (set: ${cs?.status ?? "?"})`);
      } else {
        console.log(`No hunks found for ${filePath} in change set ${id}`);
      }
      db.close();
    });

  changesCmd
    .command("reject-file-hunks")
    .description("Reject all hunks for a file")
    .argument("<id>")
    .argument("<path>")
    .action(async (id: string, filePath: string) => {
      const { db } = await bootstrap();
      const count = updateChangedHunksForFile(db, id, filePath, "rejected");
      if (count > 0) {
        const cs = getChangeSet(db, id);
        console.log(`Rejected ${count} hunk(s) in ${filePath} (set: ${cs?.status ?? "?"})`);
      } else {
        console.log(`No hunks found for ${filePath} in change set ${id}`);
      }
      db.close();
    });

  changesCmd
    .command("hunk-diff")
    .description("Build a diff from accepted hunks only")
    .argument("<id>")
    .option("--json", "output JSON")
    .option("--print", "print the full diff")
    .action(async (id: string, opts: { json: boolean; print: boolean }) => {
      const { db } = await bootstrap();
      const cs = getChangeSet(db, id);
      if (!cs) { console.log(`Change set not found: ${id}`); db.close(); return; }
      const refs = getAcceptedHunkRefs(db, id);
      const diff = buildAcceptedHunksDiff({ originalDiff: cs.diff, acceptedHunks: refs });
      const files = [...new Set(refs.map((r) => r.path))];
      const lines = diff.split("\n").length;
      if (opts.json) {
        console.log(JSON.stringify({ changeSetId: id, acceptedHunks: refs.length, files, diff }, null, 2));
      } else if (opts.print) {
        console.log(diff || "(empty)");
      } else {
        console.log(`Accepted hunks: ${refs.length}`);
        console.log(`Diff lines: ${lines}`);
        console.log(`Files: ${files.join(", ") || "(none)"}`);
        console.log(`Hint: use --print to view the full diff`);
      }
      db.close();
    });

  changesCmd
    .command("validate-hunks")
    .description("Validate that accepted hunks form a clean applicable diff")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { root, db } = await bootstrap();
      const result = await validateAcceptedHunksDiff({ root, db, changeSetId: id });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.ok ? "✓ PASS" : "✗ FAIL");
        console.log(result.message);
        if (result.files.length) console.log(`Files: ${result.files.join(", ")}`);
      }
      db.close();
    });

  changesCmd
    .command("delete")
    .description("Delete a change set")
    .argument("<id>")
    .action(async (id: string) => {
      const { db } = await bootstrap();
      const deleted = deleteChangeSet(db, id);
      if (deleted) {
        console.log(`Deleted: ${id}`);
      } else {
        console.log(`Change set not found: ${id}`);
      }
      db.close();
    });

  changesCmd
    .command("apply")
    .description("Apply accepted files from a change set")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const result = await applyAcceptedChangeSet({ root, db, indexer, changeSetId: id });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.ok ? "✓" : "✗", result.message);
        if (result.files.length) console.log(`files: ${result.files.join(", ")}`);
        if (result.checkpointId) console.log(`checkpoint: ${result.checkpointId}`);
        console.log(`File-level apply uses accepted files. For hunk-level apply, use: smith changes apply-hunks ${id}`);
      }
      db.close();
    });

  changesCmd
    .command("apply-hunks")
    .description("Apply only accepted hunks from a change set")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const result = await applyAcceptedHunksChangeSet({ root, db, indexer, changeSetId: id });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.ok ? "✓" : "✗", result.message);
        if (result.files.length) console.log(`files: ${result.files.join(", ")}`);
        if (result.checkpointId) console.log(`checkpoint: ${result.checkpointId}`);
      }
      db.close();
    });

  changesCmd
    .command("revert")
    .description("Revert an applied change set via its checkpoint")
    .argument("<id>")
    .option("--json", "output JSON")
    .action(async (id: string, opts: { json: boolean }) => {
      const { root, config, db, events } = await bootstrap();
      const cs = getChangeSet(db, id);
      if (!cs) {
        console.log(`Change set not found: ${id}`);
        db.close();
        return;
      }
      if (!cs.checkpointId) {
        console.log("Change set has no checkpoint to revert.");
        db.close();
        return;
      }
      const result = await revertCheckpoint({ root, db, id: cs.checkpointId });
      if (result.ok) {
        updateChangeSetStatus(db, id, "reverted");
        const indexer = createIndexer({ root, config, db, events });
        await indexer.reindexPaths(result.files);
      }
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.ok ? "✓" : "✗", result.message);
        if (result.files.length) console.log(`files: ${result.files.join(", ")}`);
      }
      db.close();
    });

  program
    .command("inspect")
    .description("Inspect a file (summary/symbols/imports) or a symbol by name")
    .argument("<target>")
    .action(async (target: string) => {
      const { db } = await bootstrap();
      const file = db.prepare("SELECT id, path, language, summary FROM files WHERE path = ?").get(target) as
        | { id: number; path: string; language: string; summary: string | null }
        | undefined;

      if (file) {
        const symbols = db
          .prepare("SELECT name, kind, start_line, end_line FROM symbols WHERE file_id = ? ORDER BY start_line")
          .all(file.id) as Array<{ name: string; kind: string; start_line: number; end_line: number }>;
        const tags = (
          db
            .prepare("SELECT tag_id FROM file_tags WHERE file_id = ?")
            .all(file.id) as Array<{ tag_id: number }>
        ).map((r) => tagName(r.tag_id));
        console.log(`FILE  ${file.path} [${file.language}]`);
        console.log(`TAGS  ${tags.join(", ") || "(none)"}`);
        console.log(`SUMMARY  ${file.summary ?? "(pending)"}`);
        console.log(`SYMBOLS (${symbols.length}):`);
        for (const s of symbols) console.log(`  ${s.kind.padEnd(10)} ${s.name}  (L${s.start_line}-${s.end_line})`);
      } else {
        const matches = db
          .prepare(
            "SELECT s.name, s.kind, s.start_line, s.end_line, f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name LIKE ? ORDER BY s.name LIMIT 25"
          )
          .all(`%${target}%`) as Array<{ name: string; kind: string; start_line: number; end_line: number; path: string }>;
        if (matches.length === 0) {
          console.log(`No file or symbol matched "${target}".`);
        } else {
          console.log(`SYMBOL MATCHES for "${target}":`);
          for (const m of matches) console.log(`  ${m.kind.padEnd(10)} ${m.name}  ${m.path}:${m.start_line}`);
        }
      }
      db.close();
    });

  program
    .command("graph")
    .description("Show the import neighborhood of a file (or a symbol's file)")
    .argument("<target>")
    .action(async (target: string) => {
      const { db } = await bootstrap();
      let relPath = target;
      const direct = db.prepare("SELECT path FROM files WHERE path = ?").get(target) as { path: string } | undefined;
      if (!direct) {
        const sym = db
          .prepare("SELECT f.path AS path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name = ? LIMIT 1")
          .get(target) as { path: string } | undefined;
        if (sym) relPath = sym.path;
      }
      const neighbors = fileNeighbors(db, relPath);
      console.log(neighbors ? renderFileGraph(neighbors) : `No graph data for "${target}".`);
      db.close();
    });

  program
    .command("config")
    .description("Manage Agent Smith configuration")
    .argument("[action]", "show, set, get, unset, add-provider, remove-provider, default-provider")
    .argument("[key...]", "config key path (e.g., models.patcher) and optional value")
    .option("--provider <name>", "provider ID for add-provider/remove-provider")
    .option("--url <url>", "base URL for add-provider")
    .option("--key-env <env>", "API key env var for add-provider")
    .option("--type <type>", "provider type: openai, anthropic, ollama")
    .action(async (action, keyParts, opts) => {
      const { root, config } = await bootstrap();
      const configPath = path.join(root, ".agent", "config.json");

      const saveConfig = async () => {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
      };

      if (!action || action === "show") {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      if (action === "list-providers") {
        console.log(JSON.stringify({
          defaultProvider: config.defaultProvider,
          providers: Object.keys(config.providers),
          builtin: ["ollama"]
        }, null, 2));
        return;
      }

      if (action === "add-provider") {
        const providerId = opts.provider;
        const providerType = (opts.type || "openai") as "openai" | "anthropic" | "ollama";
        const baseUrl = opts.url || (
          providerType === "openai" ? "https://api.openai.com/v1" :
          providerType === "anthropic" ? "https://api.anthropic.com" :
          "http://127.0.0.1:11434"
        );
        if (!providerId) {
          console.log("Usage: smith config add-provider --provider <id> [--url <url>] [--key-env <env>] [--type <openai|anthropic|ollama>]");
          return;
        }
        config.providers[providerId] = {
          type: providerType,
          baseUrl,
          apiKeyEnv: opts.keyEnv || undefined,
        };
        await saveConfig();
        console.log(`Provider "${providerId}" (${providerType}) added.`);
        return;
      }

      if (action === "remove-provider") {
        const providerId = opts.provider;
        if (!providerId) {
          console.log("Usage: smith config remove-provider --provider <id>");
          return;
        }
        if (providerId === "ollama") {
          console.log("Cannot remove the built-in ollama provider.");
          return;
        }
        delete config.providers[providerId];
        if (config.defaultProvider === providerId) {
          config.defaultProvider = "ollama";
        }
        await saveConfig();
        console.log(`Provider "${providerId}" removed.`);
        return;
      }

      if (action === "default-provider") {
        const providerId = keyParts?.[0];
        if (!providerId) {
          console.log(`Current default provider: ${config.defaultProvider}`);
          return;
        }
        if (providerId !== "ollama" && !config.providers[providerId]) {
          console.log(`Unknown provider: ${providerId}. Add it first with: smith config add-provider --provider ${providerId}`);
          return;
        }
        config.defaultProvider = providerId;
        await saveConfig();
        console.log(`Default provider set to "${providerId}".`);
        return;
      }

      if (action === "set") {
        if (!keyParts || keyParts.length < 2) {
          console.log("Usage: smith config set <key.path> <value>");
          return;
        }
        const keyPath = keyParts[0];
        const rawValue = keyParts.slice(1).join(" ");
        setConfigValue(config, keyPath, rawValue);
        await saveConfig();
        console.log(`Set ${keyPath} = ${JSON.stringify(getConfigValue(config, keyPath))}`);
        return;
      }

      if (action === "get") {
        const keyPath = keyParts?.[0];
        if (!keyPath) {
          console.log("Usage: smith config get <key.path>");
          return;
        }
        const value = getConfigValue(config, keyPath);
        console.log(JSON.stringify(value, null, 2));
        return;
      }

      if (action === "unset") {
        const keyPath = keyParts?.[0];
        if (!keyPath) {
          console.log("Usage: smith config unset <key.path>");
          return;
        }
        unsetConfigValue(config, keyPath);
        await saveConfig();
        console.log(`Unset ${keyPath} (reverted to default).`);
        return;
      }

      console.log(`Unknown config action: ${action}. Try: show, set, get, unset, list-providers, add-provider, remove-provider, default-provider`);
    });

  program
    .command("api")
    .description("Start agent in API mode (auto-registers with organizer)")
    .option("--host <host>", "bind address")
    .option("--port <port>", "listen port")
    .option("--token <token>", "bearer token for auth")
    .option("--root <path>", "project root directory")
    .option("--create-root", "create project root if it does not exist")
    .action(async (opts: { host?: string; port?: string; token?: string; root?: string; createRoot?: boolean }) => {
      let rootOverride: string | undefined;
      if (opts.root) {
        rootOverride = path.resolve(opts.root);
        try {
          await fs.access(rootOverride);
        } catch {
          if (opts.createRoot) {
            await fs.mkdir(rootOverride, { recursive: true });
          } else {
            console.log("Project root does not exist. Use --create-root to create it.");
            process.exit(1);
          }
        }
      }
      const { root, config, db, events } = await bootstrap(rootOverride);
      const indexer = createIndexer({ root, config, db, events });

      const host = opts.host ?? config.api.host ?? "127.0.0.1";
      const port = Number(opts.port ?? config.api.port ?? 31337);
      const token = opts.token ?? config.api.token;

      const api = await startApiServer({ root, config, db, events, indexer, host, port, token });

      console.log(`Agent Smith API listening at http://${host}:${port}`);
      console.log(`Project root: ${root}`);

      if (host === "0.0.0.0") {
        console.log(`Local URL: http://127.0.0.1:${port}`);
        const lanUrls = getLanAddresses(port);
        if (lanUrls.length > 0) {
          console.log("LAN URLs:");
          for (const u of lanUrls) console.log(`  ${u}`);
        }
        if (!token) {
          console.log("WARNING: API is reachable from your LAN without a token.");
        }
      }

      let organizerHeartbeat: { stop(): void } | null = null;
      if (config.organizer.enabled) {
        organizerHeartbeat = await startOrganizerHeartbeat({
          root, config, db,
          onLog: (msg) => console.log(msg)
        });
      }

      const shutdown = async () => {
        if (organizerHeartbeat) organizerHeartbeat.stop();
        await api.stop();
        db.close();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program
    .command("organize")
    .description("Start the organizer server (registry + dashboard on :8787)")
    .option("--host <host>", "bind address")
    .option("--port <port>", "listen port")
    .option("--token <token>", "bearer token for auth")
    .option("--db <path>", "database path")
    .option("--stale-after <ms>", "mark agents offline after ms")
    .action(async (opts: { host?: string; port?: string; token?: string; db?: string; staleAfter?: string }) => {
      const host = opts.host ?? "127.0.0.1";
      const port = Number(opts.port ?? 8787);
      const staleAfterMs = opts.staleAfter ? Number(opts.staleAfter) : 15000;

      const server = await startOrganizerServer({
        host, port, token: opts.token, dbPath: opts.db, staleAfterMs,
        onLog: (msg) => console.log(msg)
      });

      console.log(`Agent Smith Organizer listening at http://${host}:${port}`);
      console.log(`Dashboard: http://127.0.0.1:${port}/dashboard`);

      if (host === "0.0.0.0") {
        const lanUrls = getLanAddresses(port);
        if (lanUrls.length > 0) {
          console.log("LAN Dashboard URLs:");
          for (const u of lanUrls) console.log(`  ${u}/dashboard`);
        }
        if (!opts.token) {
          console.log("WARNING: Organizer is reachable from your LAN without a token.");
        }
      }

      const shutdown = async () => { await server.stop(); process.exit(0); };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program.action(async () => {
    const { root, config, db, events } = await bootstrap();

    console.clear();

    const indexer = createIndexer({ root, config, db, events });
    const watcher = createWatcher({
      root,
      config,
      events,
      onChanged: (filePath) => {
        void indexer.enqueueChangedFile(filePath);
      }
    });

    const ink = render(React.createElement(App, { root, config, db, events, indexer }));

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      try { await watcher.stop(); } catch {}
      try { ink.unmount(); await ink.waitUntilExit(); } catch {}
      try { ink.clear(); } catch {}
      process.stdout.write("\u001B[?1049l\u001B[?25h");
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGHUP", shutdown);

    void indexer.quickStartupScan();
    await watcher.start();

    try {
      await ink.waitUntilExit();
    } catch {}
    await shutdown();
  });

  return program;
}
