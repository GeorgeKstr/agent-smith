export function createInternalToolCallId(input: {
  provider?: string;
  providerCallId?: string;
  toolName: string;
  index: number;
  turnId: string;
}): string {
  if (input.providerCallId && input.providerCallId.trim()) {
    return input.providerCallId;
  }
  const safeName = input.toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `internal_${input.turnId}_${input.index}_${safeName}`;
}
