import React from "react"
import { Box, Text } from "ink"
import { theme } from "../theme.js"

const BG = "black"

export const InputBar = React.memo(function InputBar({
  input,
  busy,
  mode,
  phase,
}: {
  input: string
  busy: boolean
  mode: "discuss" | "build"
  phase: string
}) {
  const isSlash = input.startsWith("/") && !busy
  const promptGlyph = isSlash ? "λ" : "◈"
  const border = busy ? theme.accent : isSlash ? theme.accent : theme.border

  return (
    <Box borderStyle="round" borderColor={border} paddingX={1} paddingY={0} minHeight={3} width="100%">
      <Box flexGrow={1}>
        <Text color={isSlash ? theme.accent : theme.dim} backgroundColor={BG}>{promptGlyph} </Text>
        <Text color={isSlash ? "cyan" : "white"} backgroundColor={BG}>{input}</Text>
        {!busy && <Text color={theme.dim} backgroundColor={BG}>▊</Text>}
      </Box>
      <Box>
        {busy ? (
          <Text color={theme.accent} backgroundColor={BG}>⟳ {phase}…</Text>
        ) : isSlash ? (
          <Text color={theme.accent} backgroundColor={BG}>[CMD]</Text>
        ) : (
          <Text color={mode === "build" ? theme.warn : theme.accent} backgroundColor={BG}>
            [{mode.toUpperCase()}]
          </Text>
        )}
      </Box>
    </Box>
  )
})
