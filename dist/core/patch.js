/**
 * Validate that a model response is a usable unified diff and extract the set of
 * files it touches. Strips accidental ``` fences first.
 */
export function validateUnifiedDiff(rawDiff) {
    const errors = [];
    const diff = stripFences(rawDiff).trim();
    if (!diff) {
        return { ok: false, errors: ["empty diff"], files: [] };
    }
    const hasGitHeader = /^diff --git /m.test(diff);
    const hasMarkers = /^\+\+\+ /m.test(diff) && /^--- /m.test(diff);
    const hasHunks = /^@@ /m.test(diff);
    if (!hasGitHeader && !hasMarkers)
        errors.push("missing diff headers (--- / +++ or 'diff --git')");
    if (!hasHunks)
        errors.push("missing hunk header (@@)");
    const files = extractDiffFiles(diff);
    if (files.length === 0)
        errors.push("no target files found in diff");
    return { ok: errors.length === 0, errors, files };
}
/** Remove the surrounding ```diff ... ``` fence if the model added one. */
export function stripFences(text) {
    const fence = text.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
    return fence ? fence[1] : text;
}
/** Collect normalized file paths referenced by a unified diff. */
export function extractDiffFiles(diff) {
    const files = new Set();
    const cleaned = stripFences(diff);
    for (const line of cleaned.split("\n")) {
        let match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (match) {
            files.add(normalize(match[2]));
            continue;
        }
        match = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
        if (match && match[1] !== "/dev/null") {
            files.add(normalize(match[1].replace(/\t.*$/, "")));
            continue;
        }
        match = line.match(/^--- (?:a\/)?(.+)$/);
        if (match && match[1] !== "/dev/null") {
            files.add(normalize(match[1].replace(/\t.*$/, "")));
        }
    }
    return [...files];
}
function normalize(p) {
    return p.replace(/^\.\//, "").trim();
}
/** Count added/removed lines for size-limit enforcement. */
export function countChangedLines(diff) {
    let count = 0;
    for (const line of stripFences(diff).split("\n")) {
        if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
            count++;
        }
    }
    return count;
}
