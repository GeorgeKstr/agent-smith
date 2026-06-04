import React from "react";
import { Box, Text } from "ink";

export function StatusBar({
  filesTotal,
  dirtyFiles,
  tokens,
  maxTokens,
  mode,
  busy
}: {
  filesTotal: number;
  dirtyFiles: number;
  tokens: number;
  maxTokens: number;
  mode: "ask" | "patch";
  busy: boolean;
}) {
  return (
    <Box borderStyle="single" borderColor="green" paddingX={1} justifyContent="space-between">
      <Text color={busy ? "yellow" : "green"}>● {busy ? "working" : "watch mode engaged"}</Text>
      <Text color="green">{filesTotal} files</Text>
      <Text color={dirtyFiles > 0 ? "yellow" : "green"}>{dirtyFiles > 0 ? `${dirtyFiles} dirty` : "fresh"}</Text>
      <Text color={mode === "patch" ? "yellow" : "cyan"}>{mode}</Text>
      <Text color="cyan">ctx {tokens} / {maxTokens}</Text>
    </Box>
  );
}
