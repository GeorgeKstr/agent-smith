export function createEmptyRunMetrics() {
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
