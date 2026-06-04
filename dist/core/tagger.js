import { generateWithOllama, extractJson, optionsFromConfig } from "./ollama.js";
import { GLOBAL_TAGS, heuristicTags, tagMapForPrompt } from "./tags.js";
const VALID_IDS = new Set(GLOBAL_TAGS.map((t) => t.id));
const SYSTEM = `You classify source files using a fixed numeric tag map.
You MUST only choose IDs from the provided map.
Reply with ONLY a JSON array of up to 5 tag IDs, e.g. [2,11,16]. No prose.`;
/**
 * Assign global numeric tags to a file. Falls back to keyword heuristics when
 * Ollama is unavailable or returns nothing usable, so tagging always succeeds.
 */
export async function tagFile(args) {
    const fallback = heuristicTags(args.relPath, args.content);
    const prompt = `TAG MAP: ${tagMapForPrompt()}

File: ${args.relPath} (${args.language})
--- CONTENT (truncated) ---
${args.content.slice(0, 4000)}
--- END ---

Return up to 5 tag IDs as a JSON array:`;
    const result = await generateWithOllama({
        baseUrl: args.config.ollama.baseUrl,
        model: args.model ?? args.config.models.tagger,
        system: SYSTEM,
        prompt,
        options: optionsFromConfig(args.config, { num_predict: 60 })
    });
    if (!result.ok)
        return fallback;
    const parsed = extractJson(result.text);
    if (!Array.isArray(parsed))
        return fallback;
    const ids = parsed
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && VALID_IDS.has(n))
        .slice(0, 5);
    return ids.length > 0 ? [...new Set(ids)] : fallback;
}
