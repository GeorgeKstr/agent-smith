import type { ToolContext, ToolResult } from "../tools/toolRegistry.js";
import type { SmithConfig } from "../../types/index.js";
import type { FileOperationKind } from "./approvalTypes.js";
import { shouldQueueFileOperation, riskForKind } from "./approvalTypes.js";
import { getApprovalStore } from "./approvalStore.js";
import { buildOperationFromEditInput } from "./applyOperation.js";

export type QueueResult = {
  queued: true;
  result: ToolResult;
};

export async function tryQueueFileOperation(ctx: {
  config: SmithConfig;
  root: string;
  taskId?: string;
  kind: FileOperationKind;
  path: string;
  beforeText?: string;
  afterText?: string;
  diff?: string;
  reason: string;
}): Promise<QueueResult | { queued: false }> {
  const policy = ctx.config.approval?.policy ?? "on_write";
  const risk = riskForKind(ctx.kind);

  if (!shouldQueueFileOperation({ policy, kind: ctx.kind, risk })) {
    return { queued: false };
  }

  const store = getApprovalStore(ctx.root);
  const op = buildOperationFromEditInput({
    kind: ctx.kind,
    path: ctx.path,
    beforeText: ctx.beforeText,
    afterText: ctx.afterText,
    diff: ctx.diff,
    reason: ctx.reason,
    taskId: ctx.taskId,
  });

  const created = await store.create(op);

  return {
    queued: true,
    result: {
      ok: true,
      summary: `Queued ${ctx.kind} for approval: ${ctx.path}`,
      content: [
        `Pending operation:`,
        `  id: ${created.id}`,
        `  kind: ${ctx.kind}`,
        `  path: ${ctx.path}`,
        ctx.diff ? `\nDiff:\n${ctx.diff.slice(0, 800)}` : "",
        `\nThis operation has been queued and requires user approval before it is applied.`,
      ].filter(Boolean).join("\n"),
      metadata: {
        pendingOperationId: created.id,
        queued: true,
        kind: ctx.kind,
        path: ctx.path,
      },
      nextActions: [
        "User must approve or reject this operation.",
        `CLI: smith approvals approve ${created.id}`,
        `CLI: smith approvals reject ${created.id}`,
      ],
    },
  };
}
