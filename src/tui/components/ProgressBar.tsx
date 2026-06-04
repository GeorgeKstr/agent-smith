import React from "react";
import { Text } from "ink";

export function ProgressBar({ progress, width = 32 }: { progress: number; width?: number }) {
  const clamped = Math.max(0, Math.min(1, progress));
  const filled = Math.round(clamped * width);
  const empty = width - filled;

  return (
    <Text color="green">
      [{"█".repeat(filled)}{"░".repeat(empty)}] {Math.round(clamped * 100)}%
    </Text>
  );
}
