import React from "react"
import { Box, Text, useStdout } from "ink"
import type { ContextPacket, PromptIntent } from "../../types/index.js"
import { theme } from "../theme.js"
import { Header } from "../components/Header.js"
import { ContentArea } from "../components/ContentArea.js"
import { MatrixRain } from "../components/MatrixRain.js"

export type MainView = "context" | "patch" | "answer"

export type MainScreenProps = {
  root: string
  model: string
  ollamaReady: boolean | null
  filesTotal: number
  dirtyFiles: number
  logs: string[]
  mode: "discuss" | "build"
  input: string
  busy: boolean
  phase: string
  intent: PromptIntent | null
  packet: ContextPacket | null
  answer: string
  patchText: string
  output: string[]
  maxTokens: number
  animations: boolean
  scrollOffset: number
  scanPhase?: string
  scanProgress?: number
  scanScanned?: number
  scanTotal?: number
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return ""
  if (text.length === width) return text
  if (text.length < width) return text + " ".repeat(width - text.length)
  if (width <= 1) return "…"
  return text.slice(0, width - 1) + "…"
}

function BlackLine({ width }: { width: number }) {
  return <Text backgroundColor="black">{" ".repeat(Math.max(0, width))}</Text>
}


function PromptBar({
  input,
  busy,
  mode,
  width,
}: {
  input: string
  busy: boolean
  mode: "discuss" | "build"
  width: number
}) {
  const gutter = 2
  const barWidth = Math.max(8, width - gutter * 2)
  const fieldInnerWidth = Math.max(1, barWidth - 2)
  const modeTag = `[${mode.toUpperCase()}]`
  const modeColor = mode === "build" ? theme.warn : theme.accent
  const leftRaw = `${busy ? "..." : ">"} ${input}`
  const maxLeft = Math.max(1, fieldInnerWidth - modeTag.length - 1)
  const left = leftRaw.length > maxLeft ? leftRaw.slice(0, Math.max(0, maxLeft - 1)) + "..." : leftRaw
  const gap = Math.max(0, fieldInnerWidth - left.length - modeTag.length)

  return (
    <Box flexDirection="row" width={width} height={3} overflow="hidden">
      <Box width={gutter} height={3} overflow="hidden" />

      <Box
        width={barWidth}
        height={3}
        borderStyle="round"
        borderColor={mode === "build" ? theme.warn : theme.accent}
        overflow="hidden"
      >
        <Text backgroundColor="#002200">
          <Text color={theme.text} backgroundColor="#002200">{left}</Text>
          {gap > 0 && <Text backgroundColor="#002200">{" ".repeat(gap)}</Text>}
          <Text color={modeColor} bold backgroundColor="#002200">{modeTag}</Text>
        </Text>
      </Box>

      <Box width={gutter} height={3} overflow="hidden" />
    </Box>
  )
}

function intentLabel(intent: PromptIntent | null): string {
  if (!intent) return "intent:none"
  if (typeof intent === "string") return intent
  const obj = intent as Record<string, unknown>
  const raw = obj.type ?? obj.kind ?? obj.name ?? obj.intent
  return typeof raw === "string" && raw ? raw : "intent"
}

function MainStatusLine({
  filesTotal,
  dirtyFiles,
  tokens,
  maxTokens,
  busy,
  mode,
  intent,
  width,
  phase,
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
  phase: string
  scanPhase?: string
  scanProgress?: number
  scanScanned?: number
  scanTotal?: number
}) {
  const gutter = 2
  const iName = intentLabel(intent)
  const iColor = iName === "task" ? theme.primary : iName === "chat" ? theme.accent : theme.warn
  const isScanning = scanPhase && scanPhase !== "idle" && scanPhase !== "ready"
  const modeColor = mode === "build" ? theme.warn : theme.accent
  const ctxStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  const maxCtxStr = maxTokens >= 1000 ? `${(maxTokens / 1000).toFixed(0)}k` : String(maxTokens)

  let statusIcon: string
  let statusColor: string
  let statusLabel: string
  if (isScanning) {
    statusIcon = ">"
    statusColor = theme.accent
    statusLabel = `${scanPhase} ${scanScanned ?? 0}/${scanTotal ?? "?"}`
  } else if (busy) {
    statusIcon = "*"
    statusColor = theme.warn
    statusLabel = phase || "processing"
  } else if (phase === "error") {
    statusIcon = "x"
    statusColor = "#ff4444"
    statusLabel = "error"
  } else {
    statusIcon = ">"
    statusColor = theme.primary
    statusLabel = "ready"
  }

  return (
    <Box flexDirection="row" width={width} height={2} overflow="hidden">
      <Box width={gutter} height={2} overflow="hidden" />
      <Text backgroundColor="black">
        <Text color={statusColor} backgroundColor="black">{statusLabel}</Text>
        <Text color={theme.dim} backgroundColor="black"> | </Text>
        <Text color={modeColor} backgroundColor="black">{mode}</Text>
        <Text color={theme.dim} backgroundColor="black"> | </Text>
        <Text color={theme.text} backgroundColor="black">{filesTotal} files</Text>
        {dirtyFiles > 0 && <Text color={theme.warn} backgroundColor="black"> {dirtyFiles} dirty</Text>}
        <Text color={theme.dim} backgroundColor="black"> | </Text>
        <Text color={theme.dim} backgroundColor="black">ctx {ctxStr}/{maxCtxStr}</Text>
        <Text color={theme.dim} backgroundColor="black"> | </Text>
        <Text color={iColor} backgroundColor="black">{iName}</Text>
      </Text>
      <Box flexGrow={1} height={2} overflow="hidden" />
      <Text color={theme.dim} backgroundColor="black">{busy ? phase : "idle"}</Text>
      <Box width={gutter} height={2} overflow="hidden" />
    </Box>
  )
}

