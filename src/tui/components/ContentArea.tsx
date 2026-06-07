import React from "react"
import { Box, Text } from "ink"
import type { ContextPacket } from "../../types/index.js"
import { theme } from "../theme.js"

type DisplayLine = {
  text: string
  color?: string
  bold?: boolean
  dimColor?: boolean
}

function lineColor(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "green"
  if (line.startsWith("-") && !line.startsWith("---")) return "red"
  if (line.startsWith("@@")) return "cyan"
  if (line.startsWith("diff ") || line.startsWith("+++") || line.startsWith("---")) return "yellow"
  return theme.dim
}

function outputLineColor(line: string, busy: boolean, isLastPrompt: boolean): string {
  if (line.startsWith("error:")) return "red"
  if (line.startsWith("✓") || line.includes(" PASS ")) return "green"
  if (line.includes(" FAIL ")) return "red"
  if (line.startsWith("⌘ ")) return "cyan"
  if (line.startsWith("▶ ")) {
    if (busy && isLastPrompt) return "yellow"
    return theme.accent
  }
  if (line.startsWith("AI:")) return theme.primary
  if (line.startsWith("↻") || line.startsWith("↶")) return "yellow"
  if (line.startsWith("Active model:") || line.startsWith("* ")) return "magenta"
  return "white"
}

const BG = "black"

function normalizeInlineMd(line: string): string {
  return line
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
}

function markdownLines(markdown: string): DisplayLine[] {
  const lines = markdown.split("\n")
  const out: DisplayLine[] = []
  let inFence = false

  for (const raw of lines) {
    const line = raw ?? ""

    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push({ text: inFence ? "┌ code" : "└ end", color: theme.dim, dimColor: true })
      continue
    }

    if (inFence) {
      out.push({ text: `  ${line}`, color: "yellow" })
      continue
    }

    if (/^\s*#{1,6}\s+/.test(line)) {
      const text = normalizeInlineMd(line.replace(/^\s*#{1,6}\s+/, ""))
      out.push({ text, color: theme.accent, bold: true })
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      out.push({ text: `│ ${normalizeInlineMd(line.replace(/^\s*>\s?/, ""))}`, color: theme.dim, dimColor: true })
      continue
    }

    if (/^\s*([-*+]\s+|\d+\.\s+)/.test(line)) {
      const text = normalizeInlineMd(line.replace(/^\s*([-*+]\s+|\d+\.\s+)/, "• "))
      out.push({ text, color: theme.text })
      continue
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push({ text: "─".repeat(28), color: theme.dim, dimColor: true })
      continue
    }

    out.push({ text: normalizeInlineMd(line), color: "white" })
  }

  return out
}

function wrapLine(text: string, width: number): string[] {
  const max = Math.max(12, width)
  if (!text) return [""]
  if (text.length <= max) return [text]

  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const chunk = rest.slice(0, max + 1)
    let cut = chunk.lastIndexOf(" ")
    if (cut < Math.floor(max * 0.45)) {
      const nextSpace = rest.indexOf(" ", max)
      if (nextSpace > 0) {
        cut = nextSpace
      } else {
        out.push(rest)
        rest = ""
        break
      }
    }
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest.length) out.push(rest)
  return out
}

function wrapDisplayLines(lines: DisplayLine[], width: number): DisplayLine[] {
  const out: DisplayLine[] = []
  for (const line of lines) {
    for (const wrapped of wrapLine(line.text, width)) {
      out.push({ ...line, text: wrapped })
    }
  }
  return out
}

function wrapPlainLines(lines: string[], width: number): string[] {
  const out: string[] = []
  for (const line of lines) out.push(...wrapLine(line, width))
  return out
}

