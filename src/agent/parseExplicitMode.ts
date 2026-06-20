import type { ExplicitMode } from "./classifyRuntimeIntent.js";

export function parseExplicitMode(prompt: string): {
  explicitMode: ExplicitMode;
  cleanedPrompt: string;
} {
  const trimmed = prompt.trim();

  if (trimmed.startsWith("/chat ")) {
    return { explicitMode: "chat", cleanedPrompt: trimmed.slice(6).trim() };
  }

  if (trimmed.startsWith("/ask ")) {
    return { explicitMode: "ask", cleanedPrompt: trimmed.slice(5).trim() };
  }

  if (trimmed.startsWith("/build ") || trimmed.startsWith("/patch ")) {
    const prefix = trimmed.startsWith("/build ") ? "/build " : "/patch ";
    return {
      explicitMode: "patch",
      cleanedPrompt: trimmed.slice(prefix.length).trim()
    };
  }

  return {
    explicitMode: "auto",
    cleanedPrompt: prompt
  };
}
