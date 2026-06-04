import React from "react";
import { Box, Text } from "ink";

export function ProjectIntelPane({
  filesTotal,
  dirtyFiles,
  symbolsIndexed,
  tagsRefreshed
}: {
  filesTotal: number;
  dirtyFiles: number;
  symbolsIndexed: number;
  tagsRefreshed: number;
}) {
  return (
    <Box flexDirection="column" width="34%" borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="greenBright">Project Intel</Text>
      <Text color="green">files indexed: {filesTotal}</Text>
      <Text color={dirtyFiles > 0 ? "yellow" : "green"}>dirty files: {dirtyFiles}</Text>
      <Text color="green">symbols: {symbolsIndexed}</Text>
      <Text color="cyan">tagged files: {tagsRefreshed}</Text>
      <Text color="gray">graph: import edges live</Text>
    </Box>
  );
}
