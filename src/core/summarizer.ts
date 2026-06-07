import type { SmithConfig } from "../types/index.js";
import { generateWithProvider } from "./providers.js";

const SYSTEM = `You analyze source files for a code index.
Reply with a one-sentence summary (max 30 words) and a numeric importance score (1-10).
Importance reflects how central the file is to the project: 1-3 peripheral/config, 4-6 utility/middleware, 7-8 core logic/data model, 9-10 architectural entry point.
Format exactly: SUMMARY: <one sentence> | IMPORTANCE: <number>`;

/**
 * Produce a one-line file summary and importance rating via the configured provider.
 * Returns an empty summary and 0 when the model/server is unavailable.
 */
export async function summarizeFile(args: {
  config: SmithConfig;
  relPath: string;
  language: string;
  content: string;
  model?: string;
}): Promise<{ summary: string; importance: number }> {
  const snippet = args.content.slice(0, 6000);
  const prompt = `File: ${args.relPath}
Language: ${args.language}

--- CONTENT ---
${snippet}
--- END ---`;

  const result = await generateWithProvider(
    args.config,
    args.model ?? args.config.models.summarizer,
    prompt,
    { system: SYSTEM, maxTokens: 160 }
  );

  if (!result.ok) return { summary: "", importance: 0 };

  const text = result.text.replace(/\s+/g, " ").trim();
  const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?:\s*\|\s*IMPORTANCE:|$)/i);
  const importanceMatch = text.match(/IMPORTANCE:\s*(\d+)/i);

  const summary = summaryMatch
    ? summaryMatch[1].trim().slice(0, 240)
    : text.slice(0, 240);
  const importance = importanceMatch
    ? Math.max(1, Math.min(10, parseInt(importanceMatch[1], 10)))
    : 0;

  return { summary, importance };
}
