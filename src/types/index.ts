export type SmithConfig = {
  models: {
    tagger: string;
    summarizer: string;
    patcher: string;
    debugger: string;
  };
  ollama: {
    baseUrl: string;
    temperature: number;
    numPredict: number;
  };
  index: {
    watch: boolean;
    debounceMs: number;
    workerCount: number;
    summaryConcurrency: number;
    ignore: string[];
  };
  context: {
    maxPromptTokens: number;
    maxFiles: number;
    maxSymbols: number;
    graphDepth: number;
    includeTests: boolean;
    includeTypes: boolean;
    includeSummaries: boolean;
  };
  commands: {
    test: string;
    typecheck: string;
    lint: string;
    build: string;
  };
  safety: {
    forbiddenPaths: string[];
    confirmShellCommands: boolean;
    maxPatchFiles: number;
    maxPatchLines: number;
  };
  theme: {
    mode: "matrix";
    showBootAnimation: boolean;
    animations: boolean;
  };
};

export type IndexPhase =
  | "idle"
  | "scanning"
  | "hashing"
  | "parsing"
  | "graph"
  | "tagging"
  | "ready";

export type BootState = {
  phase: IndexPhase;
  progress: number;
  filesScanned: number;
  filesTotal: number;
  dirtyFiles: number;
  symbolsIndexed: number;
  tagsRefreshed: number;
  currentFile?: string;
  tip?: string;
};

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "type"
  | "interface"
  | "enum"
  | "component"
  | "variable";

export type SymbolRecord = {
  id: number;
  fileId: number;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature?: string;
  summary?: string;
  hash?: string;
};

export type ExtractedSymbol = {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
  hash: string;
};

export type ExtractedImport = {
  importText: string;
  specifier: string;
};

export type FileRecord = {
  id: number;
  path: string;
  language: string;
  hash: string;
  isTest: number;
  summary?: string;
  status: string;
};

export type TaskClassification = {
  tagIds: number[];
  keywords: string[];
  likelyFiles: string[];
  likelySymbols: string[];
  needsTests: boolean;
  needsTypes: boolean;
};

export type ScoredFile = {
  fileId: number;
  path: string;
  language: string;
  isTest: boolean;
  score: number;
  reasons: string[];
};

export type ContextPacket = {
  task: string;
  prompt: string;
  estimatedTokens: number;
  files: Array<{ path: string; reason: string }>;
  symbols: Array<{ name: string; path: string; kind: string }>;
};

export type PatchValidation = {
  ok: boolean;
  errors: string[];
  files: string[];
};

export type CheckResult = {
  name: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  ok: boolean;
};

export type PatchOutcome = {
  ok: boolean;
  applied: boolean;
  attempts: number;
  diff?: string;
  files: string[];
  checks: CheckResult[];
  message: string;
};
