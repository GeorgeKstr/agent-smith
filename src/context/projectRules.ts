import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type ProjectRules = {
  agentsFiles: Array<{ path: string; content: string }>;
  systemOverride?: string;
  rendered: string;
};

const MAX_RULES_TOKENS = 1200;

export async function loadProjectRules(input: {
  root: string;
  cwd?: string;
  home?: string;
}): Promise<ProjectRules> {
  const home = input.home ?? os.homedir();
  const cwd = input.cwd ?? input.root;
  const root = input.root;

  const candidates = [
    path.join(home, ".agent", "AGENTS.md"),
    path.join(root, "AGENTS.md"),
    path.join(cwd, "AGENTS.md"),
    path.join(root, ".agent", "SYSTEM.md"),
  ];

  const seen = new Set<string>();
  const agentsFiles: Array<{ path: string; content: string }> = [];
  let systemOverride: string | undefined;

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    try {
      const content = await fs.readFile(normalized, "utf8");
      if (!content.trim()) continue;

      if (normalized.endsWith("SYSTEM.md")) {
        systemOverride = content.trim();
      } else {
        agentsFiles.push({ path: normalized, content: content.trim() });
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  const parts: string[] = [];
  for (const file of agentsFiles) {
    parts.push(`## Rules from ${path.relative(root, file.path)}\n${file.content}`);
  }

  let rendered = parts.join("\n\n").slice(0, MAX_RULES_TOKENS * 4);
  if (systemOverride) {
    rendered = systemOverride.slice(0, MAX_RULES_TOKENS * 4);
  }

  return {
    agentsFiles,
    systemOverride,
    rendered,
  };
}