function BlackCanvas({ width, height }: { width: number; height: number }) {
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {Array.from({ length: Math.max(0, height) }, (_, i) => (
        <BlackLine key={`black-canvas-${i}`} width={width} />
      ))}
    </Box>
  )
}

export function MainScreen(props: MainScreenProps) {
  const { stdout } = useStdout()
  const termRows = stdout.rows ?? 24
  const termCols = stdout.columns ?? 80

  // The outer border consumes two columns and two rows. Keep all manual padding/fill
  // inside that interior width so Ink never wraps into an extra terminal line.
  const frameInnerWidth = Math.max(1, termCols - 2)
  const contentMaxWidth = Math.max(20, frameInnerWidth - 4)

  // Fixed chrome, roughly: border + header + input + status + footer.
  // Keep ContentArea bounded so it cannot push the footer past the viewport.
  const contentLines = Math.max(3, termRows - 14)
  const rainHeight = Math.max(1, termRows - 6)

  const footer = fitLine(
    "/help · Enter submit · Esc clear · ↑/↓ scroll · Ctrl+↑/↓ prompt history · PgUp/PgDn fast scroll · Ctrl+C quit",
    frameInnerWidth,
  )

  return (
    <Box position="relative" flexDirection="column" width={termCols} height={termRows} overflow="hidden">
      <Box position="absolute" width={termCols} height={termRows} overflow="hidden">
        <BlackCanvas width={termCols} height={termRows} />
      </Box>

      {props.animations && (
        <Box position="absolute" width={termCols} height={termRows} overflow="hidden">
          <MatrixRain enabled={props.animations} maxRows={rainHeight} />
        </Box>
      )}

      <Box
        flexDirection="column"
        width={termCols}
        height={termRows}
        borderStyle="round"
        borderColor={theme.primary}
        overflow="hidden"
      >
        <Box flexShrink={0} flexDirection="column" overflow="hidden">
          <Header
            root={props.root}
            model={props.model}
            ollamaReady={props.ollamaReady}
          />
        </Box>

        <Box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
          <ContentArea
            output={props.output}
            logs={props.logs}
            packet={props.packet}
            answer={props.answer}
            patchText={props.patchText}
            busy={props.busy}
            scrollOffset={props.scrollOffset}
            maxLines={contentLines}
            maxWidth={contentMaxWidth}
          />
        </Box>

        <Box flexShrink={0} flexDirection="column" width={frameInnerWidth} overflow="hidden">
          <PromptBar
            input={props.input}
            busy={props.busy}
            mode={props.mode}
            width={frameInnerWidth}
          />
        </Box>

        <Box flexShrink={0} overflow="hidden">
          <MainStatusLine
            filesTotal={props.filesTotal}
            dirtyFiles={props.dirtyFiles}
            tokens={props.packet?.estimatedTokens ?? 0}
            maxTokens={props.maxTokens}
            busy={props.busy}
            mode={props.mode}
            intent={props.intent}
            width={frameInnerWidth}
            phase={props.phase}
            scanPhase={props.scanPhase}
            scanProgress={props.scanProgress}
            scanScanned={props.scanScanned}
            scanTotal={props.scanTotal}
          />
        </Box>

        <Box flexShrink={0} overflow="hidden">
          <Box flexDirection="row" width={frameInnerWidth} height={2} overflow="hidden">
            <Box width={2} height={2} overflow="hidden" />
            <Text color={theme.dim} backgroundColor="black">{footer}</Text>
            <Box flexGrow={1} height={2} overflow="hidden" />
            <Box width={2} height={2} overflow="hidden" />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
