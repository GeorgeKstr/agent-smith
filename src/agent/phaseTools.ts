import type { AgentWorkflowPhase } from "./workflowPhase.js";

export function toolsForPhase(phase: AgentWorkflowPhase): string[] {
  switch (phase) {
    case "chat":
      return [];

    case "ask":
      return ["search", "read", "ask_user", "final"];

    case "explore":
      return ["search", "read", "final"];

    case "plan_patch":
      return ["propose_edit", "ask_user", "final"];

    case "apply_patch":
      return ["edit", "replace_lines", "create_file", "ask_user", "final"];

    case "apply_style_patch":
      return ["edit", "replace_lines", "append_to_file", "ask_user", "final"];

    case "verify":
      return ["check", "read", "edit", "replace_lines", "final"];

    case "finalize":
      return [];
  }
}
