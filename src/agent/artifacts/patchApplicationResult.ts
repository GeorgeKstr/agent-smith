export type PatchApplicationResult = {
  changed: boolean;
  filesEdited: string[];
  filesCreated: string[];
  failedEdits: Array<{
    path: string;
    reason: string;
  }>;
};

export function emptyApplicationResult(): PatchApplicationResult {
  return {
    changed: false,
    filesEdited: [],
    filesCreated: [],
    failedEdits: [],
  };
}

export function buildApplicationResult(input: {
  filesEdited: string[];
  filesCreated: string[];
  toolResults: Array<{ tool: string; ok: boolean; summary: string }>;
}): PatchApplicationResult {
  const failed = input.toolResults
    .filter(
      (r) =>
        !r.ok &&
        (r.tool === "edit" ||
          r.tool === "replace_lines" ||
          r.tool === "create_file")
    )
    .map((r) => ({
      path: r.summary.includes(":") ? r.summary.split(":")[0] : "unknown",
      reason: r.summary,
    }));

  return {
    changed:
      input.filesEdited.length > 0 || input.filesCreated.length > 0,
    filesEdited: [...input.filesEdited],
    filesCreated: [...input.filesCreated],
    failedEdits: failed,
  };
}
