import React from "react"
import { Box, Text } from "ink"
import type { ContextPacket } from "../../types/index.js"
import { theme } from "../theme.js"

export type InfoPanelProps = {
  root: string
  model: string
  packet: ContextPacket | null
  maxTokens: number
  ollamaReady: boolean | null
  filesTotal: number
  maxLines: number
}

function label(text: string): string {
  return text.length > 16 ? text.slice(0, 15) + "…" : text
}

function progressBar(used: number, max: number, width: number): string {
  if (max <= 0) return ""
  const pct = Math.min(1, used / max)
  const filled = Math.round(pct * width)
  const bar = "█".repeat(filled) + "░".repeat(width - filled)
  return bar
}

export function InfoPanel(props: InfoPanelProps) {
  const project = props.root.split("/").pop()?.slice(0, 16) ?? "?"
  const modelLabel = label(props.model)
  const online = props.ollamaReady === true ? "● online" : props.ollamaReady === false ? "○ offline" : "… checking"
  const onlineColor = props.ollamaReady === true ? theme.accent : props.ollamaReady === false ? theme.error : theme.dim
  const tokens = props.packet?.estimatedTokens ?? 0
  const pct = props.maxTokens > 0 ? Math.round((tokens / props.maxTokens) * 100) : 0
  const bar = progressBar(tokens, props.maxTokens, 14)
  const providerColor = props.ollamaReady ? theme.accent : theme.dim

  return (
    <Box flexDirection="column" paddingLeft={1} overflow="hidden">
      <Box height={1} />
      <Text bold color={theme.accent} backgroundColor="black">Project</Text>
      <Text color={theme.text} backgroundColor="black">{project}</Text>
      <Box height={1} />
      <Text color={theme.dim} backgroundColor="black">Model</Text>
      <Text color={theme.text} backgroundColor="black">{modelLabel}</Text>
      <Box height={1} />
      <Text color={theme.dim} backgroundColor="black">Provider</Text>
      <Text color={onlineColor} backgroundColor="black">{online}</Text>
      <Box height={1} />
      <Text color={theme.dim} backgroundColor="black">Files</Text>
      <Text color={theme.text} backgroundColor="black">{String(props.filesTotal)}</Text>
      <Box height={1} />
      <Text color={theme.dim} backgroundColor="black">Context</Text>
      <Text color={theme.text} backgroundColor="black">{tokens >= 1000 ? (tokens / 1000).toFixed(1) + "k" : String(tokens)}/{props.maxTokens >= 1000 ? (props.maxTokens / 1000).toFixed(0) + "k" : String(props.maxTokens)}</Text>
      <Text color={pct > 80 ? theme.warn : pct > 95 ? theme.error : theme.accent} backgroundColor="black">{bar} {pct}%</Text>
    </Box>
  )
}
