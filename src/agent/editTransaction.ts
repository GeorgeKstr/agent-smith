import fs from "node:fs/promises";
import path from "node:path";
import type { SmithConfig } from "../types/index.js";
import type { SmithDatabase } from "../db/db.js";
import { buildUnifiedDiffFromEdit } from "./editDiff.js";
import { checkPatchSafety } from "./safety.js";

export async function applyEditTransaction(input: {
  root: string;
  path: string;
  before: string;
  after: string;
  reason: string;
  config: SmithConfig;
  db: SmithDatabase;
}): Promise<{
  ok: boolean;
  diff?: string;
  summary: string;
}> {
  const { root, path: relPath, before, after, reason, config } = input;
  const fullPath = path.resolve(root, relPath);
  const rel = path.relative(root, fullPath);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      summary: `Path outside project root: ${relPath}`,
    };
  }

  const diff = buildUnifiedDiffFromEdit({
    path: rel,
    before,
    after,
  });

  const files = [rel];
  const changedLines = Math.abs(
    before.split("\n").length - after.split("\n").length
  );

  const safety = checkPatchSafety({
    root,
    config,
    files,
    changedLines,
  });
  if (!safety.ok) {
    return {
      ok: false,
      diff,
      summary: `Safety check failed: ${safety.violations.join("; ")}`,
    };
  }

  try {
    await fs.writeFile(fullPath, after, "utf8");
  } catch (err) {
    return {
      ok: false,
      diff,
      summary: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    ok: true,
    diff,
    summary: `Applied edit to ${rel}: ${reason}`,
  };
}
