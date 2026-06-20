import type { RuntimeIntent } from "./runtimeIntent.js";

export type ToolPermissionLevel =
  | "none"
  | "readonly"
  | "write";

export function permissionLevelForIntent(intent: RuntimeIntent): ToolPermissionLevel {
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

export function toolsForRuntimeIntent(intent: RuntimeIntent): string[] {
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
  "delete_file",
  "move_file",
  "rename_file",
  "write_file"
];

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.includes(toolName);
}
