export function permissionLevelForIntent(intent) {
    switch (intent) {
        case "chat":
            return "none";
        case "ask":
            return "readonly";
        case "patch":
            return "write";
        case "command":
            return "none";
    }
}
export function toolsForRuntimeIntent(intent) {
    switch (intent) {
        case "chat":
            return [];
        case "ask":
            return ["search", "read", "ask_user", "finish"];
        case "patch":
            return [
                "search",
                "read",
                "propose_edit",
                "create_file",
                "edit",
                "replace_lines",
                "check",
                "ask_user",
                "finish"
            ];
        case "command":
            return [];
    }
}
export const WRITE_TOOLS = [
    "create_file",
    "edit",
    "replace_lines",
    "append_to_file",
    "delete_file",
    "move_file",
    "rename_file",
    "write_file"
];
export function isWriteTool(toolName) {
    return WRITE_TOOLS.includes(toolName);
}
