export function createEmptyRunEvidence() {
    return {
        filesRead: [],
        filesEdited: [],
        filesCreated: [],
        checksRun: [],
        toolResults: [],
        pendingFileOperations: [],
        approvedFileOperations: [],
        rejectedFileOperations: [],
        appliedFileOperations: [],
    };
}
