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
