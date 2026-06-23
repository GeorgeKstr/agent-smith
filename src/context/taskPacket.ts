export type TaskPacket = {
  goal: string;
  successCriteria: string[];
  nonGoals: string[];
  keywords: string[];
  likelyAreas: string[];
  constraints: string[];
  suspectedFiles: Array<{
    path: string;
    reason: string;
    suggestedRanges?: Array<[number, number]>;
  }>;
  verificationPlan: string[];
  rawUserPrompt: string;
  confidence: "low" | "medium" | "high";
};

export type TaskKind =
  | "chat"
  | "ask"
  | "code_patch"
  | "ui_style_patch"
  | "file_create"
  | "refactor"
  | "unknown";

const FILE_PATH_PATTERN = /\b([\w./-]+\.[a-z]{2,6})\b/gi;

const KEYWORD_AREA_MAP: Array<[RegExp, string]> = [
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

export function buildHeuristicTaskPacket(userPrompt: string): TaskPacket {
  const trimmed = userPrompt.trim();

  const filePaths: string[] = [];
  let m: RegExpExecArray | null;
  FILE_PATH_PATTERN.lastIndex = 0;
  while ((m = FILE_PATH_PATTERN.exec(trimmed)) !== null) {
    filePaths.push(m[1]);
  }

  const rawKeywords = trimmed
    .split(/[^A-Za-z0-9_$.]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS_HEURISTIC.has(w.toLowerCase()));
  const keywords = [...new Set(rawKeywords)].slice(0, 12);

  const lower = trimmed.toLowerCase();
  const likelyAreas = new Set<string>();
  for (const [pattern, area] of KEYWORD_AREA_MAP) {
    if (pattern.test(lower)) likelyAreas.add(area);
  }
  if (likelyAreas.size === 0) likelyAreas.add("other");

  const suspectedFiles = filePaths.map((p) => ({ path: p, reason: "explicit file mention" }));

  const isTsProject = /typescript|\.ts|\.tsx\b/i.test(trimmed);
  const isBug = /\b(bug|fix|broken|error|fail|crash|regression)\b/i.test(trimmed);
  const isWholeFile = /\b(whole file|entire file)\b/i.test(trimmed);

  const constraints: string[] = [];
  if (isWholeFile) constraints.push("Whole-file rewrite allowed per user request.");

  const verificationPlan: string[] = [];
  if (isTsProject || /typecheck/i.test(trimmed)) verificationPlan.push("typecheck");
  if (isBug) verificationPlan.push("test");
  if (/lint/i.test(trimmed)) verificationPlan.push("lint");

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

const FILE_LIKE_EXT = /\b\w+\.(js|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|php|html|css|scss|less|json|md|yaml|yml|toml|xml|sql|sh|bash|zsh|ps1|bat|env|gitignore|dockerfile|txt|cfg|ini|conf|log|out|err)\b/i;

const TECH_WORDS = /\b(node|python|flask|django|react|vue|angular|svelte|express|next|nuxt|golang|go|rust|ruby|rails|php|laravel|java|spring|kotlin|swift|dotnet|deno|bun|bash|sh|shell|zsh|makefile|docker|nginx|redis|postgres|mongo|sqlite|graphql)\b/i;
const FILE_CREATE_NOUNS = /\b(file|files|project|app|application|service|server|api|tool|script|module|package|site|website|page|daemon|worker|bot|crawler|scraper|gateway|middleware|cli|calculator|game|editor|player|viewer|manager|runner|loader|parser|generator|handler|controller|store|dashboard)\b/i;

function scoreFileCreate(text: string): number {
  let s = 0;
  const hasCreateVerb = /\b(create|make|generate|new|write|build|set\s*up|scaffold|init|spin\s*up|stand\s*up)\b/i.test(text);
  if (hasCreateVerb && FILE_CREATE_NOUNS.test(text)) s += 4;
  if (hasCreateVerb && /\b(using|with|for)\b/i.test(text)) s += 2;
  if (FILE_LIKE_EXT.test(text)) s += 3;
  if (hasCreateVerb && FILE_LIKE_EXT.test(text)) s += 2;
  if (hasCreateVerb && TECH_WORDS.test(text)) s += 2;
  if (/\b(from\s*scratch|new\s*director|empty\s*project|greenfield|blank)\b/i.test(text)) s += 2;
  if ((text.match(/\b\w+\.\w{1,6}\b/g) || []).length >= 2) s += 2;
  if (/\b(framework|library|template|boilerplate)\b/i.test(text) && hasCreateVerb) s += 1;
  if (/\bring\b|microservice|monolith|backend|frontend\b/i.test(text) && !hasCreateVerb) s -= 1;
  if (/\b(edit|change|modify|update|fix|refactor|delete|remove|rename|move)\b/i.test(text)) s -= 2;
  if (/\b(background|color|theme|css|margin|padding|font|border|rounded|shadow)\b/i.test(text)) s -= 3;
  return Math.max(0, Math.min(10, s));
}

function scoreUiStyle(text: string): number {
  let s = 0;
  const hasChangeVerb = /\b(make|change|set|turn|update|adjust|style|fix|modify|switch|tweak|polish)\b/i.test(text);
  if (hasChangeVerb && /\b(background|color|colou?r|theme|css)\b/i.test(text)) s += 4;
  if (hasChangeVerb && /\b(button|sidebar|navbar|modal|dialog|header|footer|card|form|input|dropdown|menu|icon|topbar|toolbar|panel|section|tabs|accordion)\b/i.test(text)) s += 3;
  if (hasChangeVerb && /\b(width|height|margin|padding|font|border|rounded|shadow|spacing|gap|align|justify)\b/i.test(text)) s += 2;
  if (hasChangeVerb && /\b(layout|spacing|position|alignment|overflow|z-index|opacity|wider|narrower|shorter|taller|bigger|smaller|lighter|darker)\b/i.test(text)) s += 2;
  if (hasChangeVerb && /\b(page|screen|view|font|text|size|icon)\b/i.test(text)) s += 1;
  if (/px|rem|em|vh|vw|%\b/i.test(text) && hasChangeVerb) s += 1;
  if (/\b(dark mode|light mode|responsive|mobile)\b/i.test(text)) s += 2;
  if (hasChangeVerb && /\b(dark|light|red|blue|green|white|black|gray|grey|purple|orange|yellow|pink)\b/i.test(text)) s += 1;
  if (/\b(background|color|theme|css|style)\b.*\b(red|blue|green|white|black|dark|light|gray|grey|purple|orange|yellow|pink)\b/i.test(text)) s += 2;
  if (FILE_LIKE_EXT.test(text)) s -= 2;
  if (/\b(create|generate|new|write|build)\b.*\b(file|server|api|script|module|package|database)\b/i.test(text)) s -= 3;
  return Math.max(0, Math.min(10, s));
}

function scoreAsk(text: string): number {
  let s = 0;
  if (/[?]\s*$/.test(text.trim())) s += 4;
  if (/\b(why|what|how|where|when|which|who|whom|whose)\b/i.test(text)) s += 3;
  if (/\b(is|are|was|were|do|does|did|has|have|had)\b\s+\w+\s+\w+/i.test(text) && /\b(how|what|where|why|when)\b/i.test(text)) s += 2;
  if (/\b(explain|describe|tell me|show me|review|analyze|diagnos|summarize|define|clarify|elaborate|walk me through|outline)\b/i.test(text)) s += 4;
  if (/\b(find|search|locate|look\s*(for|up)|list|give me)\b/i.test(text)) s += 2;
  if (/\b(meaning|purpose|reason|difference|comparison|example|benefit|drawback)\b/i.test(text)) s += 1;
  if (/\b(create|make|build|generate|write|implement|fix|change|edit|delete|remove)\b/i.test(text)) s -= 3;
  if (FILE_LIKE_EXT.test(text) && /\b(edit|change|modify|update|fix|create|make|write)\b/i.test(text)) s -= 2;
  return Math.max(0, Math.min(10, s));
}

function scoreRefactor(text: string): number {
  let s = 0;
  if (/\b(refactor|rewrite|restructure|reorganize|redesign|rework|clean\s*up|overhaul)\b/i.test(text)) s += 4;
  if (/\b(rename|move|extract|split|merge|consolidate|inline|decompose|modularize|segregate|decouple|untangle)\b/i.test(text)) s += 4;
  if (/\b(improve|simplify|reduce\s+duplication|eliminate|unwrap)\b/i.test(text)) s += 2;
  if (FILE_LIKE_EXT.test(text)) s += 1;
  if (/\b(create|make|generate|new|write|build)\b/i.test(text) && s < 3) s -= 2;
  return Math.max(0, Math.min(10, s));
}

function scoreCodePatch(text: string): number {
  let s = 1;
  if (/\b(fix|bug|error|crash|broken|issue|problem|fault|regression|defect)\b/i.test(text)) s += 4;
  if (/\b(add|implement|update|change|modify|edit|patch|insert|append)\b/i.test(text)) s += 2;
  if (/\b(function|class|method|variable|import|export|const|let|var|type|interface|callback|promise|async|await)\b/i.test(text)) s += 1;
  if (/\b(faster|slower|performance|optimize|efficient|bottleneck|latency|memory\s*leak|perf)\b/i.test(text)) s += 2;
  if (/\b(review|analyze|explain|describe|tell me|show me|why|what|how)\b/i.test(text)) s -= 3;
  // Penalize strongly when other categories dominate
  if (scoreFileCreate(text) >= 5) s = Math.max(0, s - 3);
  if (scoreUiStyle(text) >= 4) s = Math.max(0, s - 3);
  if (scoreAsk(text) >= 3) s = Math.max(0, s - 2);
  if (scoreRefactor(text) >= 4) s = Math.max(0, s - 3);
  return Math.max(0, Math.min(10, s));
}

export function classifyTaskKind(userPrompt: string): TaskKind {
  const text = userPrompt.trim().toLowerCase();

  if (!text || /^(hi|hey|hello|ok|thanks|help)\b/i.test(text)) return "chat";

  const scores = {
    file_create: scoreFileCreate(text),
    ui_style: scoreUiStyle(text),
    ask: scoreAsk(text),
    refactor: scoreRefactor(text),
    code_patch: scoreCodePatch(text),
  };

  if (scores.file_create >= 5) return "file_create";
  if (scores.ask >= 4) return "ask";
  if (scores.refactor >= 4) return "refactor";
  if (scores.ui_style >= 4) return "ui_style_patch";
  if (scores.code_patch >= 2) return "code_patch";

  return "unknown";
}

/** Exported for retriever – returns true when style signals are dominant enough to alter retrieval strategy. */
export function isUiStylePatchPrompt(text: string): boolean {
  return scoreUiStyle(text) >= 4;
}
