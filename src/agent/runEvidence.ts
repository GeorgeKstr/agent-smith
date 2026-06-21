export type CheckEvidence = {
  name: string;
  ok: boolean;
  summary?: string;
};

export type RunEvidence = {
  filesRead: string[];
  filesEdited: string[];
  filesCreated: string[];
  checksRun: CheckEvidence[];
  toolResults: Array<{ tool: string; ok: boolean; summary: string }>;
  pendingFileOperations: string[];
  approvedFileOperations: string[];
  rejectedFileOperations: string[];
  appliedFileOperations: string[];
};

export function createEmptyRunEvidence(): RunEvidence {
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
