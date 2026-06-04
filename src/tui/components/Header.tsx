import React from "react";
import { Box, Text } from "ink";

export function Header({
  root,
  model,
  ollamaReady
}: {
  root: string;
  model: string;
  ollamaReady: boolean | null;
}) {
  const led = ollamaReady === null ? "yellow" : ollamaReady ? "green" : "red";
  const ledText = ollamaReady === null ? "checking" : ollamaReady ? "online" : "offline";
  return (
    <Box borderStyle="round" borderColor="green" paddingX={1} justifyContent="space-between">
      <Text color="greenBright">▓▒░ AGENT SMITH ░▒▓</Text>
      <Text color="gray">{root}</Text>
      <Text color="cyan">{model}</Text>
      <Text color={led}>● ollama:{ledText}</Text>
    </Box>
  );
}
