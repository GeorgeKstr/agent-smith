import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SmithConfig } from "../types/index.js";

const providerEntrySchema = z.object({
  type: z.enum(["ollama", "openai", "anthropic"]),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional()
});

const configSchema = z.object({
  models: z.object({
    tagger: z.string(),
    summarizer: z.string(),
    patcher: z.string(),
    debugger: z.string()
  }),
  providers: z.record(z.string(), providerEntrySchema).optional(),
  defaultProvider: z.string().optional(),
  ollama: z.object({
    baseUrl: z.string(),
    temperature: z.number(),
    numPredict: z.number()
  }),
  options: z.object({
    temperature: z.number(),
    numPredict: z.number()
  }).optional(),
  index: z.object({
    watch: z.boolean(),
    debounceMs: z.number(),
    workerCount: z.number(),
    summaryConcurrency: z.number(),
    ignore: z.array(z.string()),
    fileCards: z.boolean().optional(),
    fileCardModel: z.string().optional(),
    fileCardConcurrency: z.number().optional()
  }),
  context: z.object({
    maxPromptTokens: z.number(),
    maxFiles: z.number(),
    maxSymbols: z.number(),
    graphDepth: z.number(),
    includeTests: z.boolean(),
    includeTypes: z.boolean(),
    includeSummaries: z.boolean(),
    maxLiveCodeTokens: z.number().optional(),
    maxToolHistoryTokens: z.number().optional(),
    maxFileCards: z.number().optional(),
    maxReadLines: z.number().optional(),
    maxSearchResults: z.number().optional(),
    compactAfterToolCalls: z.number().optional(),
    compactAtTokenRatio: z.number().optional(),
    maxLeads: z.number().optional(),
    maxEvidencePerLead: z.number().optional(),
    maxEvidenceTextChars: z.number().optional()
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
  lan: z.object({
    port: z.number()
  }).optional(),
  api: z.object({
    enabled: z.boolean(),
    host: z.string(),
    port: z.number(),
    token: z.string().optional(),
    allowLan: z.boolean()
  }).optional(),
  compatibility: z.object({
    mode: z.enum(["auto", "small-local", "large-model", "cloud-agent"]),
    toolMode: z.enum(["auto", "diff_only", "json_protocol", "native_tools"]),
    preferNativeToolsForLargeModels: z.boolean(),
    preferDiffOnlyForLocalModels: z.boolean()
  }).optional(),
  toolCallingMode: z.enum(["local_text", "native_provider", "auto"]).optional(),
  conversationMode: z.enum(["compact_rebuild", "full_history"]).optional(),
  organizer: z.object({
    enabled: z.boolean(),
    url: z.string(),
    token: z.string().optional(),
    agentId: z.string().optional(),
    agentName: z.string().optional(),
    heartbeatMs: z.number(),
    apiBaseUrl: z.string().optional()
  }).optional(),
  theme: z.object({
    mode: z.literal("matrix"),
    showBootAnimation: z.boolean(),
    animations: z.boolean()
  })
});

export const DEFAULT_CONFIG: SmithConfig = {
  models: {
    tagger: "qwen2.5-coder:3b-16k",
    summarizer: "qwen2.5-coder:3b-16k",
    patcher: "qwen2.5-coder:7b-8k",
    debugger: "deepseek-r1:7b-8k"
  },
  providers: {},
  defaultProvider: "ollama",
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    temperature: 0,
    numPredict: 4096
  },
  options: {
    temperature: 0,
    numPredict: 4096
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
    ],
    fileCards: false,
    fileCardModel: "",
    fileCardConcurrency: 2
  },
  context: {
    maxPromptTokens: 8000,
    maxFiles: 6,
    maxSymbols: 20,
    graphDepth: 2,
    includeTests: true,
    includeTypes: true,
    includeSummaries: true,
    maxLiveCodeTokens: 2500,
    maxToolHistoryTokens: 1000,
    maxFileCards: 8,
    maxReadLines: 160,
    maxSearchResults: 8,
    compactAfterToolCalls: 6,
    compactAtTokenRatio: 0.65,
    maxLeads: 12,
    maxEvidencePerLead: 4,
    maxEvidenceTextChars: 240
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
  lan: {
    port: 3000
  },
  api: {
    enabled: false,
    host: "127.0.0.1",
    port: 31337,
    allowLan: false
  },
  compatibility: {
    mode: "auto",
    toolMode: "auto",
    preferNativeToolsForLargeModels: true,
    preferDiffOnlyForLocalModels: true
  },
  toolCallingMode: "local_text",
  conversationMode: "compact_rebuild",
  organizer: {
    enabled: true,
    url: "http://127.0.0.1:8787",
    heartbeatMs: 5000
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
  const parsed = configSchema.parse(JSON.parse(raw));
  return {
    ...parsed,
    index: {
      ...parsed.index,
      fileCards: parsed.index.fileCards ?? false,
      fileCardModel: parsed.index.fileCardModel ?? "",
      fileCardConcurrency: parsed.index.fileCardConcurrency ?? 2,
    },
    context: {
      ...parsed.context,
      maxLiveCodeTokens: parsed.context.maxLiveCodeTokens ?? 2500,
      maxToolHistoryTokens: parsed.context.maxToolHistoryTokens ?? 1000,
      maxFileCards: parsed.context.maxFileCards ?? 8,
      maxReadLines: parsed.context.maxReadLines ?? 160,
      maxSearchResults: parsed.context.maxSearchResults ?? 8,
      compactAfterToolCalls: parsed.context.compactAfterToolCalls ?? 6,
      compactAtTokenRatio: parsed.context.compactAtTokenRatio ?? 0.65,
      maxLeads: parsed.context.maxLeads ?? 12,
      maxEvidencePerLead: parsed.context.maxEvidencePerLead ?? 4,
      maxEvidenceTextChars: parsed.context.maxEvidenceTextChars ?? 240,
    },
    lan: parsed.lan ?? { port: 3000 },
    api: parsed.api ?? { enabled: false, host: "127.0.0.1", port: 31337, allowLan: false },
    compatibility: parsed.compatibility ?? { mode: "auto", toolMode: "auto", preferNativeToolsForLargeModels: true, preferDiffOnlyForLocalModels: true },
    toolCallingMode: parsed.toolCallingMode ?? "local_text",
    conversationMode: parsed.conversationMode ?? "compact_rebuild",
    organizer: parsed.organizer ?? { enabled: true, url: "http://127.0.0.1:8787", heartbeatMs: 5000 },
    providers: parsed.providers ?? {},
    defaultProvider: parsed.defaultProvider ?? "ollama",
    options: parsed.options ?? { temperature: 0, numPredict: 4096 }
  };
}