function fmtElapsed(startMs: number): string {
  const s = Math.max(0, (Date.now() - startMs) / 1000)
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`
}

function fmtTps(tokens: number, startMs: number): string {
  const s = Math.max(0.1, (Date.now() - startMs) / 1000)
  const tps = tokens / s
  return `${tps.toFixed(1)} t/s`
}

export const ContentArea = React.memo(function ContentArea({
  output,
  logs,
  packet,
  answer,
  patchText,
  busy,
  scrollOffset,
  maxLines,
  maxWidth,
  pendingPrompt,
  streamText,
  streamTokens,
  streamStartMs,
  phase,
  model,
  activeQuestion,
  answerMetrics,
  assistantMetrics,
}: {
  output: string[]
  logs: string[]
  packet: ContextPacket | null
  answer: string
  patchText: string
  busy: boolean
  scrollOffset: number
  maxLines: number
  maxWidth: number
  pendingPrompt?: string | null
  streamText?: string
  streamTokens?: number
  streamStartMs?: number
  phase?: string
  model?: string
  activeQuestion?: { question: string; options: string[]; selectedIndex: number; command: string | null } | null
  answerMetrics?: { totalTimeMs: number; totalTokens: number } | null
  assistantMetrics?: Array<{ totalTimeMs: number; totalTokens: number } | null>
}) {
  const windowLines = <T,>(lines: T[], overrideMax?: number) => {
    const safeMax = Math.max(3, overrideMax ?? maxLines)
    const maxOffset = Math.max(0, lines.length - safeMax)
    const offset = Math.min(scrollOffset, maxOffset)
    const end = Math.max(0, lines.length - offset)
    const start = Math.max(0, end - safeMax)
    return {
      visible: lines.slice(start, end),
      hasOlder: start > 0,
      hasNewer: end < lines.length
    }
  }

  const truncate = (line: string) => {
    const width = Math.max(20, maxWidth)
    return line.length > width ? `${line.slice(0, width - 1)}…` : line
  }

  const answerDisplay = wrapDisplayLines(markdownLines(answer), maxWidth)
  const patchLines = wrapPlainLines(patchText.split("\n"), maxWidth)

  // Reserve 2 rows for the pinned pending-prompt row when it is active
  const pendingRows = pendingPrompt ? 2 : 0
  const historyMaxLines = Math.max(2, maxLines - pendingRows)

  type Bubble = {
    role: "user" | "assistant" | "system" | "patch" | "info"
    lines: string[]
  }

type BubbleRow = {
  id: string
  kind: "HEAD" | "BODY" | "METRICS"
  text: string
  labelColor: string
  bodyColor: string
  bg: string
  border: string
}

  const parseBubbles = (lines: string[]): Bubble[] => {
    const bubbles: Bubble[] = []
    let cur: Bubble | null = null

    const push = () => {
      if (!cur || cur.lines.length === 0) return
      bubbles.push(cur)
      cur = null
    }

    for (const raw of lines) {
      if (raw.startsWith("▶ ")) {
        push()
        cur = { role: "user", lines: [raw.slice(2)] }
        continue
      }
      if (raw.startsWith("AI: ")) {
        push()
        cur = { role: "assistant", lines: [raw.slice(4)] }
        continue
      }
      if (raw.startsWith("PATCH: ")) {
        push()
        cur = { role: "patch", lines: [raw.slice(7)] }
        continue
      }
      if (raw.startsWith("⌘ ")) {
        push()
        cur = { role: "system", lines: [raw.slice(2)] }
        continue
      }
      if (raw.startsWith("error:")) {
        push()
        cur = { role: "info", lines: [raw] }
        continue
      }
      if (raw.startsWith("  ") && cur) {
        cur.lines.push(raw.trimStart())
        continue
      }
      if (!cur) {
        cur = { role: "info", lines: [raw] }
      } else {
        cur.lines.push(raw)
      }
    }
    push()

    return bubbles
  }

  const bubbleStyle = (role: Bubble["role"]) => {
    if (role === "user") return { label: "You", labelColor: theme.accent, text: "#c8ffd8", bg: "#0b3d23", border: theme.accent }
    if (role === "assistant") return { label: "Smith", labelColor: theme.primary, text: "white", bg: "#1a1a1a", border: theme.primary }
    if (role === "patch") return { label: "Patch", labelColor: "magenta", text: "#f3d1ff", bg: "#2a1038", border: "magenta" }
    if (role === "system") return { label: "System", labelColor: "cyan", text: theme.dim, bg: "#111827", border: "cyan" }
    return { label: "Info", labelColor: "yellow", text: "white", bg: "#2a220f", border: "yellow" }
  }

  const fmtMetric = (m: { totalTimeMs: number; totalTokens: number }): string => {
    const time = m.totalTimeMs >= 60000
      ? `${Math.floor(m.totalTimeMs / 60000)}m${Math.round((m.totalTimeMs % 60000) / 1000)}s`
      : `${(m.totalTimeMs / 1000).toFixed(1)}s`
    return `${time} · ${m.totalTokens} tok · ${(m.totalTokens / Math.max(0.1, m.totalTimeMs / 1000)).toFixed(1)} t/s`
  }

  const buildBubbleRows = (bubbles: Bubble[], metrics: Array<{ totalTimeMs: number; totalTokens: number } | null>): BubbleRow[] => {
    let asstIdx = 0
    return bubbles.flatMap((b, i): BubbleRow[] => {
      const style = bubbleStyle(b.role)
      const head = ` ${style.label} `
      const content = b.lines.flatMap((ln) => wrapLine(ln, Math.max(20, maxWidth - 6)))
      const bodyWidth = Math.max(head.length, ...content.map((ln) => ln.length))
      const paddedHead = head.padEnd(bodyWidth, " ")
      const paddedContent = content.map((ln) => ln.padEnd(bodyWidth, " "))

      const rows: BubbleRow[] = [
        {
          id: `b-${i}-h`,
          kind: "HEAD",
          text: paddedHead,
          labelColor: style.labelColor,
          bodyColor: style.text,
          bg: style.bg,
          border: style.border,
        },
        ...paddedContent.map((ln, lineIndex) => ({
          id: `b-${i}-l-${lineIndex}`,
          kind: "BODY" as const,
          text: ln,
          labelColor: style.labelColor,
          bodyColor: style.text,
          bg: style.bg,
          border: style.border,
        })),
      ]

      if (b.role === "assistant") {
        const m = metrics[asstIdx]
        asstIdx++
        if (m) {
          rows.push({
            id: `b-${i}-m`,
            kind: "METRICS",
            text: fmtMetric(m).padEnd(bodyWidth, " "),
            labelColor: theme.dim,
            bodyColor: theme.dim,
            bg: style.bg,
            border: style.border,
          })
        }
      }

      return rows
    })
  }

  const historyRows = React.useMemo(() => buildBubbleRows(parseBubbles(output), assistantMetrics ?? []), [output, maxWidth, assistantMetrics])

  if (output.length > 0 || pendingPrompt) {
    const win = windowLines(historyRows, historyMaxLines)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.primary} backgroundColor={BG}>History</Text>
        <Text color={theme.dim} backgroundColor={BG}>{"─".repeat(40)}</Text>
        {win.hasOlder && <Text color={theme.dim} backgroundColor={BG}>↑ older messages</Text>}
        {win.visible.map((row) => {
          if (row.kind === "HEAD") {
            return (
              <Text key={row.id} backgroundColor={row.bg} color={row.labelColor} bold>
                <Text color={row.border} backgroundColor={row.bg}>┌ </Text>
                {row.text}
                <Text color={row.border} backgroundColor={row.bg}> ┐</Text>
              </Text>
            )
          }
          return (
            <Text key={row.id} backgroundColor={row.bg} color={row.kind === "METRICS" ? theme.dim : row.bodyColor}>
              <Text color={row.border} backgroundColor={row.bg}>│ </Text>
              {row.text}
              <Text color={row.border} backgroundColor={row.bg}> │</Text>
            </Text>
          )
        })}
        {win.hasNewer && <Text color={theme.dim} backgroundColor={BG}>↓ newer messages</Text>}
        {pendingPrompt && wrapPlainLines([pendingPrompt], maxWidth).map((line, i, arr) => (
          <Text key={i} backgroundColor="#002800">
            <Text color="#00ff44" bold backgroundColor="#002800">
              {i === 0 ? "┃ ▶ " : "    "}
            </Text>
            <Text color="#00ff44" backgroundColor="#002800">
              {line}
              {i === arr.length - 1 && " ⟳"}
            </Text>
          </Text>
        ))}
        {busy && streamText && (
          <>
            <Text bold backgroundColor="#1a1a2a">
              <Text color={theme.primary} backgroundColor="#1a1a2a">┌ Smith · {phase || "thinking"}</Text>
              {(streamTokens ?? 0) > 0 && (
                <Text color={theme.dim} backgroundColor="#1a1a2a">
                  {" · "}{streamTokens} tok
                  {(streamStartMs ?? 0) > 0 ? " · " + fmtTps(streamTokens ?? 0, streamStartMs ?? 0) : ""}
                  {(streamStartMs ?? 0) > 0 ? " · " + fmtElapsed(streamStartMs ?? 0) : ""}
                </Text>
              )}
              <Text color={theme.primary} backgroundColor="#1a1a2a"> ┐</Text>
            </Text>
            {wrapPlainLines(streamText.split("\n"), maxWidth).slice(-4).map((line, i, arr) => (
              <Text key={i} color="white" backgroundColor="#1a1a2a">
                <Text color={theme.primary} backgroundColor="#1a1a2a">│ </Text>
                {line}
                {i === arr.length - 1 && <Text color={theme.accent} backgroundColor="#1a1a2a">▊</Text>}
                <Text color={theme.primary} backgroundColor="#1a1a2a"> │</Text>
              </Text>
            ))}
          </>
        )}
      </Box>
    )
  }

  if (patchText) {
    const win = windowLines(patchLines)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.primary} backgroundColor={BG}>Patch</Text>
        <Text color={theme.dim} backgroundColor={BG}>{"─".repeat(40)}</Text>
        {win.hasOlder && <Text color={theme.dim} backgroundColor={BG}>↑ older lines</Text>}
        {win.visible.map((line, i) => (
          <Text key={i} color={lineColor(line)} backgroundColor={BG}>
            {truncate(line)}
          </Text>
        ))}
        {win.hasNewer && <Text color={theme.dim} backgroundColor={BG}>↓ newer lines</Text>}
      </Box>
    )
  }

  if (answer) {
    const win = windowLines(answerDisplay.map((l) => l.text))
    const safeMax = Math.max(3, maxLines)
    const maxOffset = Math.max(0, answerDisplay.length - safeMax)
    const offset = Math.min(scrollOffset, maxOffset)
    const end = Math.max(0, answerDisplay.length - offset)
    const start = Math.max(0, end - safeMax)
    const visible = answerDisplay.slice(start, end)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={theme.primary} backgroundColor={BG}>Answer</Text>
          {answerMetrics && answerMetrics.totalTokens > 0 && (
            <Text color={theme.dim} backgroundColor={BG}>
              {answerMetrics.totalTimeMs >= 60000
                ? `${Math.floor(answerMetrics.totalTimeMs / 60000)}m${Math.round((answerMetrics.totalTimeMs % 60000) / 1000)}s`
                : `${(answerMetrics.totalTimeMs / 1000).toFixed(1)}s`}
              {" · "}{answerMetrics.totalTokens} tok
              {" · "}{(answerMetrics.totalTokens / Math.max(0.1, answerMetrics.totalTimeMs / 1000)).toFixed(1)} t/s
            </Text>
          )}
        </Box>
        <Text color={theme.dim} backgroundColor={BG}>{"─".repeat(40)}</Text>
        {win.hasOlder && <Text color={theme.dim} backgroundColor={BG}>↑ older lines</Text>}
        {visible.map((line, i) => (
          <Text
            key={i}
            color={line.color ?? "white"}
            bold={line.bold}
            dimColor={line.dimColor}
            backgroundColor={BG}
          >
            {line.text}
          </Text>
        ))}
        {win.hasNewer && <Text color={theme.dim} backgroundColor={BG}>↓ newer lines</Text>}
      </Box>
    )
  }

  if (packet) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.accent} backgroundColor={BG}>
          Context · ~{packet.estimatedTokens} tokens · {packet.files.length} files
        </Text>
        <Text color={theme.dim} backgroundColor={BG}>{"─".repeat(40)}</Text>
        {packet.files.slice(0, Math.max(3, maxLines - 6)).map((f, i) => (
          <Text key={i} color={theme.text} backgroundColor={BG}>
            · {truncate(f.path)}
          </Text>
        ))}
        {packet.symbols.slice(0, 5).map((s, i) => (
          <Text key={`s-${i}`} color={theme.dim} backgroundColor={BG}>
            ◇ {s.kind} {s.name}
          </Text>
        ))}
      </Box>
    )
  }

  if (logs.length > 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {wrapPlainLines(logs.slice(0, 4), maxWidth).map((line, i) => (
          <Text key={i} color={theme.dim} backgroundColor={BG}>
            {line}
          </Text>
        ))}
      </Box>
    )
  }

  return (
    <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
      <Box flexDirection="column" alignItems="center">
        <Text color={theme.primary} backgroundColor="#001a00">╔════════════════════════╗</Text>
        <Text color={theme.primary} backgroundColor="#001a00">║                        ║</Text>
        <Text color={theme.primary} backgroundColor="#001a00" bold>║      Agent Smith       ║</Text>
        <Text color={theme.primary} backgroundColor="#001a00">║                        ║</Text>
        <Text color={theme.primary} backgroundColor="#001a00">╚════════════════════════╝</Text>
      </Box>
    </Box>
  )
})
