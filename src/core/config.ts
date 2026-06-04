import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SmithConfig } from "../types/index.js";

const configSchema = z.object({
  models: z.object({
    tagger: z.string(),
    summarizer: z.string(),
    patcher: z.string(),
    debugger: z.string()
  }),
  ollama: z.object({
    baseUrl: z.string(),
    temperature: z.number(),
    numPredict: z.number()
  }),
  index: z.object({
    watch: z.boolean(),
    debounceMs: z.number(),
    workerCount: z.number(),
    summaryConcurrency: z.number(),
    ignore: z.array(z.string())
  }),
  context: z.object({
    maxPromptTokens: z.number(),
    maxFiles: z.number(),
    maxSymbols: z.number(),
    graphDepth: z.number(),
    includeTests: z.boolean(),
    includeTypes: z.boolean(),
    includeSummaries: z.boolean()
  }),
  commands: z.object({
    test: z.string(),
    typecheck: z.string(),
    lint: z.string(),
    build: z.string()
  }),
  safety: z.object({
    forbiddenPaths: z.array(z.string()),
    confirmShellCommands: z.boolean(),
    maxPatchFiles: z.number(),
    maxPatchLines: z.number()
  }),
  theme: z.object({
    mode: z.literal("matrix"),
    showBootAnimation: z.boolean(),
    animations: z.boolean()
  })
});

const DEFAULT_CONFIG: SmithConfig = {
  models: {
    tagger: "qwen2.5-coder:3b-16k",
    summarizer: "qwen2.5-coder:3b-16k",
    patcher: "qwen2.5-coder:7b-8k",
    debugger: "deepseek-r1:7b-8k"
  },
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    temperature: 0,
    numPredict: 2048
  },
  index: {
    watch: true,
    debounceMs: 350,
    workerCount: 2,
    summaryConcurrency: 1,
    ignore: [
      "node_modules",
      "dist",
      "build",
      ".git",
      ".next",
      "coverage",
      "target",
      ".agent",
      "vendor"
    ]
  },
  context: {
    maxPromptTokens: 8000,
    maxFiles: 6,
    maxSymbols: 20,
    graphDepth: 2,
    includeTests: true,
    includeTypes: true,
    includeSummaries: true
  },
  commands: {
    test: "npm test",
    typecheck: "npm run typecheck",
    lint: "npm run lint",
    build: "npm run build"
  },
  safety: {
    forbiddenPaths: [".env", ".env.local", ".npmrc", "secrets", "id_rsa"],
    confirmShellCommands: true,
    maxPatchFiles: 6,
    maxPatchLines: 500
  },
  theme: {
    mode: "matrix",
    showBootAnimation: true,
    animations: true
  }
};

export async function ensureConfig(root: string): Promise<void> {
  const agentDir = path.join(root, ".agent");
  const configPath = path.join(agentDir, "config.json");
  await fs.mkdir(agentDir, { recursive: true });

  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
  }
}

export async function loadConfig(root: string): Promise<SmithConfig> {
  const configPath = path.join(root, ".agent", "config.json");
  const raw = await fs.readFile(configPath, "utf8");
  return configSchema.parse(JSON.parse(raw));
}
