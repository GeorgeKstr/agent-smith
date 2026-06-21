export function profileForPhase(phase) {
    switch (phase) {
        case "chat": return "none";
        case "ask": return "readonly";
        case "explore": return "readonly";
        case "plan_patch": return "plan";
        case "apply_patch": return "apply";
        case "apply_style_patch": return "apply";
        case "verify": return "verify";
        case "finalize": return "none";
    }
}
export function profileForIntent(intent) {
    switch (intent) {
        case "chat": return "none";
        case "ask": return "readonly";
        case "patch": return "apply";
        case "command": return "none";
    }
}
export function toolsForProfile(profile) {
    switch (profile) {
        case "none":
            return [];
        case "readonly":
            return ["search", "read", "ask_user", "finish"];
        case "plan":
            return ["propose_edit", "ask_user", "finish"];
        case "apply":
            return ["edit", "replace_lines", "create_file", "ask_user", "finish"];
        case "verify":
            return ["check", "read", "edit", "replace_lines", "finish"];
        case "dangerous":
            return [
                "search", "read",
                "edit", "replace_lines", "create_file",
                "check", "ask_user", "finish",
                "delete_file", "move_file", "rename_file",
            ];
    }
}
export function profileLabel(profile) {
    switch (profile) {
        case "none": return "No tools";
        case "readonly": return "Read-only";
        case "plan": return "Plan";
        case "apply": return "Apply";
        case "verify": return "Verify";
        case "dangerous": return "Dangerous";
    }
}
const TOOL_RISK_MAP = {
    search: "read",
    read: "read",
    ask_user: "read",
    finish: "read",
    propose_edit: "read",
    edit: "write",
    replace_lines: "write",
    create_file: "write",
    check: "command",
    delete_file: "destructive",
    move_file: "destructive",
    rename_file: "destructive",
    write_file: "write",
};
export function toolRisk(toolName) {
    return TOOL_RISK_MAP[toolName] ?? "read";
}
export function requiresApproval(toolName, policy) {
    if (policy === "never")
        return false;
    if (policy === "always")
        return true;
    const risk = toolRisk(toolName);
    switch (policy) {
        case "on_write":
            return risk === "write" || risk === "command" || risk === "network" || risk === "destructive";
        case "on_dangerous":
            return risk === "command" || risk === "network" || risk === "destructive";
        default:
            return false;
    }
}
