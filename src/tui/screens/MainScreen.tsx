import React from "react"
import { Box, Text, useStdout } from "ink"
import type { ContextPacket, PromptIntent } from "../../types/index.js"
import { theme } from "../theme.js"
import { Header } from "../components/Header.js"
import { ContentArea } from "../components/ContentArea.js"
import { InputBar } from "../components/InputBar.js"
import { StatusBar } from "../components/StatusBar.js"
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
}

export function MainScreen(props: MainScreenProps) {
  const { stdout } = useStdout()
  const termRows = stdout.rows ?? 24
  const termCols = stdout.columns ?? 80
  const contentWidth = Math.max(1, termCols - 2)
  const contentLines = Math.max(6, termRows - 13)
  const rainHeight = Math.max(1, termRows - 6)

  return (
    <Box position="relative" flexDirection="column" height="100%">
      <MatrixRain enabled={props.animations} maxRows={rainHeight} />

      <Box
        flexDirection="column"
        height="100%"
        borderStyle="round"
        borderColor={theme.primary}
      >
        <Box flexGrow={1} flexDirection="column">
          <Header
            root={props.root}
            model={props.model}
            ollamaReady={props.ollamaReady}
          />

          <Box flexGrow={1} flexDirection="column" paddingY={1}>
            <ContentArea
              output={props.output}
              logs={props.logs}
              packet={props.packet}
              answer={props.answer}
              patchText={props.patchText}
              busy={props.busy}
              scrollOffset={props.scrollOffset}
              maxLines={contentLines}
              maxWidth={Math.max(20, termCols - 8)}
            />
          </Box>
        </Box>

        <InputBar
          input={props.input}
          busy={props.busy}
          mode={props.mode}
          phase={props.phase}
        />

        <StatusBar
          filesTotal={props.filesTotal}
          dirtyFiles={props.dirtyFiles}
          tokens={props.packet?.estimatedTokens ?? 0}
          maxTokens={props.maxTokens}
          busy={props.busy}
          mode={props.mode}
          intent={props.intent}
        />

        <Text color={theme.dim} backgroundColor="black">
          /help · Enter submit · Esc clear · ↑/↓ scroll · Ctrl+C quit{" ".repeat(Math.max(0, contentWidth - 65))}
        </Text>
      </Box>
    </Box>
  )
}
