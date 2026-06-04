const DEFAULT_TIMEOUT_MS = 120_000;
async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Returns true if a local Ollama server answers within a short window.
 * Never throws so callers can stay alive when Ollama is down.
 */
export async function isOllamaAvailable(baseUrl) {
    try {
        const response = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, 2_500);
        return response.ok;
    }
    catch {
        return false;
    }
}
/** List installed model names. Empty array if unreachable. */
export async function listOllamaModels(baseUrl) {
    try {
        const response = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, 3_000);
        if (!response.ok)
            return [];
        const data = (await response.json());
        return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
    }
    catch {
        return [];
    }
}
/**
 * Resolve a configured model name (which may use a custom tag like
 * `qwen2.5-coder:7b-8k`) to an actually-installed model. Falls back to the
 * closest family/size match, then to any installed model.
 */
export function resolveModelName(preferred, installed) {
    if (installed.length === 0)
        return preferred;
    if (installed.includes(preferred))
        return preferred;
    const family = preferred.split(":")[0];
    const sizeMatch = preferred.match(/(\d+b)/i);
    const size = sizeMatch ? sizeMatch[1].toLowerCase() : undefined;
    const sameFamily = installed.filter((m) => m.split(":")[0] === family);
    if (sameFamily.length > 0) {
        if (size) {
            const bySize = sameFamily.find((m) => m.toLowerCase().includes(size));
            if (bySize)
                return bySize;
        }
        return sameFamily[0];
    }
    if (size) {
        const bySize = installed.find((m) => m.toLowerCase().includes(size));
        if (bySize)
            return bySize;
    }
    return installed[0];
}
/**
 * Low-level generate call. Returns a structured result instead of throwing,
 * so the agent degrades gracefully when the model or server is unavailable.
 */
export async function generateWithOllama(args) {
    try {
        const response = await fetchWithTimeout(`${args.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: args.model,
                prompt: args.prompt,
                system: args.system,
                stream: false,
                options: args.options ?? {}
            })
        }, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        if (!response.ok) {
            return { ok: false, text: "", error: `Ollama ${response.status} ${response.statusText}` };
        }
        const data = (await response.json());
        return { ok: true, text: data.response ?? "" };
    }
    catch (error) {
        return { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
    }
}
/** Convenience wrapper that builds generate options from config. */
export function optionsFromConfig(config, override) {
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
export function extractJson(text) {
    if (!text)
        return undefined;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1] : text;
    const start = candidate.search(/[[{]/);
    if (start === -1)
        return undefined;
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
            }
            else if (ch === "\\") {
                escaped = true;
            }
            else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        }
        else if (ch === open) {
            depth++;
        }
        else if (ch === close) {
            depth--;
            if (depth === 0) {
                const slice = candidate.slice(start, i + 1);
                try {
                    return JSON.parse(slice);
                }
                catch {
                    return undefined;
                }
            }
        }
    }
    return undefined;
}
