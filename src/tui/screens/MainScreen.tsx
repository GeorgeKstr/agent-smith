import React from "react";
import { Box, Text } from "ink";
import type { ContextPacket } from "../../types/index.js";
import { Header } from "../components/Header.js";
import { ProjectIntelPane } from "../components/ProjectIntelPane.js";
import { TaskConsolePane } from "../components/TaskConsolePane.js";
import { ContextPane } from "../components/ContextPane.js";
import { PatchPane } from "../components/PatchPane.js";
import { StatusBar } from "../components/StatusBar.js";

export type MainView = "context" | "patch" | "answer";

export type MainScreenProps = {
  root: string;
  model: string;
  ollamaReady: boolean | null;
  filesTotal: number;
  dirtyFiles: number;
  symbolsIndexed: number;
  tagsRefreshed: number;
  logs: string[];
  mode: "ask" | "patch";
  view: MainView;
  input: string;
  busy: boolean;
  phase: string;
  packet: ContextPacket | null;
  answer: string;
  patchText: string;
  output: string[];
  maxTokens: number;
};

export function MainScreen(props: MainScreenProps) {
  return (
    <Box flexDirection="column">
      <Header root={props.root} model={props.model} ollamaReady={props.ollamaReady} />

      <Box>
        <ProjectIntelPane
          filesTotal={props.filesTotal}
          dirtyFiles={props.dirtyFiles}
          symbolsIndexed={props.symbolsIndexed}
          tagsRefreshed={props.tagsRefreshed}
        />
        <TaskConsolePane
          logs={props.logs}
          output={props.output}
          mode={props.mode}
          input={props.input}
          busy={props.busy}
          phase={props.phase}
        />
      </Box>

      <Box>
        <ContextPane packet={props.packet} active={props.view === "context"} answer={props.view === "answer" ? props.answer : undefined} />
        <PatchPane patchText={props.patchText} active={props.view === "patch"} />
      </Box>

      <Text color="gray">
        Ctrl+A ask · Ctrl+P patch · Ctrl+I context · Ctrl+T patch view · Ctrl+R reindex · Enter run · Ctrl+C quit
      </Text>
      <StatusBar
        filesTotal={props.filesTotal}
        dirtyFiles={props.dirtyFiles}
        tokens={props.packet?.estimatedTokens ?? 0}
        maxTokens={props.maxTokens}
        mode={props.mode}
        busy={props.busy}
      />
    </Box>
  );
}
