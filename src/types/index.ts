export type ProviderType = "ollama" | "openai" | "anthropic";

export type ProviderEntry = {
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
};

export type ProviderMap = Record<string, ProviderEntry>;

export type CompatibilityMode = "auto" | "small-local" | "large-model" | "cloud-agent";

export type ToolMode = "auto" | "diff_only" | "json_protocol" | "native_tools";

export type OrganizerWorkerStatus =
  | "idle"
  | "indexing"
  | "busy"
  | "offline"
  | "error"
  | "paused";

export type OrganizerWorkerCapability =
  | "ask"
  | "patch"
  | "retrieve"
  | "context"
  | "index"
  | "check"
  | "tasks"
  | "changes"
  | "native_tools"
  | "json_tools"
  | "diff_only"
  | "api";

export type OrganizerWorkerModels = {
  planner?: string;
  summarizer?: string;
  patcher?: string;
  debugger?: string;
  tooling?: string;
};

export type OrganizerIndexStatus = {
  files: number;
  dirty: number;
  symbols: number;
  taggedFiles?: number;
  freshness?: number;
};

export type OrganizerWorkerHeartbeat = {
  agentId: string;
  name: string;
  hostname: string;
  projectName: string;
  projectRoot: string;
  status: OrganizerWorkerStatus;
  api: {
    enabled: boolean;
    baseUrl: string;
    actions: RuntimeActionKind[];
  };
  models: OrganizerWorkerModels;
  index: OrganizerIndexStatus;
  capabilities: OrganizerWorkerCapability[];
  currentTaskId?: string | null;
  timestamp: number;
};

export type ToolCallingMode = "local_text" | "native_provider" | "auto";

export type ConversationMode = "compact_rebuild" | "full_history";

export type OrganizerConfig = {
  enabled: boolean;
  url: string;
  token?: string;
  agentId?: string;
  agentName?: string;
  heartbeatMs: number;
  apiBaseUrl?: string;
};

