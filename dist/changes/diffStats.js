import { parseUnifiedDiff } from "./diffParser.js";
export function parseDiffChangedFiles(diff) {
    const parsed = parseUnifiedDiff(diff);
    return parsed.files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions
    }));
}
