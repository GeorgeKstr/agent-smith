import type { RuntimeIntent, IntentConfidence } from "./runtimeIntent.js";

export type ExplicitMode =
  | "auto"
  | "chat"
  | "ask"
  | "patch";

export type RuntimeIntentClassification = {
  intent: RuntimeIntent;
  confidence: IntentConfidence;
  reason: string;
};

export function classifyRuntimeIntent(input: {
  prompt: string;
  uiMode?: string;
  explicitMode?: ExplicitMode;
}): RuntimeIntentClassification {
  const raw = input.prompt ?? "";
  const text = raw.trim().toLowerCase();

  if (input.explicitMode === "chat") {
    return { intent: "chat", confidence: "high", reason: "explicit chat mode" };
  }

  if (input.explicitMode === "ask") {
    return { intent: "ask", confidence: "high", reason: "explicit ask mode" };
  }

  if (input.explicitMode === "patch") {
    return { intent: "patch", confidence: "high", reason: "explicit patch/build mode" };
  }

  if (!text) {
    return { intent: "chat", confidence: "high", reason: "empty prompt" };
  }

  if (isGreetingOrSmallTalk(text)) {
    return { intent: "chat", confidence: "high", reason: "greeting or small talk" };
  }

  if (isExplicitCommand(text)) {
    return { intent: "command", confidence: "high", reason: "explicit command prefix" };
  }

  if (isAskOnlyUsage(text)) {
    return { intent: "ask", confidence: "high", reason: "question asking how/why/what, not requesting edits" };
  }

  if (isReadOnlyStatusQuestion(text)) {
    return { intent: "ask", confidence: "high", reason: "read-only status/history question" };
  }

  if (isPatchRequest(text)) {
    const confidence: IntentConfidence = isVaguePatchRequest(text) ? "low" : "high";
    return {
      intent: "patch",
      confidence,
      reason: confidence === "low"
        ? "vague modification request"
        : "explicit project/file change request"
    };
  }

  if (isAskRequest(text)) {
    return { intent: "ask", confidence: "high", reason: "question or explanation request" };
  }

  return { intent: "ask", confidence: "medium", reason: "default safe intent" };
}

function isGreetingOrSmallTalk(text: string): boolean {
  return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|lol|haha|good morning|good evening|how are you|who are you|bye|goodbye|see you)\b[!.?\s]*$/i.test(text);
}

function isExplicitCommand(text: string): boolean {
  return text.startsWith("/") || text.startsWith(":");
}

function isPatchRequest(text: string): boolean {
  return (
    (/\b(create|make|add|fix|change|edit|implement|write|delete|remove|rename|move|refactor|update|modify|replace|generate|build|improve|add a|add the|install|run\b.*\binit|set up|setup|scaffold)\b/i.test(text) ||
     isVaguePatchRequest(text) ||
     isFeatureSpecification(text)) &&
    !isAskOnlyUsage(text)
  );
}

function isAskRequest(text: string): boolean {
  return (
    /\b(explain|why|what|how|where|when|show|review|analyze|diagnos|summarize|tell me|can you|could you|what is|what does|what's|list|find|search|look)\b/.test(text) ||
    text.endsWith("?")
  );
}

function isAskOnlyUsage(text: string): boolean {
  return (
    /\bexplain how to\b/i.test(text) ||
    /\btell me how to\b/i.test(text) ||
    /\bshow me how to\b/i.test(text) ||
    /\bhow do i\b/i.test(text) ||
    /\bhow can i\b/i.test(text) ||
    /\bwhat would\b/i.test(text) ||
    /\bshould i\b/i.test(text) ||
    /\bcan you explain\b/i.test(text) ||
    /\bcould you explain\b/i.test(text) ||
    /\bwhat does\b/i.test(text)
  );
}

function isFeatureSpecification(text: string): boolean {
  return /\b(should\s+(work|behave|act|do|function|operate|return|show|display|toggle|cycle|switch|handle|support|allow|accept|respond)|needs to|is supposed to|must\s+(be|have))\b/i.test(text);
}

function isReadOnlyStatusQuestion(text: string): boolean {
  if (text.length > 200) return false;
  return (
    /\b(what|which|where|tell me)\b/i.test(text) &&
    /\b(last|created|changed|modified|edited|file|files|contains|content|diff|status|made|did you)\b/i.test(text)
  );
}

function isVaguePatchRequest(text: string): boolean {
  const explicitVague = [
    "make this better", "fix this", "improve this", "change this",
    "refactor this", "clean this up", "make it better"
  ];
  if (explicitVague.includes(text)) return true;

  if (text.length < 18) {
    return /\b(make|fix|improve|change|refactor|clean|update|add|remove|edit|modify|replace|delete|create|implement|generate|rename|move)\b/.test(text);
  }

  return false;
}
