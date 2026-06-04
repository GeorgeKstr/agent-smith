import React from "react"
import { Box, Text } from "ink"
import { theme } from "../theme.js"

export function Header({
  root,
  model,
  ollamaReady,
}: {
  root: string
  model: string
  ollamaReady: boolean | null
}) {
  const modelName = model.includes("/") ? model.split("/").pop() : model
  const led = ollamaReady === null ? theme.warn : ollamaReady ? theme.primary : theme.error
  const ledText = ollamaReady === null ? "?" : ollamaReady ? "●" : "○"
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        <Text color={theme.primary} backgroundColor="black">{modelName}</Text>
        <Text color={theme.dim} backgroundColor="black">@</Text>
        <Text color={theme.text} backgroundColor="black">{root.split("/").pop()}</Text>
      </Text>
      <Text color={led} backgroundColor="black">
        {ledText} ollama
      </Text>
    </Box>
  )
}
