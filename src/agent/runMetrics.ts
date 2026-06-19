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
  };
}
