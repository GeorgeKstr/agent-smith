export function phaseLabel(phase) {
    switch (phase) {
        case "chat": return "Chat";
        case "ask": return "Ask";
        case "explore": return "Explore";
        case "plan_patch": return "Plan patch";
        case "apply_patch": return "Apply patch";
        case "apply_style_patch": return "Apply style";
        case "verify": return "Verify";
        case "finalize": return "Finalize";
    }
}
