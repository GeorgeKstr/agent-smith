const FILE_PATH_PATTERN = /\b([\w./-]+\.[a-z]{2,6})\b/gi;
const KEYWORD_AREA_MAP = [
    [/\b(button|screen|layout|css|theme|component|render|view|modal|style|ui|frontend|react|vue)\b/i, "ui"],
    [/\b(sql|supabase|schema|rls|database|migration|orm|prisma|pg|postgres|mongo|redis|table)\b/i, "database"],
    [/\b(login|auth|password|invite|oauth|token|jwt|session|credential)\b/i, "auth"],
    [/\b(test|spec|typecheck|lint|coverage|jest|vitest|mocha|assert)\b/i, "tests"],
    [/\b(config|settings|profile|env|environment)\b/i, "config"],
    [/\b(ollama|model|provider|tool|agent|prompt|context)\b/i, "agent"],
    [/\b(api|endpoint|route|handler|middleware|request|response|rest|http)\b/i, "api"],
    [/\b(build|compile|bundle|webpack|vite|esbuild|package|tsconfig|dist|deploy)\b/i, "build"],
    [/\b(cli|command|terminal|stdin|stdout|argv|args|flag|option|parse)\b/i, "tooling"],
];
const STOP_WORDS_HEURISTIC = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into", "your", "you",
    "add", "use", "should", "make", "when", "where", "which", "what", "how",
    "are", "was", "but", "not", "can", "will", "all", "fix", "change",
]);
export function buildHeuristicTaskPacket(userPrompt) {
    const trimmed = userPrompt.trim();
    const filePaths = [];
    let m;
    FILE_PATH_PATTERN.lastIndex = 0;
    while ((m = FILE_PATH_PATTERN.exec(trimmed)) !== null) {
        filePaths.push(m[1]);
    }
    const rawKeywords = trimmed
        .split(/[^A-Za-z0-9_$.]+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS_HEURISTIC.has(w.toLowerCase()));
    const keywords = [...new Set(rawKeywords)].slice(0, 12);
    const lower = trimmed.toLowerCase();
    const likelyAreas = new Set();
    for (const [pattern, area] of KEYWORD_AREA_MAP) {
        if (pattern.test(lower))
            likelyAreas.add(area);
    }
    if (likelyAreas.size === 0)
        likelyAreas.add("other");
    const suspectedFiles = filePaths.map((p) => ({ path: p, reason: "explicit file mention" }));
    const isTsProject = /typescript|\.ts|\.tsx\b/i.test(trimmed);
    const isBug = /\b(bug|fix|broken|error|fail|crash|regression)\b/i.test(trimmed);
    const isWholeFile = /\b(whole file|entire file)\b/i.test(trimmed);
    const constraints = [];
    if (isWholeFile)
        constraints.push("Whole-file rewrite allowed per user request.");
    const verificationPlan = [];
    if (isTsProject || /typecheck/i.test(trimmed))
        verificationPlan.push("typecheck");
    if (isBug)
        verificationPlan.push("test");
    if (/lint/i.test(trimmed))
        verificationPlan.push("lint");
    const isTrivial = trimmed.length < 10 || /^(hi|hey|hello|ok|thanks|help)\b/i.test(trimmed);
    const hasDetail = keywords.length >= 3 || filePaths.length > 0;
    return {
        goal: trimmed.slice(0, 200) || "Respond to user",
        successCriteria: isTrivial
            ? ["Respond appropriately"]
            : ["Requested change works correctly", "No regressions introduced"],
        nonGoals: [
            "Do not rewrite unrelated code.",
            "Do not change public APIs unless required.",
            "Do not alter UI layout unless the request is specifically about layout.",
        ],
        keywords: keywords.length > 0 ? keywords : ["general"],
        likelyAreas: [...likelyAreas].slice(0, 5),
        constraints,
        suspectedFiles,
        verificationPlan,
        rawUserPrompt: trimmed,
        confidence: hasDetail ? "medium" : "low",
    };
}
