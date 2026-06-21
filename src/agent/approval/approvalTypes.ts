export type FileOperationKind =
  | "create_file"
  | "edit_file"
  | "replace_lines"
  | "delete_file"
  | "rename_file"
  | "move_file";

export type FileOperationRisk = "write" | "destructive";

export type PendingFileOperation = {
  id: string;
  kind: FileOperationKind;
  risk: FileOperationRisk;
  path: string;
  newPath?: string;
  beforeText?: string;
  afterText?: string;
  diff?: string;
  reason: string;
  createdAt: string;
  taskId?: string;
  status: "pending" | "approved" | "rejected" | "applied" | "failed";
  error?: string;
};

export type ApprovalPolicyKind = "never" | "on_write" | "on_destructive" | "always";

export function shouldQueueFileOperation(input: {
  policy: ApprovalPolicyKind;
  kind: FileOperationKind;
  risk: FileOperationRisk;
}): boolean {
  switch (input.policy) {
    case "never":
      return false;

    case "on_write":
      return true;

    case "on_destructive":
      return input.risk === "destructive";

    case "always":
      return true;
  }
}

export function riskForKind(kind: FileOperationKind): FileOperationRisk {
  switch (kind) {
    case "create_file":
    case "edit_file":
    case "replace_lines":
      return "write";
    case "delete_file":
    case "rename_file":
    case "move_file":
      return "destructive";
  }
}

export function makeOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
