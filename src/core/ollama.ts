import type { SmithConfig } from "../types/index.js";

export type OllamaGenerateOptions = {
  temperature?: number;
  num_ctx?: number;
  num_predict?: number;
  stop?: string[];
};


export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  description?: string;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
};

/** Qwen-Agent style function definition. */
export type QwenFunctionDefinition = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

/** OpenAI/Ollama style tool definition. */
export type QwenToolDefinition = {
  type: "function";
  function: QwenFunctionDefinition;
};

export type QwenChatMessage = {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string;
  name?: string;
  reasoning_content?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id?: string;
    type?: "function";
    function: {
      name: string;
      arguments: string | Record<string, unknown>;
    };
  }>;
};

export type QwenChatResult = {
  ok: boolean;
  messages: QwenChatMessage[];
  text: string;
  error?: string;
};

export type OllamaResult = {
  ok: boolean;
  text: string;
  tokenCount?: number;
  evalDurationMs?: number;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}


function apiBase(baseUrl: string): string {
  // Existing config usually stores http://localhost:11434. This also tolerates
  // http://localhost:11434/api and avoids accidental /api/api/chat URLs.
  return baseUrl.replace(/\/+$/, "").replace(/\/api$/, "");
}

function toTools(functions: QwenFunctionDefinition[]): QwenToolDefinition[] {
  return functions.map((fn) => ({ type: "function", function: fn }));
}

function safeJsonString(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function normalizeFunctionCall(call: unknown): QwenChatMessage["function_call"] | undefined {
  if (!call || typeof call !== "object") return undefined;
  const obj = call as { name?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } };
  const name = typeof obj.name === "string" ? obj.name : typeof obj.function?.name === "string" ? obj.function.name : "";
  if (!name) return undefined;
  const args = obj.arguments ?? obj.function?.arguments ?? {};
  return { name, arguments: safeJsonString(args) };
}

function extractFunctionCallsFromText(text: string): Array<NonNullable<QwenChatMessage["function_call"]>> {
  const calls: Array<NonNullable<QwenChatMessage["function_call"]>> = [];
  if (!text.trim()) return calls;

  // Qwen templates may emit raw <tool_call>{...}</tool_call> blocks when the
  // server does not natively expose tool_calls.
  const blockRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  for (let m; (m = blockRe.exec(text)); ) {
    try {
      const parsed = JSON.parse(m[1]);
      const call = normalizeFunctionCall(parsed);
      if (call) calls.push(call);
    } catch {
      // Ignore malformed tool-call blocks and fall back to balanced JSON below.
    }
  }
  if (calls.length > 0) return calls;

  const parsed = extractJson<unknown>(text);
  const values = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  for (const value of values) {
    const call = normalizeFunctionCall(value);
    if (call) calls.push(call);
  }
  return calls;
}

function normalizeAssistantMessage(raw: unknown): QwenChatMessage {
  const message = (raw ?? {}) as {
    role?: string;
    content?: string;
    thinking?: string;
    reasoning_content?: string;
    function_call?: unknown;
    tool_calls?: Array<{ id?: string; type?: "function"; function?: { name?: string; arguments?: unknown } }>;
  };

  const out: QwenChatMessage = {
    role: "assistant",
    content: typeof message.content === "string" ? message.content : ""
  };

  const reasoning = message.reasoning_content ?? message.thinking;
  if (typeof reasoning === "string" && reasoning.trim()) out.reasoning_content = reasoning;

  const nativeCall = normalizeFunctionCall(message.function_call);
  if (nativeCall) out.function_call = nativeCall;

  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .map((tc) => normalizeFunctionCall(tc))
        .filter((tc): tc is NonNullable<QwenChatMessage["function_call"]> => Boolean(tc))
    : [];

  const textCalls = !out.function_call && toolCalls.length === 0 ? extractFunctionCallsFromText(out.content) : [];
  const allCalls = out.function_call ? [out.function_call] : toolCalls.length > 0 ? toolCalls : textCalls;

  if (allCalls.length === 1) {
    out.function_call = allCalls[0];
    out.content = "";
  } else if (allCalls.length > 1) {
    // Match Qwen-Agent's convenient shape: one assistant message per call.
    out.tool_calls = allCalls.map((call, i) => ({
      id: `call_${i + 1}`,
      type: "function",
      function: call
    }));
    out.content = "";
  }

  return out;
}

function toOllamaMessages(messages: QwenChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    // Ollama wants tool results as role: "tool". Qwen-Agent examples often use
    // role: "function"; keep that API internally and convert at the boundary.
    if (m.role === "function") {
      return { role: "tool", name: m.name, content: m.content };
    }
    return {
      role: m.role,
      content: m.content,
      name: m.name,
      tool_calls: m.tool_calls,
      function_call: m.function_call
    };
  });
}

/**
 * Returns true if a local Ollama server answers within a short window.
 * Never throws so callers can stay alive when Ollama is down.
 */