export type SmithConfig = {
  models: {
    tagger: string;
    summarizer: string;
    patcher: string;
    debugger: string;
  };
  providers: ProviderMap;
  defaultProvider: string;
  ollama: {
    baseUrl: string;
    temperature: number;
    numPredict: number;
  };
  options: {
    temperature: number;
    numPredict: number;
  };
  index: {
    watch: boolean;
    debounceMs: number;
    workerCount: number;
    summaryConcurrency: number;
    ignore: string[];
    fileCards?: boolean;
    fileCardModel?: string;
    fileCardConcurrency?: number;
  };
  context: {
    maxPromptTokens: number;
    maxFiles: number;
    maxSymbols: number;
    graphDepth: number;
    includeTests: boolean;
    includeTypes: boolean;
    includeSummaries: boolean;
    maxLiveCodeTokens?: number;
    maxToolHistoryTokens?: number;
    maxFileCards?: number;
    maxReadLines?: number;
    maxSearchResults?: number;
    compactAfterToolCalls?: number;
    compactAtTokenRatio?: number;
    maxLeads?: number;
    maxEvidencePerLead?: number;
    maxEvidenceTextChars?: number;
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
  lan: {
    port: number;
  };
  api: {
    enabled: boolean;
    host: string;
    port: number;
    token?: string;
    allowLan: boolean;
  };
  compatibility: {
    mode: CompatibilityMode;
    toolMode: ToolMode;
    preferNativeToolsForLargeModels: boolean;
    preferDiffOnlyForLocalModels: boolean;
  };
  toolCallingMode: ToolCallingMode;
  conversationMode: ConversationMode;
  localText: {
    maxConsecutiveSearches: number;
    maxTotalSearchesPerRun: number;
    maxSearchesAfterFirstRead: number;
    requireReasonForSearchAfterRead: boolean;
    maxReadsBeforeEditPressure: number;
    maxSearchesBeforeEditPressure: number;
    allowReadAfterEditPressure: boolean;
  };
  approval: {
    policy: "never" | "on_write" | "on_dangerous" | "always";
    confirmDangerous: boolean;
    maxAutoApplyFiles: number;
  };
  phaseModels: Partial<Record<string, string>>;
  sandbox: {
    createCheckpoints: boolean;
    autoRollback: boolean;
    warnDirtyFiles: boolean;
  };
  theme: {
    mode: "matrix";
    showBootAnimation: boolean;
    animations: boolean;
  };
  organizer: OrganizerConfig;
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

export type PromptIntentKind = "task" | "chat" | "meta";

export type PromptIntent = {
  kind: PromptIntentKind;
  confidence: number;
  reason: string;
};

export type PromptToolRequest = {
  tool: "find_files" | "find_symbols";
  query: string;
};

export type PromptPlan = {
  intent: PromptIntent;
  objective: string;
  tasks: string[];
  keywords: string[];
  likelyFiles: string[];
  likelySymbols: string[];
  toolRequests: PromptToolRequest[];
};

export type RetrievalSignal =
  | "grep"
  | "tag"
  | "summary"
  | "symbol"
  | "file_hint"
  | "memory"
  | "graph"
  | "test"
  | "path"
  | "keyword";

export type RetrievalReason = {
  signal: RetrievalSignal;
  weight: number;
  detail: string;
};

export type ScoredFile = {
  fileId: number;
  path: string;
  language: string;
  isTest: boolean;
  score: number;
  reasons: string[];
  reasonDetails?: RetrievalReason[];
};

export type ContextFileEntry = {
  path: string;
  reason: string;
  tokens?: number;
  includedLines?: Array<{ startLine: number; endLine: number; label?: string }>;
  truncated?: boolean;
};

export type ContextSymbolEntry = {
  name: string;
  path: string;
  kind: string;
  startLine?: number;
  endLine?: number;
  tokens?: number;
};

export type ContextOmittedEntry = {
  path: string;
  reason: string;
  estimatedTokens?: number;
};

export type ContextPacket = {
  task: string;
  prompt: string;
  estimatedTokens: number;
  files: ContextFileEntry[];
  symbols: ContextSymbolEntry[];
  omitted?: ContextOmittedEntry[];
  warnings?: string[];
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
  answer?: string;
  files: string[];
  checks: CheckResult[];
  message: string;
  changeSetId?: string;
  checkpointId?: string;
  runtimeIntent?: string;
};

export type RuntimeActionKind =
  | "ask"
  | "patch"
  | "retrieve"
  | "context"
  | "inspect"
  | "graph"
  | "index"
  | "reindex"
  | "check"
  | "smoke"
  | "setup-check";

export type RuntimeAction = {
  kind: RuntimeActionKind;
  prompt?: string;
  target?: string;
  paths?: string[];
  model?: string;
  taskId?: string;
  apply?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

export type RuntimeTaskStatus = "queued" | "planning" | "retrieving" | "packing" | "generating" | "validating" | "applying" | "checking" | "reindexing" | "completed" | "failed" | "cancelled";

export type RuntimeTaskResult = {
  taskId: string;
  ok: boolean;
  status: RuntimeTaskStatus;
  message?: string;
  answer?: string;
  diff?: string;
  files?: string[];
  checks?: CheckResult[];
  packet?: ContextPacket;
  data?: unknown;
};

export type ContextPlan = {
  mode: string;
  objective: string;
  searchQueries: string[];
  fileHints: string[];
  symbolHints: string[];
  tagHints: number[];
  requiredFiles: string[];
  forbiddenFiles: string[];
  includeTests: boolean;
  includeTypes: boolean;
  includeSummaries: boolean;
  graphDepth: number;
  maxFiles: number;
  maxSymbols: number;
  maxTokens: number;
};

export type ModelProfile = {
  id: string;
  provider: string;
  supportsNativeTools: boolean;
  supportsJsonMode: boolean;
  supportsDiffs: boolean;
  preferredToolMode: Exclude<ToolMode, "auto">;
  roles: string[];
};

export type WorkItemStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "needs_review"
  | "done"
  | "cancelled"
  | "failed";

export type WorkItemSource = "user" | "agent" | "organizer" | "api";

export type WorkItem = {
  id: string;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status: WorkItemStatus;
  priority: number;
  source: WorkItemSource;
  assignedAgentId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Checkpoint = {
  id: string;
  taskId?: string | null;
  label: string;
  gitHead?: string | null;
  dirtyBefore: boolean;
  files: string[];
  preDiffPath?: string | null;
  appliedDiffPath?: string | null;
  createdAt: number;
};

export type ChangeSetStatus =
  | "proposed"
  | "partially_accepted"
  | "accepted"
  | "rejected"
  | "applied"
  | "reverted";

export type ChangedFileReviewStatus = "pending" | "accepted" | "rejected";

export type ChangeSet = {
  id: string;
  taskId?: string | null;
  checkpointId?: string | null;
  diff: string;
  status: ChangeSetStatus;
  summary?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChangedFileReview = {
  id: string;
  changeSetId: string;
  path: string;
  status: ChangedFileReviewStatus;
  additions: number;
  deletions: number;
};

export type ChangedHunkReviewStatus = "pending" | "accepted" | "rejected";

export type ChangedHunkReview = {
  id: string;
  changeSetId: string;
  changedFileId: string;
  path: string;
  hunkIndex: number;
  header: string;
  status: ChangedHunkReviewStatus;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  additions: number;
  deletions: number;
};

export type TaskPlanStepStatus =
  | "todo"
  | "doing"
  | "done"
  | "skipped"
  | "failed";

export type TaskPlanStep = {
  id: string;
  taskId: string;
  title: string;
  status: TaskPlanStepStatus;
  notes?: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type OrganizerProject = {
  id: string;
  name: string;
  description?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type OrganizerBucket = {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type OrganizerTaskStatus =
  | "queued"
  | "assigned"
  | "accepted"
  | "running"
  | "reviewing"
  | "iterating"
  | "needs_review"
  | "auto_approved"
  | "completed"
  | "skipped"
  | "failed"
  | "cancelled";

export type OrganizerTaskMode =
  | "ask"
  | "patch"
  | "retrieve"
  | "context"
  | "index"
  | "check";

export type OrganizerTask = {
  id: string;
  projectId: string;
  bucketId?: string | null;
  title: string;
  prompt: string;
  mode: OrganizerTaskMode;
  priority: number;
  status: OrganizerTaskStatus;
  assignedAgentId?: string | null;

  implementModel?: string | null;
  reviewModel?: string | null;
  maxIterations: number;
  currentIteration: number;
  autoApprove: boolean;
  autoApply: boolean;
  requireChecks: boolean;
  checksJson?: string | null;

  remoteTaskId?: string | null;
  remoteChangeSetId?: string | null;
  resultJson?: string | null;

  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type OrganizerTaskEvent = {
  id: string;
  taskId: string;
  agentId?: string | null;
  eventType: string;
  message: string;
  payloadJson?: string | null;
  createdAt: number;
};

export type OrganizerReviewDecision =
  | "approve"
  | "request_changes"
  | "reject"
  | "failed";

export type OrganizerTaskIterationStatus =
  | "queued"
  | "running"
  | "reviewing"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "failed";

export type OrganizerTaskIteration = {
  id: string;
  taskId: string;
  agentId: string;
  iterationIndex: number;
  implementModel?: string | null;
  reviewModel?: string | null;
  prompt: string;
  reviewPrompt?: string | null;
  workerTaskId?: string | null;
  workerChangeSetId?: string | null;
  resultJson?: string | null;
  reviewJson?: string | null;
  reviewDecision?: OrganizerReviewDecision | null;
  reviewFeedback?: string | null;
  reviewNextPrompt?: string | null;
  implementationSummary?: string | null;
  changedFilesJson?: string | null;
  diffPreview?: string | null;
  diffStatJson?: string | null;
  checkResultsJson?: string | null;
  status: OrganizerTaskIterationStatus;
  createdAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type TaskImportFormat = "auto" | "plain" | "markdown" | "csv" | "json";

export type ParsedImportedTask = {
  title: string;
  prompt?: string;
  description?: string;
  bucketName?: string;
  status?: string;
  priority?: number;
  assignedAgentId?: string;
  implementModel?: string;
  reviewModel?: string;
  maxIterations?: number;
  autoApprove?: boolean;
  autoApply?: boolean;
  requireChecks?: boolean;
  checks?: string[];
};

export type TaskImportDefaults = {
  projectId?: string;
  bucketId?: string;
  bucketName?: string;
  assignedAgentId?: string;
  implementModel?: string;
  reviewModel?: string;
  maxIterations?: number;
  autoApprove?: boolean;
  autoApply?: boolean;
  requireChecks?: boolean;
  checks?: string[];
  priority?: number;
};

export type TaskImportOptions = {
  createMissingBuckets?: boolean;
  skipDuplicates?: boolean;
  dispatchImmediately?: boolean;
};

export type TaskImportPreview = {
  format: TaskImportFormat;
  tasks: ParsedImportedTask[];
  warnings: string[];
};

export type TaskImportResult = {
  created: number;
  skipped: number;
  bucketsCreated: number;
  taskIds: string[];
  warnings: string[];
};

export type ChatSessionScope =
  | "local"
  | "task"
  | "change_set"
  | "organizer_remote_agent";

export type ChatMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "question"
  | "event"
  | "error";

export type ChatMessageStatus =
  | "pending"
  | "streaming"
  | "complete"
  | "failed"
  | "cancelled";

export type ChatSession = {
  id: string;
  title: string;
  scope: ChatSessionScope;
  taskId?: string | null;
  changeSetId?: string | null;
  remoteAgentId?: string | null;
  remoteSessionId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  model?: string | null;
  actionKind?: string | null;
  runtimeTaskId?: string | null;
  parentMessageId?: string | null;
  metadataJson?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type UserQuestionKind =
  | "confirm"
  | "select"
  | "text"
  | "secret"
  | "file"
  | "model_select";

export type UserQuestionStatus =
  | "open"
  | "answered"
  | "cancelled"
  | "expired";

export type UserQuestion = {
  id: string;
  sessionId: string;
  messageId: string;
  kind: UserQuestionKind;
  prompt: string;
  optionsJson?: string | null;
  defaultValueJson?: string | null;
  answerJson?: string | null;
  status: UserQuestionStatus;
  createdAt: number;
  answeredAt?: number | null;
};

export type TaskFlowTemplateFormat =
  | "markdown"
  | "json"
  | "csv"
  | "plain";

export type TaskFlowTemplateKind =
  | "basic_task_list"
  | "bugfix_flow"
  | "feature_flow"
  | "reviewed_iteration_flow"
  | "mobile_ui_flow"
  | "custom_blank";

export type TaskFlowTemplate = {
  id: string;
  title: string;
  description: string;
  kind: TaskFlowTemplateKind;
  recommendedFormats: TaskFlowTemplateFormat[];
};

export type TaskFlowTemplateOptions = {
  projectName?: string;
  bucketName?: string;
  assignedAgentId?: string;
  implementModel?: string;
  reviewModel?: string;
  maxIterations?: number;
  autoApprove?: boolean;
  autoApply?: boolean;
  requireChecks?: boolean;
  checks?: string[];
  includeBuckets?: boolean;
  includePolicies?: boolean;
  includeDescriptions?: boolean;
};
