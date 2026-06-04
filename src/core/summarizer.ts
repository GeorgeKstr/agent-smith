import type { SmithConfig } from "../types/index.js";
import { generateWithOllama, optionsFromConfig } from "./ollama.js";

const SYSTEM = `You summarize source files for a code index.
Reply with ONE dense sentence (max 30 words) describing what the file does and its key responsibilities.
No preamble, no markdown, no quotes.`;

/**
 * Produce a one-line file summary via Ollama.
 * Returns an empty string when the model/server is unavailable so callers can
 * cache "no summary" without crashing.
 */
export async function summarizeFile(args: {
  config: SmithConfig;
  relPath: string;
  language: string;
  content: string;
  model?: string;
}): Promise<string> {
  const snippet = args.content.slice(0, 6000);
  const prompt = `File: ${args.relPath}
Language: ${args.language}

--- CONTENT ---
${snippet}
--- END ---

One-sentence summary:`;

  const result = await generateWithOllama({
    baseUrl: args.config.ollama.baseUrl,
    model: args.model ?? args.config.models.summarizer,
    system: SYSTEM,
    prompt,
    options: optionsFromConfig(args.config, { num_predict: 120 })
  });

  if (!result.ok) return "";
  return result.text.replace(/\s+/g, " ").trim().slice(0, 240);
}
