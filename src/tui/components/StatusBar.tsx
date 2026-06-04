import React from "react"
import { Box, Text } from "ink"
import { theme } from "../theme.js"
import type { PromptIntent } from "../../types/index.js"

const BG = "black"

export function StatusBar({
  filesTotal,
  dirtyFiles,
  tokens,
  maxTokens,
  busy,
  mode,
  intent,
}: {
  filesTotal: number
  dirtyFiles: number
  tokens: number
  maxTokens: number
  busy: boolean
  mode: "discuss" | "build"
  intent: PromptIntent | null
}) {
  const intentText = intent ? `${intent.kind} ${Math.round(intent.confidence * 100)}%` : "-"
  const intentColor =
    intent?.kind === "task" ? theme.primary : intent?.kind === "chat" ? theme.accent : theme.warn

  return (
    <Box paddingX={1} paddingY={0}>
      <Text backgroundColor={BG}>
        <Text color={busy ? theme.warn : theme.primary}>{busy ? "working" : "●"}</Text>
        <Text color={mode === "build" ? theme.warn : theme.accent}>  {mode}</Text>
        <Text color={theme.text}>  {filesTotal} files</Text>
        {dirtyFiles > 0 && <Text color={theme.warn}>  {dirtyFiles} dirty</Text>}
        <Text color={theme.dim}>  ctx {tokens}/{maxTokens}</Text>
        <Text color={theme.dim}>  intent </Text>
        <Text color={intentColor}>{intentText}</Text>
      </Text>
    </Box>
  )
}
