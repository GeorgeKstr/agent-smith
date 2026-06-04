import React, { useEffect, useMemo, useState } from "react"
import { Box, Text } from "ink"
import type { BootState } from "../../types/index.js"
import { theme } from "../theme.js"

const spinner = ["▖", "▘", "▝", "▗"]

export function BootScreen({ state, animate = true }: { state: BootState; animate?: boolean }) {
  const [tick, setTick] = useState(0)
  const [startAt] = useState(() => Date.now())

  useEffect(() => {
    if (!animate) return
    const id = setInterval(() => setTick((v) => v + 1), 80)
    return () => clearInterval(id)
  }, [animate])

  const frame = spinner[tick % spinner.length]
  const elapsed = Date.now() - startAt
  const introFrames = [
    "wake up, smith",
    "loading matrix kernel",
    "stabilizing context channels",
  ]
  const intro = introFrames[Math.min(introFrames.length - 1, Math.floor(elapsed / 350))]
  const pulseWidth = 18
  const pulseCount = (tick % (pulseWidth + 1))
  const pulseBar = useMemo(() => "█".repeat(pulseCount).padEnd(pulseWidth, "░"), [pulseCount])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} minHeight={10}>
      <Text color={theme.primary}>smith — indexing project</Text>
      <Text color={theme.dim}>{"─".repeat(30)}</Text>
      <Text color={theme.accent}>{intro}</Text>
      <Text color={theme.dim}>{pulseBar}</Text>
      <Text color={theme.text}>
        {frame} {state.phase.toUpperCase()} · {state.filesScanned} files
        {state.filesTotal > 0 && ` / ${state.filesTotal}`}
      </Text>
      {state.dirtyFiles > 0 && (
        <Text color={theme.warn}>{state.dirtyFiles} dirty files</Text>
      )}
      <Text color={theme.dim}>symbols: {state.symbolsIndexed}</Text>
      <Text color={theme.dim}>tags: {state.tagsRefreshed}</Text>
      {state.currentFile && (
        <Text color={theme.dim}>{state.currentFile}</Text>
      )}
    </Box>
  )
}
