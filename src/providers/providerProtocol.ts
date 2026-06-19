export type InternalRole = "system" | "user" | "assistant" | "tool";

export type InternalMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: InternalToolCall[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string; ok?: boolean };

export type InternalToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
  providerCallId?: string;
  provider?: "ollama" | "openai" | "anthropic" | "unknown";
  raw?: unknown;
};

export type InternalAssistantResponse = {
  content: string;
  toolCalls: InternalToolCall[];
  raw?: unknown;
};

export type ToolExecutionEnvelope = {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  content: string;
  errorKind?: "unknown_tool" | "permission_denied" | "validation_error" | "execution_error";
};
