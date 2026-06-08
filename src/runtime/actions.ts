export type { RuntimeAction, RuntimeActionKind, RuntimeTaskStatus, RuntimeTaskResult } from "../types/index.js";

export function actionLabel(kind: string): string {
  const map: Record<string, string> = {
    ask: "Ask",
    patch: "Patch",
    retrieve: "Retrieve",
    context: "Context",
    inspect: "Inspect",
    graph: "Graph",
    index: "Index",
    reindex: "Re-index",
    check: "Check",
    smoke: "Smoke test",
    "setup-check": "Setup"
  };
  return map[kind] ?? kind;
}
