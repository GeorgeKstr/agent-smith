export function shouldQueueFileOperation(input) {
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
export function riskForKind(kind) {
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
export function makeOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
