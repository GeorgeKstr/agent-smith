import { parseUnifiedDiff, normalizeDiffPath } from "./diffParser.js";
export function extractFileDiff(diff, filePath) {
    if (!diff || !diff.trim())
        return "";
    const parsed = parseUnifiedDiff(diff);
    const normalized = normalizeDiffPath(filePath);
    const file = parsed.files.find((f) => f.path === normalized);
    return file?.raw ?? "";
}
export function compactDiffPreview(diff, maxLines = 60) {
    if (!diff || !diff.trim())
        return "(empty diff)";
    const lines = diff.split("\n");
    const preview = [];
    let inHunk = false;
    let contextCount = 0;
    for (let i = 0; i < lines.length && preview.length < maxLines; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Always include file/hunk headers
        if (trimmed.startsWith("diff --git ") || trimmed.startsWith("--- ") || trimmed.startsWith("+++ ") || trimmed.startsWith("@@ ")) {
            preview.push(line);
            inHunk = trimmed.startsWith("@@ ");
            contextCount = 0;
            continue;
        }
        // In a hunk, keep changed lines and slim context
        if (inHunk) {
            if (line.startsWith("+") || line.startsWith("-")) {
                preview.push(line);
                contextCount = 0;
            }
            else if (contextCount < 1) {
                if (contextCount === 0 && preview.length > 0) {
                    preview.push(line);
                }
                contextCount++;
            }
        }
        else {
            preview.push(line);
        }
    }
    if (preview.length >= maxLines || (lines.length > 0 && preview.length < lines.length)) {
        preview.push("... diff preview truncated ...");
    }
    return preview.join("\n");
}
