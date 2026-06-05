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

function outputLineColor(line: string): string {
  if (line.startsWith("error:")) return "red"
  if (line.startsWith("✓") || line.includes(" PASS ")) return "green"
  if (line.includes(" FAIL ")) return "red"
  if (line.startsWith("⌘ ")) return "cyan"
  if (line.startsWith("▶ ")) return theme.accent
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
    if (cut < Math.floor(max * 0.45)) cut = max
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
}) {
  const windowLines = (lines: string[]) => {
    const safeMax = Math.max(3, maxLines)
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

  if (output.length > 0) {
    const win = windowLines(wrapPlainLines(output, maxWidth))
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.primary} backgroundColor={BG}>History</Text>
        <Text color={theme.dim} backgroundColor={BG}>{"─".repeat(40)}</Text>
        {win.hasOlder && <Text color={theme.dim} backgroundColor={BG}>↑ older messages</Text>}
        {win.visible.map((line, i) => (
          <Text key={i} color={outputLineColor(line)} backgroundColor={BG}>
            {line}
          </Text>
        ))}
        {win.hasNewer && <Text color={theme.dim} backgroundColor={BG}>↓ newer messages</Text>}
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
        <Text color={theme.primary} backgroundColor={BG}>Answer</Text>
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