export async function isOllamaAvailable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${apiBase(baseUrl)}/api/tags`, { method: "GET" }, 2_500);
    return response.ok;
  } catch {
    return false;
  }
}

/** List installed model names. Empty array if unreachable. */
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(`${apiBase(baseUrl)}/api/tags`, { method: "GET" }, 3_000);
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve a configured model name (which may use a custom tag like
 * `qwen2.5-coder:7b-8k`) to an actually-installed model. Falls back to the
 * closest family/size match, then to any installed model.
 */
export function resolveModelName(preferred: string, installed: string[]): string {
  if (installed.length === 0) return preferred;
  if (installed.includes(preferred)) return preferred;

  const family = preferred.split(":")[0];
  const sizeMatch = preferred.match(/(\d+b)/i);
  const size = sizeMatch ? sizeMatch[1].toLowerCase() : undefined;

  const sameFamily = installed.filter((m) => m.split(":")[0] === family);
  if (sameFamily.length > 0) {
    if (size) {
      const bySize = sameFamily.find((m) => m.toLowerCase().includes(size));
      if (bySize) return bySize;
    }
    return sameFamily[0];
  }

  if (size) {
    const bySize = installed.find((m) => m.toLowerCase().includes(size));
    if (bySize) return bySize;
  }
  return installed[0];
}

/**
 * Low-level generate call. Returns a structured result instead of throwing,
 * so the agent degrades gracefully when the model or server is unavailable.
 */
export async function generateWithOllama(args: {
  baseUrl: string;
  model: string;
  prompt: string;
  system?: string;
  options?: OllamaGenerateOptions;
  timeoutMs?: number;
  signal?: AbortSignal;
  onToken?: (token: string, fullText: string) => void;
}): Promise<OllamaResult> {
  const useStream = Boolean(args.onToken);
  try {
    const response = await fetchWithTimeout(
      `${apiBase(args.baseUrl)}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: args.model,
          prompt: args.prompt,
          system: args.system,
          stream: useStream,
          options: args.options ?? {}
        })
      },
      args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      args.signal
    );

    if (!response.ok) {
      return { ok: false, text: "", error: `Ollama ${response.status} ${response.statusText}` };
    }

    if (!useStream) {
      const data = (await response.json()) as { response?: string };
      return { ok: true, text: data.response ?? "" };
    }

    // Streaming mode — parse NDJSON line by line
    if (!response.body) {
      return { ok: false, text: "", error: "No response body for streaming" };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullText = "";
    let tokenCount = 0;
    let evalDurationMs = 0;
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (args.signal?.aborted) { reader.cancel().catch(() => undefined); break outer; }
        try {
          const chunk = JSON.parse(line) as {
            response?: string;
            done?: boolean;
            eval_count?: number;
            eval_duration?: number;
          };
          if (typeof chunk.response === "string" && chunk.response) {
            fullText += chunk.response;
            tokenCount++;
            args.onToken!(chunk.response, fullText);
          }
          if (chunk.done) {
            if (typeof chunk.eval_count === "number") tokenCount = chunk.eval_count;
            if (typeof chunk.eval_duration === "number") evalDurationMs = Math.round(chunk.eval_duration / 1_000_000);
          }
        } catch { /* skip malformed chunk */ }
      }
    }
    return { ok: true, text: fullText, tokenCount, evalDurationMs };
  } catch (error) {
    return { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
  }
}


/**
 * Qwen/Qwen-Agent-compatible chat call.
 *
 * - Accepts `functions`, like Qwen-Agent, instead of forcing callers to build tools.
 * - Sends OpenAI/Ollama `tools` to the model server.
 * - Normalizes Ollama `message.tool_calls`, OpenAI-ish `function_call`, and raw
 *   Qwen `<tool_call>{...}</tool_call>` text into Qwen-Agent-style messages.
 */
export async function chatWithQwenFunctions(args: {
  baseUrl: string;
  model: string;
  messages: QwenChatMessage[];
  functions?: QwenFunctionDefinition[];
  options?: OllamaGenerateOptions;
  think?: boolean;
  timeoutMs?: number;
}): Promise<QwenChatResult> {
  try {
    const response = await fetchWithTimeout(
      `${apiBase(args.baseUrl)}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: args.model,
          messages: toOllamaMessages(args.messages),
          stream: false,
          tools: args.functions?.length ? toTools(args.functions) : undefined,
          think: args.think ?? false,
          options: args.options ?? {}
        })
      },
      args.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) {
      return { ok: false, messages: [], text: "", error: `Ollama ${response.status} ${response.statusText}` };
    }

    const data = (await response.json()) as { message?: unknown };
    const assistant = normalizeAssistantMessage(data.message);

    if (assistant.tool_calls?.length) {
      return {
        ok: true,
        text: "",
        messages: assistant.tool_calls.map((tc) => ({
          role: "assistant",
          content: "",
          reasoning_content: assistant.reasoning_content,
          function_call: {
            name: tc.function.name,
            arguments: safeJsonString(tc.function.arguments)
          }
        }))
      };
    }

    return { ok: true, messages: [assistant], text: assistant.content };
  } catch (error) {
    return { ok: false, messages: [], text: "", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Parse the JSON argument string from a Qwen-Agent-style function_call safely. */
export function parseFunctionArguments(call: NonNullable<QwenChatMessage["function_call"]>): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.arguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Convenience wrapper that builds generate options from config. */
export function optionsFromConfig(config: SmithConfig, override?: OllamaGenerateOptions): OllamaGenerateOptions {
  return {
    temperature: config.ollama.temperature,
    num_predict: config.ollama.numPredict,
    ...override
  };
}

/**
 * Extract the first balanced JSON object/array from a model response.
 * Local models often wrap JSON in prose or ``` fences; this recovers it.
 */
export function extractJson<T = unknown>(text: string): T | undefined {
  if (!text) return undefined;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;

  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
