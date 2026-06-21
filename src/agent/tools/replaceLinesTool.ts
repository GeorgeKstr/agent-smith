import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "./toolRegistry.js";
import { buildUnifiedDiffFromEdit } from "../editDiff.js";
import { checkPatchSafety } from "../safety.js";
import { tryQueueFileOperation } from "../approval/queueOperation.js";

const MAX_CHANGED_LINES = 80;

const replaceLinesTool: AgentTool = {
  name: "replace_lines",
  description: "Replace an exact line range in one file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative project path." },
      startLine: { type: "number", description: "1-based start line." },
      endLine: { type: "number", description: "1-based end line (inclusive)." },
      newContent: { type: "string", description: "Replacement content." },
      reason: { type: "string", description: "Why this edit is needed." },
    },
    required: ["path", "startLine", "endLine", "newContent", "reason"],
  },
  mode: "patch",

  async handler(rawArgs, ctx): Promise<any> {
    const args = rawArgs as Record<string, unknown>;
    const relPath = typeof args.path === "string" ? args.path.trim() : "";
    const startLine =
      typeof args.startLine === "number" && Number.isFinite(args.startLine)
        ? Math.floor(args.startLine)
        : 0;
    const endLine =
      typeof args.endLine === "number" && Number.isFinite(args.endLine)
        ? Math.floor(args.endLine)
        : 0;
    const newContent = typeof args.newContent === "string" ? args.newContent : "";
    const reason = typeof args.reason === "string" ? args.reason : "";

    if (!relPath) return { ok: false, summary: "No path provided." };
    if (startLine < 1 || endLine < startLine) {
      return { ok: false, summary: `Invalid line range: ${startLine}-${endLine}` };
    }

    const rangeSize = endLine - startLine + 1;
    if (rangeSize > MAX_CHANGED_LINES) {
      return {
        ok: false,
        summary: `Line range too large (${rangeSize} > ${MAX_CHANGED_LINES} max).`,
      };
    }

    const fullPath = path.resolve(ctx.root, relPath);
    const rel = path.relative(ctx.root, fullPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { ok: false, summary: `Path outside project root: ${relPath}` };
    }

    // Read-before-edit enforcement
    const wasRead = ctx.memory?.filesRead?.some(
      (f) => f.path === rel || rel.endsWith("/" + f.path) || f.path.endsWith("/" + rel)
    );
    if (!wasRead) {
      return {
        ok: false,
        summary: `Cannot edit ${relPath}: file must be read first. Call 'read' on it, then retry.`,
        nextActions: [`read path="${relPath}"`],
      };
    }

    let before: string;
    try {
      before = await fs.readFile(fullPath, "utf8");
    } catch {
      return { ok: false, summary: `Cannot read file: ${relPath}` };
    }

    const lines = before.split("\n");
    if (endLine > lines.length) {
      return {
        ok: false,
        summary: `End line ${endLine} exceeds file length (${lines.length} lines).`,
      };
    }

    const beforeSlice = lines.slice(startLine - 1, endLine);
    const newLines = newContent.split("\n");

    const after = [
      ...lines.slice(0, startLine - 1),
      ...newLines,
      ...lines.slice(endLine),
    ].join("\n");

    // Build unified diff and run safety checks
    const diff = buildUnifiedDiffFromEdit({ path: rel, before, after });
    const changedLinesDelta = Math.abs(beforeSlice.length - newLines.length);
    const safety = checkPatchSafety({ root: ctx.root, config: ctx.config, files: [rel], changedLines: changedLinesDelta });
    if (!safety.ok) {
      return { ok: false, summary: `Safety check failed: ${safety.violations.join("; ")}` };
    }

    // Check if approval queuing is required
    const oldStr = beforeSlice.join("\n");
    const queueResult = await tryQueueFileOperation({
      config: ctx.config,
      root: ctx.root,
      taskId: ctx.taskId,
      kind: "replace_lines",
      path: relPath,
      beforeText: oldStr,
      afterText: newContent,
      diff,
      reason: reason || "line replacement requested",
    });

    if (queueResult.queued) {
      return queueResult.result;
    }

    try {
      await fs.writeFile(fullPath, after, "utf8");
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to write ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const oldContent = beforeSlice.join("\n");
    const newStr = newLines.join("\n");

    return {
      ok: true,
      summary: `Replaced lines ${startLine}-${endLine} in ${relPath}: ${reason} (${beforeSlice.length} → ${newLines.length} lines)`,
      content: `--- a/${relPath}\n+++ b/${relPath}\n@@ -${startLine},${beforeSlice.length} +${startLine},${newLines.length} @@\n${oldContent.split("\n").map((l) => `-${l}`).join("\n")}\n${newStr.split("\n").map((l) => `+${l}`).join("\n")}`,
      metadata: {
        path: relPath,
        startLine,
        endLine,
        oldLineCount: beforeSlice.length,
        newLineCount: newLines.length,
        reason,
      },
      nextActions: ["Run check to verify the change."],
    };
  },
};

export { replaceLinesTool, MAX_CHANGED_LINES };
