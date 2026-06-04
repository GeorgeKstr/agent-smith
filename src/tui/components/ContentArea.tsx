import React from "react"
import { Box, Text } from "ink"
import type { ContextPacket } from "../../types/index.js"
import { theme } from "../theme.js"

function lineColor(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "green"
  if (line.startsWith("-") && !line.startsWith("---")) return "red"
  if (line.startsWith("@@")) return "cyan"
  if (line.startsWith("diff ") || line.startsWith("+++") || line.startsWith("---")) return "yellow"
  return theme.dim
}

const BG = "black"

export function ContentArea({
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

  const answerLines = answer.split("\n")
  const patchLines = patchText.split("\n")

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
    const win = windowLines(answerLines)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.primary} backgroundColor={BG}>Answer</Text>
        <Text color={theme.dim} backgroundColor={BG}>{"─".repeat(40)}</Text>
        {win.hasOlder && <Text color={theme.dim} backgroundColor={BG}>↑ older lines</Text>}
        {win.visible.map((line, i) => (
          <Text key={i} color="white" backgroundColor={BG}>
            {truncate(line)}
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

  if (output.length > 0) {
    const win = windowLines(output)
    return (
      <Box flexDirection="column" paddingX={1}>
        {win.hasOlder && <Text color={theme.dim} backgroundColor={BG}>↑ older messages</Text>}
        {win.visible.map((line, i) => (
          <Text key={i} color="white" backgroundColor={BG}>
            {truncate(line)}
          </Text>
        ))}
        {win.hasNewer && <Text color={theme.dim} backgroundColor={BG}>↓ newer messages</Text>}
      </Box>
    )
  }

  if (logs.length > 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {logs.slice(0, 4).map((line, i) => (
          <Text key={i} color={theme.dim} backgroundColor={BG}>
            {truncate(line)}
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
}
