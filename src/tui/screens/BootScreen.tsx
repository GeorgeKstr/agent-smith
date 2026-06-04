import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { BootState } from "../../types/index.js";
import { smithTheme } from "../theme.js";
import { ProgressBar } from "../components/ProgressBar.js";

export function BootScreen({ state, animate = true }: { state: BootState; animate?: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => setTick((value) => value + 1), 120);
    return () => clearInterval(timer);
  }, [animate]);

  const spinner = animate ? smithTheme.spinnerFrames[tick % smithTheme.spinnerFrames.length] : "●";
  const rain = smithTheme.rain.map((row, i) =>
    animate ? rotate(row, (tick + i * 7) % Math.max(1, row.length)) : row
  );

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={2} paddingY={1}>
      <Text color="greenBright">░▒▓ AGENT SMITH ▓▒░</Text>
      <Text color="green">SYSTEM BOOT // MATRIX INDEX CORE</Text>
      <Text color="gray">{rain[0]}</Text>
      <Text color="gray">{rain[1]}</Text>

      <Box marginTop={1}>
        <Text color="greenBright">{"///`.::::.`\\\\\\  "}</Text>
        <Text color="green"> sunglasses protocol loaded</Text>
      </Box>
      <Text color="greenBright">||| ::/  \:: ;|||</Text>
      <Text color="greenBright">||| ::\__/:: ;|||</Text>
      <Text color="greenBright">{"\\\\\\ '::::' ///"}</Text>

      <Box marginTop={1}>
        <Text color="green">
          {spinner} Phase: {state.phase.toUpperCase()}
        </Text>
      </Box>
      <ProgressBar progress={state.progress} />

      <Text color="green">
        Files scanned: {state.filesScanned} / {state.filesTotal}
      </Text>
      <Text color="yellow">Dirty files: {state.dirtyFiles}</Text>
      <Text color="green">Symbols indexed: {state.symbolsIndexed}</Text>
      <Text color="cyan">Tags refreshed: {state.tagsRefreshed}</Text>
      <Text color="gray">Current file: {state.currentFile ?? "-"}</Text>

      <Box marginTop={1}>
        <Text color="cyan">Tip: {state.tip}</Text>
      </Box>
      <Text color="gray">{rain[2]}</Text>
      <Text color="greenBright">AGENT SMITH ONLINE</Text>
    </Box>
  );
}

function rotate(input: string, amount: number) {
  return input.slice(amount) + input.slice(0, amount);
}
