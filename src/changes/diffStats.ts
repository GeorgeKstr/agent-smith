import { parseUnifiedDiff } from "./diffParser.js";

export function parseDiffChangedFiles(diff: string): Array<{ path: string; additions: number; deletions: number }> {
  const parsed = parseUnifiedDiff(diff);
  return parsed.files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions
  }));
}
