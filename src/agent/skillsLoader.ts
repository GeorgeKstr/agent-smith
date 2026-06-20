import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Skill, AgentExtension } from "./extensionPoints.js";
import type { AgentTool } from "./tools/toolRegistry.js";

export type LoadedSkills = {
  skills: Skill[];
  extensions: AgentExtension[];
  rendered: string;
  loadedPaths: string[];
};

const MAX_SKILL_TOKENS = 800;

function parseSkillFile(content: string, filePath: string): Skill | null {
  const lines = content.split("\n");
  if (lines.length < 2) return null;

  let name = "";
  let description = "";
  const triggers: string[] = [];
  const bodyLines: string[] = [];
  let inBody = false;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      name = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("### ")) {
      if (!name) name = line.replace(/^#+\s*/, "").trim();
      inBody = true;
      continue;
    }
    if (line.startsWith("- trigger:") || line.startsWith("- triggers:")) {
      const t = line.split(":")[1]?.trim();
      if (t) triggers.push(t);
      continue;
    }
    if (line.startsWith("  - ")) {
      if (!inBody) {
        const t = line.replace(/^\s*-\s*/, "").trim();
        triggers.push(t);
      } else {
        bodyLines.push(line);
      }
      continue;
    }
    if (!inBody && line.length < 120 && !line.startsWith("-")) {
      if (!description) description = line.trim();
      else if (triggers.length < 6) triggers.push(line.trim());
      continue;
    }
    bodyLines.push(line);
  }

  if (!name) return null;

  const body = bodyLines.join("\n").trim();
  if (!body && description) {
    return {
      name,
      description: description || name,
      triggers: triggers.length > 0 ? triggers : [],
      prompt: description,
    };
  }

  return {
    name,
    description: description || name,
    triggers: triggers.length > 0 ? triggers : [name.toLowerCase()],
    prompt: body || description || name,
  };
}

export async function loadSkills(input: {
  root: string;
  home?: string;
}): Promise<LoadedSkills> {
  const home = input.home ?? os.homedir();
  const root = input.root;

  const skillDirs = [
    path.join(root, ".smith", "skills"),
    path.join(root, ".agent", "skills"),
    path.join(home, ".smith", "skills"),
  ];

  const skills: Skill[] = [];
  const loadedPaths: string[] = [];

  for (const dir of skillDirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const entryName of entries) {
      if (!entryName.endsWith(".md")) continue;
      const filePath = path.join(dir, entryName);

      try {
        const content = await fs.readFile(filePath, "utf8");
        const skill = parseSkillFile(content, filePath);
        if (skill) {
          skill.name = `${path.basename(entryName, ".md")}: ${skill.name}`;
          skills.push(skill);
          loadedPaths.push(filePath);
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  const rendered = skills.length > 0
    ? skills
        .map((s) => `### Skill: ${s.name}\n${s.prompt.slice(0, MAX_SKILL_TOKENS * 4)}`)
        .join("\n\n")
    : "";

  return {
    skills,
    extensions: [],
    rendered: rendered.slice(0, MAX_SKILL_TOKENS * 4 * skills.length),
    loadedPaths,
  };
}

export function findRelevantSkills(
  skills: Skill[],
  task: string,
  maxSkills: number = 3,
): Skill[] {
  const lower = task.toLowerCase();
  const scored = skills
    .map((s) => {
      let score = 0;
      for (const trigger of s.triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          score += trigger.length >= 5 ? 3 : 1;
        }
      }
      return { skill: s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxSkills).map((s) => s.skill);
}

export function renderSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines: string[] = ["## RELEVANT SKILLS"];
  for (const skill of skills) {
    lines.push(`\n### ${skill.name}`);
    if (skill.description && skill.description !== skill.prompt) {
      lines.push(`${skill.description}`);
    }
    lines.push(skill.prompt.slice(0, MAX_SKILL_TOKENS * 4));
  }

  return lines.join("\n").slice(0, MAX_SKILL_TOKENS * 4 * (skills.length + 1));
}
