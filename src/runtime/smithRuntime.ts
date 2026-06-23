import { runAsk, runPatch } from "../agent/taskRunner.js";
import type { SmithConfig, RuntimeAction, RuntimeTaskResult } from "../types/index.js";
import type { SmithDatabase } from "../db/db.js";
import type { Indexer } from "../index/indexer.js";
import { evaluatePrompt } from "../context/intent.js";
import { classifyTask, retrieve } from "../context/retriever.js";
import { packContext } from "../context/contextPacker.js";

export type SmithRuntimeDeps = {
  root: string;
  config: SmithConfig;
  db: SmithDatabase;
  events: NodeJS.EventEmitter;
  indexer: Indexer;
};

export type RuntimeStatus = {
  root: string;
  defaultProvider: string;
  patcherModel: string;
};

function makeTaskId(): string {
  return `runtime_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createSmithRuntime(deps: SmithRuntimeDeps) {
  const { root, config, db, events, indexer } = deps;

  function getStatus(): RuntimeStatus {
    return {
      root,
      defaultProvider: config.defaultProvider,
      patcherModel: config.models.patcher
    };
  }

  async function dispatch(action: RuntimeAction): Promise<RuntimeTaskResult> {
    switch (action.kind) {
      case "ask": {
        const result = await runAsk({ db, root, config, events, indexer }, action.prompt ?? "", {
          modelOverride: action.model,
          signal: action.signal,
        });
        return {
          taskId: makeTaskId(),
          ok: result.ok,
          status: result.ok ? "completed" : "failed",
          answer: result.answer,
          message: result.message,
          packet: result.packet
        };
      }

      case "patch": {
        const apply = action.apply === true && !action.dryRun;
        const review = !apply;
        const outcome = await runPatch({ db, root, config, events, indexer }, action.prompt ?? "", {
          apply,
          review,
          modelOverride: action.model,
          taskId: action.taskId,
          signal: action.signal,
        });
        return {
          taskId: makeTaskId(),
          ok: outcome.ok,
          status: outcome.ok ? "completed" : "failed",
          answer: outcome.answer,
          diff: outcome.diff,
          files: outcome.files,
          checks: outcome.checks,
          message: outcome.message,
          data: {
            changeSetId: outcome.changeSetId,
            checkpointId: outcome.checkpointId
          }
        };
      }

      case "index": {
        await indexer.quickStartupScan();
        return {
          taskId: makeTaskId(),
          ok: true,
          status: "completed"
        };
      }

      case "reindex": {
        await indexer.reindexPaths(action.paths ?? []);
        return {
          taskId: makeTaskId(),
          ok: true,
          status: "completed"
        };
      }

      case "retrieve": {
        const task = action.prompt ?? "";
        const plan = await evaluatePrompt({
          config,
          prompt: task,
          ollamaReady: false,
          model: config.models.patcher
        });
        const classification = await classifyTask({ db, config, task });
        const retrievalResult = await retrieve({ db, root, config, task, classification });
        return {
          taskId: makeTaskId(),
          ok: true,
          status: "completed",
          message: "Retrieved context candidates.",
          data: {
            promptPlan: plan,
            classification,
            files: retrievalResult.files,
            seedSymbols: retrievalResult.seedSymbols
          }
        };
      }

      case "context": {
        const task = action.prompt ?? "";
        const plan = await evaluatePrompt({
          config,
          prompt: task,
          ollamaReady: false,
          model: config.models.patcher
        });
        const classification = await classifyTask({ db, config, task });
        const retrievalResult = await retrieve({ db, root, config, task, classification });
        const packet = await packContext({
          db,
          root,
          config,
          task,
          mode: "ask",
          classification,
          files: retrievalResult.files,
          seedSymbols: retrievalResult.seedSymbols
        });
        return {
          taskId: makeTaskId(),
          ok: true,
          status: "completed",
          message: "Built context packet.",
          packet,
          data: {
            promptPlan: plan,
            classification,
            files: retrievalResult.files,
            seedSymbols: retrievalResult.seedSymbols,
            promptPreview: packet.prompt.slice(0, 4000)
          }
        };
      }

      default: {
        return {
          taskId: makeTaskId(),
          ok: false,
          status: "failed",
          message: `Runtime action not implemented yet: ${action.kind}`
        };
      }
    }
  }

  return { dispatch, getStatus };
}
