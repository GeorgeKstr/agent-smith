export function classifyRuntimeIntent(input) {
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
        const confidence = isVaguePatchRequest(text) ? "low" : "high";
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
function isGreetingOrSmallTalk(text) {
    return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|lol|haha|good morning|good evening|how are you|who are you|bye|goodbye|see you)\b[!.?\s]*$/i.test(text);
}
function isExplicitCommand(text) {
    return text.startsWith("/") || text.startsWith(":");
}
function isPatchRequest(text) {
    return ((/\b(create|make|add|fix|change|edit|implement|write|delete|remove|rename|move|refactor|update|modify|replace|generate|build|improve|add a|add the)\b/.test(text) ||
        isVaguePatchRequest(text) ||
        isFeatureSpecification(text)) &&
        !isAskOnlyUsage(text));
}
function isAskRequest(text) {
    return (/\b(explain|why|what|how|where|when|show|review|analyze|diagnos|summarize|tell me|can you|could you|what is|what does|what's|list|find|search|look)\b/.test(text) ||
        text.endsWith("?"));
}
function isAskOnlyUsage(text) {
    return (text.includes("explain how to") ||
        text.includes("tell me how to") ||
        text.includes("show me how to") ||
        text.includes("how do i") ||
        text.includes("how can i") ||
        text.includes("what would") ||
        text.includes("should i") ||
        text.includes("can you explain") ||
        text.includes("could you explain") ||
        text.includes("what does"));
}
function isFeatureSpecification(text) {
    return /\b(should\s+(work|behave|act|do|function|operate|return|show|display|toggle|cycle|switch|handle|support|allow|accept|respond)|needs to|is supposed to|must\s+(be|have))\b/i.test(text);
}
function isReadOnlyStatusQuestion(text) {
    return (/\b(what|which|where|show|tell me|list)\b/i.test(text) &&
        /\b(last|created|changed|modified|edited|file|files|contains|content|diff|status|made|did you)\b/i.test(text));
}
function isVaguePatchRequest(text) {
    const explicitVague = [
        "make this better", "fix this", "improve this", "change this",
        "refactor this", "clean this up", "make it better"
    ];
    if (explicitVague.includes(text))
        return true;
    if (text.length < 18) {
        return /\b(make|fix|improve|change|refactor|clean|update|add|remove|edit|modify|replace|delete|create|implement|generate|rename|move)\b/.test(text);
    }
    return false;
}
