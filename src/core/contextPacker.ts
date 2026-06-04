import fs from "node:fs/promises";
import path from "node:path";
import type { SmithConfig, ScoredFile, TaskClassification, ContextPacket } from "../types/index.js";
import type { SmithDatabase } from "./db.js";
import { estimateTokens } from "./tokenEstimate.js";
import { tagName } from "./tags.js";

type PackArgs = {
  db: SmithDatabase;
  root: string;
  config: SmithConfig;
  task: string;
  mode: "ask" | "patch";
  classification: TaskClassification;
  files: ScoredFile[];
  seedSymbols: Array<{ name: string; path: string; kind: string; startLine: number; endLine: number }>;
};

/**
 * Build a dense, token-budgeted context packet. Files are included whole when
 * small and as symbol-focused windows when large, always staying under the
 * configured prompt-token budget.
 */
export async function packContext(args: PackArgs): Promise<ContextPacket> {
  const { db, root, config, task, mode, classification, files, seedSymbols } = args;
  const budget = config.context.maxPromptTokens;

  const header = buildHeader(task, mode, classification, db);
  let used = estimateTokens(header);

  const includedFiles: ContextPacket["files"] = [];
  const segments: string[] = [];
  const symbolsByFile = groupSymbols(seedSymbols);

  const selected = files.slice(0, config.context.maxFiles);
  for (const file of selected) {
    if (used >= budget) break;
    let content: string;
    try {
      content = await fs.readFile(path.join(root, file.path), "utf8");
    } catch {
      continue;
    }

    const windows = pickWindows(content, symbolsByFile.get(file.path));
    let fileBlock = `\n### FILE: ${file.path} (${file.reasons.join(", ") || "related"})\n`;

    for (const window of windows) {
      const block = "```\n" + window.text + "\n```\n";
      const cost = estimateTokens(block);
      if (used + cost > budget) break;
      fileBlock += window.label ? `// ${window.label}\n` : "";
      fileBlock += block;
      used += cost;
    }

    segments.push(fileBlock);
    includedFiles.push({ path: file.path, reason: file.reasons.join(", ") || "related" });
  }

  const prompt = `${header}\n## CODE SEGMENTS${segments.join("\n")}\n${footer(mode)}`;

  return {
    task,
    prompt,
    estimatedTokens: estimateTokens(prompt),
    files: includedFiles,
    symbols: seedSymbols.map((s) => ({ name: s.name, path: s.path, kind: s.kind }))
  };
}

function buildHeader(task: string, mode: "ask" | "patch", classification: TaskClassification, db: SmithDatabase): string {
  const tags = classification.tagIds.map((id) => tagName(id)).join(", ") || "(none)";
  const projectTags = (
    db
      .prepare(
        "SELECT t.name AS name, COUNT(*) AS c FROM file_tags ft JOIN tags t ON t.id = ft.tag_id GROUP BY t.id ORDER BY c DESC LIMIT 10"
      )
      .all() as Array<{ name: string; c: number }>
  )
    .map((r) => `${r.name}(${r.c})`)
    .join(", ");

  const rules =
    mode === "patch"
      ? `## RULES
- Return ONLY a unified diff (git format) and nothing else.
- Use real file paths from the SELECTED FILES.
- Do not include explanations, markdown fences, or prose.
- Keep the change minimal and focused on the task.`
      : `## RULES
- Answer the question using ONLY the provided code.
- Reference concrete file paths and symbols.
- Be concise and specific.`;

  return `## TASK
${task}

${rules}

## TASK TAGS
${tags}

## PROJECT TAGS
${projectTags || "(indexing in progress)"}

## SELECTED FILES
${classification.likelyFiles.length ? classification.likelyFiles.join(", ") : "(scored by retrieval)"}
`;
}

function footer(mode: "ask" | "patch"): string {
  return mode === "patch"
    ? "## OUTPUT\nReturn the unified diff now:"
    : "## OUTPUT\nAnswer now:";
}

function groupSymbols(
  seedSymbols: PackArgs["seedSymbols"]
): Map<string, Array<{ startLine: number; endLine: number; name: string }>> {
  const map = new Map<string, Array<{ startLine: number; endLine: number; name: string }>>();
  for (const s of seedSymbols) {
    const list = map.get(s.path) ?? [];
    list.push({ startLine: s.startLine, endLine: s.endLine, name: s.name });
    map.set(s.path, list);
  }
  return map;
}

const SMALL_FILE_LINES = 220;

function pickWindows(
  content: string,
  symbols?: Array<{ startLine: number; endLine: number; name: string }>
): Array<{ text: string; label?: string }> {
  const lines = content.split("\n");
  if (lines.length <= SMALL_FILE_LINES || !symbols || symbols.length === 0) {
    return [{ text: lines.slice(0, 600).join("\n") }];
  }

  const windows: Array<{ text: string; label?: string }> = [];
  for (const sym of symbols.slice(0, 4)) {
    const start = Math.max(0, sym.startLine - 3);
    const end = Math.min(lines.length, sym.endLine + 2);
    windows.push({ text: lines.slice(start, end).join("\n"), label: `symbol ${sym.name} (lines ${start + 1}-${end})` });
  }
  return windows;
}
