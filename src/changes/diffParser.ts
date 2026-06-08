export type ParsedDiffLine = {
  type: "context" | "add" | "delete" | "meta";
  oldLine?: number;
  newLine?: number;
  text: string;
};

export type ParsedDiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: ParsedDiffLine[];
  raw?: string;
};

export type ParsedDiffFile = {
  oldPath: string | null;
  newPath: string | null;
  path: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  isRename: boolean;
  additions: number;
  deletions: number;
  headerLines: string[];
  hunks: ParsedDiffHunk[];
  raw: string;
};

export type ParsedDiff = {
  files: ParsedDiffFile[];
};

export function getDiffFilePath(oldPath: string | null, newPath: string | null): string {
  if (newPath && newPath !== "/dev/null") return normalizeDiffPath(newPath);
  if (oldPath && oldPath !== "/dev/null") return normalizeDiffPath(oldPath);
  return "";
}

export function normalizeDiffPath(p: string): string {
  return p.replace(/^[ab]\//, "");
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.split("\n");
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | null = null;
    let currentHunk: ParsedDiffHunk | null = null;
    const hunkRawLines: string[] = [];
    let inHunk = false;
    let oldLine = 0;
  let newLine = 0;
  const rawLines: string[] = [];

  function flushFile() {
    if (current) {
      current.raw = rawLines.join("\n");
      files.push(current);
      rawLines.length = 0;
    }
    current = null;
    currentHunk = null;
  }

  function flushHunk() {
    if (current && currentHunk) {
      if (inHunk) {
        currentHunk.raw = hunkRawLines.join("\n");
        hunkRawLines.length = 0;
        inHunk = false;
      }
      current.hunks.push(currentHunk);
      current.additions = current.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0);
      current.deletions = current.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "delete").length, 0);
    }
    currentHunk = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // New file block
    if (trimmed.startsWith("diff --git ")) {
      flushHunk();
      flushFile();

      const match = trimmed.match(/diff --git a\/(.*) b\/(.*)/);
      if (match) {
        const rawOld = match[1];
        const rawNew = match[2];
        const oldPath = rawOld !== "/dev/null" ? normalizeDiffPath(rawOld) : null;
        const newPath = rawNew !== "/dev/null" ? normalizeDiffPath(rawNew) : null;
        current = {
          oldPath,
          newPath,
          path: newPath ?? oldPath ?? "",
          isNewFile: rawOld === "/dev/null",
          isDeletedFile: rawNew === "/dev/null",
          isRename: false,
          additions: 0,
          deletions: 0,
          headerLines: [],
          hunks: [],
          raw: ""
        };
      }
      rawLines.push(line);
      continue;
    }

    if (!current) {
      rawLines.push(line);
      continue;
    }

    rawLines.push(line);

    // Metadata lines (accumulate before first hunk)
    const isMeta =
      trimmed.startsWith("new file mode") ||
      trimmed.startsWith("deleted file mode") ||
      trimmed.startsWith("old mode") ||
      trimmed.startsWith("new mode") ||
      trimmed.startsWith("index ") ||
      trimmed.startsWith("--- ") ||
      trimmed.startsWith("+++ ") ||
      trimmed.startsWith("similarity index") ||
      trimmed.startsWith("rename from") ||
      trimmed.startsWith("rename to") ||
      trimmed.startsWith("copy from") ||
      trimmed.startsWith("copy to") ||
      trimmed.startsWith("Binary files");

    if (isMeta) {
      if (trimmed.startsWith("rename from")) {
        current.isRename = true;
      }
      current.headerLines.push(line);
      continue;
    }

    // Hunk header
    const hunkMatch = HUNK_RE.exec(trimmed);
    if (hunkMatch) {
      flushHunk();
      inHunk = true;
      hunkRawLines.push(line);
      currentHunk = {
        header: trimmed,
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: []
      };
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }

    // Hunk content lines
    if (currentHunk) {
      hunkRawLines.push(line);
      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "add", newLine, text: line.slice(1) });
        newLine++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "delete", oldLine, text: line.slice(1) });
        oldLine++;
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({ type: "context", oldLine, newLine, text: line.slice(1) });
        oldLine++;
        newLine++;
      } else {
        currentHunk.lines.push({ type: "meta", text: line });
      }
    }
  }

  flushHunk();
  flushFile();

  return { files };
}
