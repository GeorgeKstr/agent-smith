import { parseUnifiedDiff } from "./diffParser.js";
export function buildAcceptedHunksDiff(args) {
    const { originalDiff, acceptedHunks } = args;
    if (!originalDiff || !originalDiff.trim())
        return "";
    if (acceptedHunks.length === 0)
        return "";
    const parsed = parseUnifiedDiff(originalDiff);
    const acceptedByFile = new Map();
    for (const ref of acceptedHunks) {
        const set = acceptedByFile.get(ref.path) ?? new Set();
        set.add(ref.hunkIndex);
        acceptedByFile.set(ref.path, set);
    }
    const result = [];
    for (const file of parsed.files) {
        const accepted = acceptedByFile.get(file.path);
        if (!accepted || accepted.size === 0)
            continue;
        // Preserve file header block
        const headerLines = [];
        for (const line of file.headerLines) {
            headerLines.push(line);
        }
        // Include only accepted hunks
        const hunkBlocks = [];
        for (let i = 0; i < file.hunks.length; i++) {
            if (accepted.has(i)) {
                const hunk = file.hunks[i];
                if (hunk.raw) {
                    hunkBlocks.push(hunk.raw);
                }
                else {
                    // Fallback: reconstruct from header + lines
                    const blockLines = [hunk.header];
                    for (const l of hunk.lines) {
                        const prefix = l.type === "add" ? "+" : l.type === "delete" ? "-" : l.type === "context" ? " " : "";
                        blockLines.push(prefix + l.text);
                    }
                    hunkBlocks.push(blockLines.join("\n"));
                }
            }
        }
        if (hunkBlocks.length === 0)
            continue;
        // Reconstruct file diff block
        const fileBlock = [
            `diff --git a/${file.path} b/${file.path}`,
            ...headerLines,
            ...hunkBlocks
        ];
        result.push(fileBlock.join("\n"));
    }
    return result.join("\n");
}
