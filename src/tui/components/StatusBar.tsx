import React from "react"
import { Box, Text } from "ink"
import { theme } from "../theme.js"
import type { PromptIntent } from "../../types/index.js"

const BG = "black"

export const StatusBar = React.memo(function StatusBar({
  filesTotal,
  dirtyFiles,
  tokens,
  maxTokens,
  busy,
  mode,
  intent,
  width,
  scanPhase,
  scanProgress,
  scanScanned,
  scanTotal,
}: {
  filesTotal: number
  dirtyFiles: number
  tokens: number
  maxTokens: number
  busy: boolean
  mode: "discuss" | "build"
  intent: PromptIntent | null
  width: number
  scanPhase?: string
  scanProgress?: number
  scanScanned?: number
  scanTotal?: number
}) {
  const intentText = intent ? `${intent.kind} ${Math.round(intent.confidence * 100)}%` : "-"
  const intentColor =
    intent?.kind === "task" ? theme.primary : intent?.kind === "chat" ? theme.accent : theme.warn

  const sBusy = busy ? "working" : "●"
  const sMode = mode
  const sFiles = `${filesTotal} files`
  const sDirty = dirtyFiles > 0 ? `${dirtyFiles} dirty` : ""
  const sCtx = `ctx ${tokens}/${maxTokens}`
  const sIntentLabel = "intent"
  const left = [sBusy, sMode, sFiles, sDirty, sCtx, sIntentLabel, intentText].filter(Boolean).join("  ")

  return (
    <Box paddingX={1} paddingY={0} flexDirection="column">
      <Box>
        <Text backgroundColor={BG}>
          <Text color={busy ? theme.warn : theme.primary}>{sBusy}</Text>
          <Text color={mode === "build" ? theme.warn : theme.accent}>  {sMode}</Text>
          <Text color={theme.text}>  {sFiles}</Text>
          {dirtyFiles > 0 && <Text color={theme.warn}>  {sDirty}</Text>}
          <Text color={theme.dim}>  {sCtx}</Text>
          <Text color={theme.dim}>  {sIntentLabel} </Text>
          <Text color={intentColor}>{intentText}</Text>
          <Text>{" ".repeat(Math.max(0, width - 2 - left.length))}</Text>
        </Text>
      </Box>
      {scanPhase && scanPhase !== "idle" && scanPhase !== "ready" && scanTotal && scanTotal > 0 && (
        <Box>
          <Text backgroundColor={BG}>
            <Text color={theme.accent}>  indexing {scanPhase} </Text>
            <Text color={theme.primary}>{scanScanned ?? 0}/{scanTotal}</Text>
            <Text color={theme.dim}>  {"█".repeat(Math.round((scanProgress ?? 0) * 20))}{"░".repeat(20 - Math.round((scanProgress ?? 0) * 20))}</Text>
          </Text>
        </Box>
      )}
    </Box>
  )
})
