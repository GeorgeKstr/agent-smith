import React from "react";
import { Box, Text } from "ink";

function lineColor(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "green";
  if (line.startsWith("-") && !line.startsWith("---")) return "red";
  if (line.startsWith("@@")) return "cyan";
  if (line.startsWith("diff ") || line.startsWith("+++") || line.startsWith("---")) return "yellow";
  return "gray";
}

export function PatchPane({ patchText, active }: { patchText: string; active: boolean }) {
  const lines = patchText ? patchText.split("\n").slice(0, 12) : [];
  return (
    <Box flexDirection="column" width="50%" borderStyle="round" borderColor={active ? "greenBright" : "green"} paddingX={1}>
      <Text color="greenBright">Patch / Test Output</Text>
      {lines.length === 0 ? (
        <Text color="gray">unified diffs will appear here</Text>
      ) : (
        lines.map((line, i) => (
          <Text key={i} color={lineColor(line)}>
            {line.slice(0, 56)}
          </Text>
        ))
      )}
    </Box>
  );
}
