import fs from "node:fs/promises";
import path from "node:path";
import { estimateTokens } from "./tokenEstimate.js";
import { tagName } from "../index/tags.js";
/**
 * Build a dense, token-budgeted context packet. Files are included whole when
 * small and as symbol-focused windows when large, always staying under the
 * configured prompt-token budget.
 */
export async function packContext(args) {
    const { db, root, config, task, mode, classification, files, seedSymbols } = args;
    const budget = config.context.maxPromptTokens;
    const header = buildHeader(task, mode, classification, db);
    let used = estimateTokens(header);
    const includedFiles = [];
    const segments = [];
    const symbolsByFile = groupSymbols(seedSymbols);
    const omitted = [];
    const warnings = [];
    const selected = files.slice(0, config.context.maxFiles);
    for (const file of selected) {
        if (used >= budget) {
            omitted.push({ path: file.path, reason: "budget_exceeded", estimatedTokens: budget - used });
            continue;
        }
        let content;
        try {
            content = await fs.readFile(path.join(root, file.path), "utf8");
        }
        catch {
            omitted.push({ path: file.path, reason: "failed_to_read" });
            continue;
        }
        const windows = pickWindows(content, symbolsByFile.get(file.path));
        let fileBlock = `\n### FILE: ${file.path} (${file.reasons.join(", ") || "related"})\n`;
        let fileTokens = 0;
        const includedLines = [];
        let truncated = false;
        for (const window of windows) {
            const block = "```\n" + window.text + "\n```\n";
            const cost = estimateTokens(block);
            if (used + cost > budget) {
                omitted.push({ path: file.path, reason: "budget_exceeded", estimatedTokens: cost });
                truncated = true;
                break;
            }
            fileBlock += window.label ? `// ${window.label}\n` : "";
            fileBlock += block;
            used += cost;
            fileTokens += cost;
            includedLines.push({ startLine: window.startLine, endLine: window.endLine, label: window.label });
            if (window.truncated)
                truncated = true;
        }
        if (fileBlock.includes("```")) {
            segments.push(fileBlock);
            includedFiles.push({
                path: file.path,
                reason: file.reasons.join(", ") || "related",
                tokens: fileTokens || undefined,
                includedLines: includedLines.length > 0 ? includedLines : undefined,
                truncated: truncated || undefined
            });
        }
    }
    if (includedFiles.length === 0) {
        warnings.push("No files selected for context.");
    }
    if (seedSymbols.length === 0) {
        warnings.push("No seed symbols selected.");
    }
    if (omitted.some((o) => o.reason === "budget_exceeded")) {
        warnings.push("Some files or code windows were omitted because the context budget was reached.");
    }
    if (mode === "patch" && !selected.some((f) => f.isTest) && config.context.includeTests) {
        warnings.push("No tests were included in patch context.");
    }
    const prompt = `${header}\n## CODE SEGMENTS${segments.join("\n")}\n${footer(mode)}`;
    const symbols = seedSymbols.map((s) => ({
        name: s.name,
        path: s.path,
        kind: s.kind,
        startLine: s.startLine,
        endLine: s.endLine
    }));
    return {
        task,
        prompt,
        estimatedTokens: estimateTokens(prompt),
        files: includedFiles,
        symbols,
        omitted: omitted.length > 0 ? omitted : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
    };
}
function buildHeader(task, mode, classification, db) {
    const tags = classification.tagIds.map((id) => tagName(id)).join(", ") || "(none)";
    const projectTags = db
        .prepare("SELECT t.name AS name, COUNT(*) AS c FROM file_tags ft JOIN tags t ON t.id = ft.tag_id GROUP BY t.id ORDER BY c DESC LIMIT 10")
        .all()
        .map((r) => `${r.name}(${r.c})`)
        .join(", ");
    const rules = mode === "patch"
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
function footer(mode) {
    return mode === "patch"
        ? "## OUTPUT\nReturn the unified diff now:"
        : "## OUTPUT\nAnswer now:";
}
function groupSymbols(seedSymbols) {
    const map = new Map();
    for (const s of seedSymbols) {
        const list = map.get(s.path) ?? [];
        list.push({ startLine: s.startLine, endLine: s.endLine, name: s.name });
        map.set(s.path, list);
    }
    return map;
}
const SMALL_FILE_LINES = 220;
function pickWindows(content, symbols) {
    const lines = content.split("\n");
    if (lines.length <= SMALL_FILE_LINES || !symbols || symbols.length === 0) {
        const end = Math.min(lines.length, 600);
        return [{ text: lines.slice(0, 600).join("\n"), startLine: 1, endLine: end, truncated: lines.length > 600 }];
    }
    const windows = [];
    for (const sym of symbols.slice(0, 4)) {
        const start = Math.max(0, sym.startLine - 3);
        const end = Math.min(lines.length, sym.endLine + 2);
        windows.push({ text: lines.slice(start, end).join("\n"), label: `symbol ${sym.name} (lines ${start + 1}-${end})`, startLine: start + 1, endLine: end });
    }
    return windows;
}
