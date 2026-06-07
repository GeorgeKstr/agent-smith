import React from "react"
import { Box, Text, useStdout } from "ink"
import type { ContextPacket, PromptIntent } from "../../types/index.js"
import { theme } from "../theme.js"
import { Header } from "../components/Header.js"
import { ContentArea } from "../components/ContentArea.js"
import { MatrixRain } from "../components/MatrixRain.js"
import { InfoPanel } from "../components/InfoPanel.js"

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
  streamText: string
  streamTokens: number
  streamStartMs: number
  pendingPrompt: string | null
  activeQuestion: { question: string; options: string[]; selectedIndex: number; command: string | null } | null
  setupPrompt: string | null
  textInputModal: { prompt: string; onSubmit: string; onCancel?: string } | null
  textInputModalValue: string
  answerMetrics: { totalTimeMs: number; totalTokens: number } | null
  assistantMetrics: Array<{ totalTimeMs: number; totalTokens: number } | null>
  autocomplete: { suggestions: string[]; top: string } | null
  autocompleteIndex: number
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
  setupPrompt,
  autocomplete,
  autocompleteIndex,
}: {
  input: string
  busy: boolean
  mode: "discuss" | "build"
  width: number
  setupPrompt?: string | null
  autocomplete?: { suggestions: string[]; top: string } | null
  autocompleteIndex?: number
}) {
  const gutter = 2
  const barWidth = Math.max(8, width - gutter * 2)
  const contentWidth = Math.max(4, barWidth - 4)
  const modeTag = setupPrompt ? `[SETUP]` : `[${mode.toUpperCase()}]`
  const modeColor = setupPrompt ? theme.accent : mode === "build" ? theme.warn : theme.accent

  const segments = input ? input.split("\n") : [""]
  const lines: string[] = []
  for (const seg of segments) {
    if (!seg) { lines.push(""); continue }
    let pos = 0
    while (pos < seg.length) {
      lines.push(seg.slice(pos, pos + contentWidth))
      pos += contentWidth
    }
  }
  const totalLines = Math.max(1, lines.length)
  const maxVisible = 8
  const visible = lines.slice(-maxVisible)
  const boxHeight = Math.max(3, Math.min(visible.length, maxVisible) + 2)

  return (
    <Box flexDirection="row" width={width} height={boxHeight} overflow="hidden">
      <Box width={gutter} height={boxHeight} overflow="hidden" />

      <Box
        width={barWidth}
        height={boxHeight}
        borderStyle="round"
        borderColor={modeColor}
        overflow="hidden"
      >
        <Box flexDirection="column" width={contentWidth} paddingX={1}>
          {visible.map((line, i) => {
            const isLast = i === visible.length - 1
            const prefix = i === 0 ? (busy ? "⟳ " : "> ") : "  "
            return (
              <Box key={i} width={contentWidth} flexDirection="row">
                <Text backgroundColor="#002200">
                  <Text color={theme.dim} backgroundColor="#002200">{prefix}</Text>
                  <Text color={theme.text} backgroundColor="#002200">{line}</Text>
                </Text>
                {isLast && (
                  <>
                    <Box flexGrow={1}><Text backgroundColor="#002200"> </Text></Box>
                    <Text color={modeColor} bold backgroundColor="#002200">{modeTag}</Text>
                  </>
                )}
              </Box>
            )
          })}
        </Box>
      </Box>

      <Box width={gutter} height={boxHeight} overflow="hidden" />
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

  // Keep ContentArea bounded so it cannot push the footer past the viewport.
  const sidebarWidth = Math.min(22, Math.floor(termCols * 0.22))
  const contentWidth = frameInnerWidth - sidebarWidth - 2
  const contentMaxWidth = Math.max(20, contentWidth - 4)
  const contentLines = Math.max(3, termRows - 14)
  const rainHeight = Math.max(1, termRows - 6)
  const popupWidth = Math.min(frameInnerWidth - 4, Math.max(40, Math.floor(frameInnerWidth * 0.55)))
  const aq = props.activeQuestion

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

        <Box flexGrow={1} flexShrink={1} position="relative" overflow="hidden" flexDirection="row">
          <Box flexGrow={1} flexShrink={1} position="relative" overflow="hidden">
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
              pendingPrompt={props.pendingPrompt}
              streamText={props.streamText}
              streamTokens={props.streamTokens}
              streamStartMs={props.streamStartMs}
              phase={props.phase}
              model={props.model}
              activeQuestion={props.activeQuestion}
              answerMetrics={props.answerMetrics}
              assistantMetrics={props.assistantMetrics}
            />
            {aq && !props.busy && (() => {
              const cw = popupWidth - 2
              const MAX_VISIBLE = Math.min(12, termRows - 10)
              let startIdx = Math.max(0, aq.selectedIndex - Math.floor(MAX_VISIBLE / 2))
              let endIdx = Math.min(aq.options.length, startIdx + MAX_VISIBLE)
              if (endIdx - startIdx < MAX_VISIBLE && startIdx > 0) {
                startIdx = Math.max(0, endIdx - MAX_VISIBLE)
              }
              return (
                <Box position="absolute" width="100%" height="100%" alignItems="center" justifyContent="center">
                  <Box flexDirection="column" width={popupWidth} borderStyle="round" borderColor={theme.accent}>
                    <Text bold color={theme.accent} backgroundColor="black">{"  " + aq.question.padEnd(cw)}</Text>
                    <BlackLine width={cw} />
                    {startIdx > 0 && (
                      <Text color={theme.dim} backgroundColor="black">{"  ↑ " + startIdx + " more..."}</Text>
                    )}
                    {aq.options.slice(startIdx, endIdx).map((opt, i) => {
                      const realIdx = startIdx + i
                      return (
                        <Text key={realIdx} color={realIdx === aq.selectedIndex ? theme.accent : theme.dim} bold={realIdx === aq.selectedIndex} backgroundColor="black">
                          {(realIdx === aq.selectedIndex ? "  → " : "    ") + opt.padEnd(cw - 4)}
                        </Text>
                      )
                    })}
                    {endIdx < aq.options.length && (
                      <Text color={theme.dim} backgroundColor="black">{"  ↓ " + (aq.options.length - endIdx) + " more..."}</Text>
                    )}
                    <BlackLine width={cw} />
                    <Text color={theme.dim} backgroundColor="black">{"  ↑/↓ · Enter · Esc".padEnd(cw)}</Text>
                  </Box>
                </Box>
              )
            })()}
            {props.textInputModal && !props.busy && (() => {
              const cw = popupWidth - 2
              const val = props.textInputModalValue
              const displayVal = val ? val.slice(-(cw - 6)) : ""
              return (
                <Box position="absolute" width="100%" height="100%" alignItems="center" justifyContent="center">
                  <Box flexDirection="column" width={popupWidth} borderStyle="round" borderColor={theme.accent}>
                    <Text bold color={theme.accent} backgroundColor="black">{"  " + props.textInputModal.prompt.padEnd(cw - 2)}</Text>
                    <BlackLine width={popupWidth - 2} />
                    <Box flexDirection="row">
                      <Text color={theme.accent} backgroundColor="black">  {"> "}</Text>
                      <Text backgroundColor="black">{displayVal}</Text>
                      <Text color={theme.accent} backgroundColor="black">▊</Text>
                    </Box>
                    <BlackLine width={popupWidth - 2} />
                    <Text color={theme.dim} backgroundColor="black">{"  Enter · Esc to cancel".padEnd(cw - 2)}</Text>
                  </Box>
                </Box>
              )
            })()}
          </Box>

          <Box width={sidebarWidth} flexDirection="column" overflow="hidden" borderStyle="single" borderColor={theme.border} borderLeft={false} borderRight={false} borderTop={false} borderBottom={false}>
            <InfoPanel
              root={props.root}
              model={props.model}
              packet={props.packet}
              maxTokens={props.maxTokens}
              ollamaReady={props.ollamaReady}
              filesTotal={props.filesTotal}
              maxLines={contentLines}
            />
          </Box>
        </Box>

        {props.autocomplete && props.autocomplete.suggestions.length >= 1 && !props.busy && (() => {
          const items = props.autocomplete.suggestions.slice(0, Math.min(8, props.autocomplete.suggestions.length))
          const itemWidth = Math.max(...items.map(s => s.length))
          const innerWidth = itemWidth + 4
          return (
            <Box flexShrink={0} flexDirection="row" width={frameInnerWidth} overflow="hidden">
              <Box width={2} />
              <Box flexDirection="column">
                <Text backgroundColor="black">
                  <Text color={theme.border} backgroundColor="black">┌</Text>
                  <Text backgroundColor="black">{"─".repeat(innerWidth)}</Text>
                  <Text color={theme.border} backgroundColor="black">┐</Text>
                </Text>
                {items.map((s, i) => {
                  const isSel = i === props.autocompleteIndex
                  return (
                    <Text key={i} backgroundColor="black">
                      <Text color={theme.border} backgroundColor="black">│ </Text>
                      <Text color={isSel ? theme.accent : "#1a3a1a"} bold={isSel} backgroundColor="black">
                        {isSel ? "▸ " : "  "}{s.padEnd(itemWidth, " ")}
                      </Text>
                      <Text color={theme.border} backgroundColor="black"> │</Text>
                    </Text>
                  )
                })}
                <Text backgroundColor="black">
                  <Text color={theme.border} backgroundColor="black">└</Text>
                  <Text backgroundColor="black">{"─".repeat(innerWidth)}</Text>
                  <Text color={theme.border} backgroundColor="black">┘</Text>
                </Text>
              </Box>
              <Box width={2} />
            </Box>
          )
        })()}

        <Box flexShrink={0} flexDirection="column" width={frameInnerWidth} overflow="hidden">
          <PromptBar
            input={props.input}
            busy={props.busy}
            mode={props.mode}
            width={frameInnerWidth}
            setupPrompt={props.setupPrompt}
            autocomplete={props.autocomplete}
            autocompleteIndex={props.autocompleteIndex}
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
