import React from "react"
import { Box, Text, useInput } from "ink"
import type { ContextPacket } from "../../types/index.js"
import { theme } from "../theme.js"

export type ContextPreviewProps = {
  packet: ContextPacket | null
  maxTokens: number
  onBack: () => void
}

function blackBg(width: number, c: string) {
  return <Text backgroundColor="black">{" ".repeat(Math.max(0, width))}</Text>
}

export function ContextPreview(props: ContextPreviewProps) {
  useInput((_char, key) => {
    if (key.escape || (key.ctrl && _char === "c")) {
      props.onBack()
    }
  })

  const pkt = props.packet
  if (!pkt) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={theme.accent} backgroundColor="black">Context Preview</Text>
          <Text color={theme.dim} backgroundColor="black">Esc/^C to go back</Text>
        </Box>
        <Box height={1} />
        <Text color={theme.dim} backgroundColor="black">No context packet available. Run a task first.</Text>
      </Box>
    )
  }

  const files = pkt.files ?? []
  const symbols = pkt.symbols ?? []
  const pct = props.maxTokens > 0 ? Math.round((pkt.estimatedTokens / props.maxTokens) * 100) : 0

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={theme.accent} backgroundColor="black">Context Preview</Text>
        <Text color={theme.dim} backgroundColor="black">Esc/^C to go back</Text>
      </Box>
      <Box height={1} />

      <Text color={theme.dim} backgroundColor="black">Task</Text>
      <Text color={theme.text} backgroundColor="black">{(pkt.task || "(none)").slice(0, 200)}</Text>
      <Box height={1} />

      <Box flexDirection="row">
        <Text color={theme.dim} backgroundColor="black">Tokens: </Text>
        <Text color={pct > 80 ? theme.warn : theme.accent} backgroundColor="black">{pkt.estimatedTokens >= 1000 ? (pkt.estimatedTokens / 1000).toFixed(1) + "k" : String(pkt.estimatedTokens)}</Text>
        <Text color={theme.dim} backgroundColor="black"> / {props.maxTokens >= 1000 ? (props.maxTokens / 1000).toFixed(0) + "k" : String(props.maxTokens)} ({pct}%)</Text>
      </Box>
      <Box height={1} />

      <Text color={theme.dim} backgroundColor="black">Files ({files.length})</Text>
      {files.length === 0 ? (
        <Text color={theme.dim} backgroundColor="black">  (none)</Text>
      ) : (
        files.slice(0, 20).map((f, i) => (
          <Box key={i} flexDirection="row">
            <Text color={theme.dim} backgroundColor="black">{String(i + 1).padStart(2)}. </Text>
            <Text color={theme.accent} backgroundColor="black">{f.path}</Text>
            <Text color={theme.dim} backgroundColor="black"> ({f.reason})</Text>
          </Box>
        ))
      )}
      <Box height={1} />

      <Text color={theme.dim} backgroundColor="black">Symbols ({symbols.length})</Text>
      {symbols.length === 0 ? (
        <Text color={theme.dim} backgroundColor="black">  (none)</Text>
      ) : (
        symbols.slice(0, 20).map((s, i) => (
          <Box key={i} flexDirection="row">
            <Text color={theme.dim} backgroundColor="black">{String(i + 1).padStart(2)}. </Text>
            <Text color={theme.accent} backgroundColor="black">{s.name}</Text>
            <Text color={theme.dim} backgroundColor="black"> @ {s.path} ({s.kind})</Text>
          </Box>
        ))
      )}
      <Box height={1} />

      <Text color={theme.dim} backgroundColor="black">Prompt (first 2000 chars)</Text>
      <Text color={theme.text} backgroundColor="black">{(pkt.prompt || "").slice(0, 2000)}</Text>
    </Box>
  )
}
