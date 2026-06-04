import React from "react";
import { Box, Text } from "ink";

export function TaskConsolePane({
  logs,
  output,
  mode,
  input,
  busy,
  phase
}: {
  logs: string[];
  output: string[];
  mode: "ask" | "patch";
  input: string;
  busy: boolean;
  phase: string;
}) {
  return (
    <Box flexDirection="column" width="66%" borderStyle="round" borderColor="green" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="greenBright">Task Console</Text>
        <Text color={mode === "patch" ? "yellow" : "cyan"}>[{mode.toUpperCase()}]</Text>
      </Box>
      <Text color="green">
        &gt; {input}
        <Text color="gray">{busy ? "" : "▋"}</Text>
      </Text>
      {busy ? <Text color="cyan">⟳ {phase}…</Text> : <Text color="gray">type a task, press Enter</Text>}
      {output.slice(0, 4).map((line, index) => (
        <Text key={`o-${index}`} color="white">
          {line.slice(0, 80)}
        </Text>
      ))}
      {logs.slice(0, 3).map((line, index) => (
        <Text key={`l-${index}`} color="gray">
          {line.slice(0, 80)}
        </Text>
      ))}
    </Box>
  );
}
