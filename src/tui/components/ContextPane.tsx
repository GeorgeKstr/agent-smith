import React from "react";
import { Box, Text } from "ink";
import type { ContextPacket } from "../../types/index.js";

export function ContextPane({
  packet,
  active,
  answer
}: {
  packet: ContextPacket | null;
  active: boolean;
  answer?: string;
}) {
  return (
    <Box flexDirection="column" width="50%" borderStyle="round" borderColor={active ? "greenBright" : "green"} paddingX={1}>
      <Text color="greenBright">{answer !== undefined ? "Answer" : "Context Packet"}</Text>
      {answer !== undefined ? (
        answer
          .split("\n")
          .slice(0, 8)
          .map((line, i) => (
            <Text key={i} color="white">
              {line.slice(0, 56)}
            </Text>
          ))
      ) : !packet ? (
        <Text color="gray">selected files: pending</Text>
      ) : (
        <>
          <Text color="cyan">~{packet.estimatedTokens} tokens · {packet.files.length} files</Text>
          {packet.files.slice(0, 5).map((f, i) => (
            <Text key={i} color="green">
              · {f.path.slice(0, 48)}
            </Text>
          ))}
          {packet.symbols.slice(0, 3).map((s, i) => (
            <Text key={`s-${i}`} color="gray">
              ◇ {s.kind} {s.name.slice(0, 36)}
            </Text>
          ))}
        </>
      )}
    </Box>
  );
}
