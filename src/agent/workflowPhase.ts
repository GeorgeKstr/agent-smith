export type AgentWorkflowPhase =
  | "chat"
  | "ask"
  | "explore"
  | "plan_patch"
  | "apply_patch"
  | "verify"
  | "finalize";

export function phaseLabel(phase: AgentWorkflowPhase): string {
  switch (phase) {
    case "chat":         return "Chat";
    case "ask":          return "Ask";
    case "explore":      return "Explore";
    case "plan_patch":   return "Plan patch";
    case "apply_patch":  return "Apply patch";
    case "verify":       return "Verify";
    case "finalize":     return "Finalize";
  }
}
