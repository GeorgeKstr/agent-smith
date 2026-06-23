export type AgentRunMetrics = {
  modelTurns: number;
  toolCallsRequested: number;
  toolCallsSucceeded: number;
  toolCallsFailed: number;
  searches: number;
  reads: number;
  edits: number;
  replaceLineEdits: number;
  checks: number;
  askUserCalls: number;
  finalCalls: number;
  invalidOutputs: number;
  tokensEstimatedIn: number;
  tokensEstimatedOut: number;
  progressPolicyRejections: number;
  tagNormalizations: number;
  patchPhasePolicyRejections: number;
  totalSearches: number;
  searchesAfterFirstRead: number;
  broadSearchRejections: number;
  postReadSearchRejections: number;
  editPressureRejections: number;
  proposeEditCalls: number;
  proposeEditAccepted: number;
  proposeEditRejected: number;
  providerRetries: number;
};

export function createEmptyRunMetrics(): AgentRunMetrics {
  return {
    modelTurns: 0,
    toolCallsRequested: 0,
    toolCallsSucceeded: 0,
    toolCallsFailed: 0,
    searches: 0,
    reads: 0,
    edits: 0,
    replaceLineEdits: 0,
    checks: 0,
    askUserCalls: 0,
    finalCalls: 0,
    invalidOutputs: 0,
    tokensEstimatedIn: 0,
    tokensEstimatedOut: 0,
    progressPolicyRejections: 0,
    tagNormalizations: 0,
    patchPhasePolicyRejections: 0,
    totalSearches: 0,
    searchesAfterFirstRead: 0,
    broadSearchRejections: 0,
    postReadSearchRejections: 0,
    editPressureRejections: 0,
    proposeEditCalls: 0,
    proposeEditAccepted: 0,
    proposeEditRejected: 0,
    providerRetries: 0,
  };
}
