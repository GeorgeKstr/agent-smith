import React, { useEffect, useState, useCallback } from "react"
import { useApp, useInput, useStdout } from "ink"
import type { BootState, SmithConfig, ContextPacket, PromptIntent } from "../types/index.js"
import type { SmithDatabase } from "../core/db.js"
import type { Indexer } from "../core/indexer.js"
import { runAsk, runPatch } from "../core/taskRunner.js"
import { BootScreen } from "./screens/BootScreen.js"
import { MainScreen } from "./screens/MainScreen.js"

const initialBoot: BootState = {
  phase: "idle",
  progress: 0,
  filesScanned: 0,
  filesTotal: 0,
  dirtyFiles: 0,
  symbolsIndexed: 0,
  tagsRefreshed: 0,
}

export type AppProps = {
  root: string
  config: SmithConfig
  db: SmithDatabase
  events: NodeJS.EventEmitter
  indexer: Indexer
}

export function App({ root, config, db, events, indexer }: AppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const quit = useCallback(() => {
    console.clear()
    exit()
  }, [exit])
  const [boot, setBoot] = useState<BootState>(initialBoot)
  const [ready, setReady] = useState(false)
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null)

  const [mode, setMode] = useState<"discuss" | "build">("build")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState("idle")
  const [intent, setIntent] = useState<PromptIntent | null>(null)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [packet, setPacket] = useState<ContextPacket | null>(null)
  const [answer, setAnswer] = useState("")
  const [patchText, setPatchText] = useState("")
  const [output, setOutput] = useState<string[]>([])
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    // Use alternate screen buffer so the UI owns a bounded area and does not
    // accumulate rows from prior terminal output.
    if (!stdout.isTTY) return
    stdout.write("\u001B[?1049h\u001B[2J\u001B[H")
    return () => {
      stdout.write("\u001B[?1049l")
    }
  }, [stdout])

  useEffect(() => {
    const onProgress = (s: Record<string, unknown>) => setBoot((p) => ({
      ...p,
      phase: (s.phase as BootState["phase"]) ?? p.phase,
      progress: Number(s.progress ?? p.progress),
      filesScanned: Number(s.filesScanned ?? p.filesScanned),
      filesTotal: Number(s.filesTotal ?? p.filesTotal),
      dirtyFiles: Number(s.dirtyFiles ?? p.dirtyFiles),
      symbolsIndexed: Number(s.symbolsIndexed ?? p.symbolsIndexed),
      tagsRefreshed: Number(s.tagsRefreshed ?? p.tagsRefreshed),
      currentFile: (s.currentFile as string) ?? p.currentFile,
    }))
    const onDone = () => setReady(true)
    const onChanged = (fp: string) => setLogs((p) => [`Δ ${fp}`, ...p].slice(0, 6))
    const onReindexed = (fp: string) => setLogs((p) => [`↻ ${fp}`, ...p].slice(0, 6))
    const onOllama = (s: boolean) => setOllamaReady(s)

    events.on("index:progress", onProgress)
    events.on("index:done", onDone)
    events.on("watcher:fileChanged", onChanged)
    events.on("index:fileReindexed", onReindexed)
    events.on("ollama:status", onOllama)
    return () => {
      events.off("index:progress", onProgress)
      events.off("index:done", onDone)
      events.off("watcher:fileChanged", onChanged)
      events.off("index:fileReindexed", onReindexed)
      events.off("ollama:status", onOllama)
    }
  }, [events])

  useEffect(() => {
    const onPhase = (p: string) => setPhase(p)
    const onIntent = (i: PromptIntent) => setIntent(i)
    const onContext = (pkt: ContextPacket) => setPacket(pkt)
    const onPatch = (d: string) => setPatchText(d)
    events.on("task:phase", onPhase)
    events.on("task:intent", onIntent)
    events.on("task:context", onContext)
    events.on("task:patch", onPatch)
    return () => {
      events.off("task:phase", onPhase)
      events.off("task:intent", onIntent)
      events.off("task:context", onContext)
      events.off("task:patch", onPatch)
    }
  }, [events])

  const handleSlashCommand = useCallback((input: string): boolean => {
    const parts = input.trim().toLowerCase().split(/\s+/)
    const cmd = parts[0]

    switch (cmd) {
      case "/ask": {
        setMode("discuss")
        setOutput((o) => [...o, "✓ Switched to discuss mode"])
        return true
      }
      case "/patch": {
        setMode("build")
        setOutput((o) => [...o, "✓ Switched to build mode"])
        return true
      }
      case "/mode": {
        const target = parts[1]
        if (!target) {
          setOutput((o) => [...o, `current mode: ${mode}`])
          return true
        }
        if (target === "build" || target === "patch") {
          setMode("build")
          setOutput((o) => [...o, "✓ Mode set to build"])
          return true
        }
        if (target === "discuss" || target === "ask" || target === "chat") {
          setMode("discuss")
          setOutput((o) => [...o, "✓ Mode set to discuss"])
          return true
        }
        setOutput((o) => [...o, `Unknown mode: ${target}. Use /mode build or /mode discuss`])
        return true
      }
      case "/help": {
        setOutput((o) => [
          ...o,
          "",
          "  Commands:",
          "",
          "  /mode build  Build/apply patches (task mode)",
          "  /mode discuss  Discuss/chat/explain mode",
          "  /ask         Alias for /mode discuss",
          "  /patch       Alias for /mode build",
          "  /reindex     Re-index the project",
          "  /clear       Clear the output area",
          "  /help        Show this help message",
          "  /exit        Exit the application",
          "",
          "  Keys:  Enter submit · Esc clear · Ctrl+C quit",
          "",
        ])
        return true
      }
      case "/reindex":
      case "/sync": {
        setOutput((o) => [...o, "↻ Reindexing..."])
        void indexer.quickStartupScan()
        return true
      }
      case "/clear": {
        setOutput([])
        setAnswer("")
        setPatchText("")
        setIntent(null)
        return true
      }
      case "/exit":
      case "/quit": {
        quit()
        return true
      }
      default: {
        if (cmd?.startsWith("/")) {
          setOutput((o) => [...o, `Unknown command: ${cmd}. Try /help`])
          return true
        }
        return false
      }
    }
  }, [quit, indexer, mode])

  const submit = useCallback(async () => {
    const task = input.trim()
    if (!task || busy) return

    if (task.startsWith("/")) {
      setInput("")
      handleSlashCommand(task)
      return
    }

    setBusy(true)
    setAnswer("")
    setPatchText("")
    setPacket(null)
    setIntent(null)
    setScrollOffset(0)
    setOutput([`▶ ${mode}: ${task}`])

    try {
      if (mode === "discuss") {
        const result = await runAsk({ db, root, config, events, indexer }, task)
        setAnswer(result.answer || result.message || "(no answer)")
        if (result.message) setOutput((o) => [...o, result.message!])
      } else {
        const outcome = await runPatch({ db, root, config, events, indexer }, task, { apply: true })
        if (outcome.diff) setPatchText(outcome.diff)
        if (outcome.answer) setAnswer(outcome.answer)
        const lines = [outcome.message, ...outcome.checks.map((c) => `[${c.name}] ${c.ok ? "PASS" : "FAIL"} (exit ${c.exitCode})`)]
        setOutput((o) => [...o, ...lines.filter(Boolean) as string[]])
      }
    } catch (error) {
      setOutput((o) => [...o, `error: ${error instanceof Error ? error.message : String(error)}`])
    } finally {
      setBusy(false)
      setPhase("idle")
      setInput("")
    }
  }, [input, busy, mode, db, root, config, events, indexer, handleSlashCommand])

  useInput((char, key) => {
    if (key.ctrl && char === "c") { quit(); return }
    if (busy) return
    if (key.upArrow) { setScrollOffset((v) => v + 1); return }
    if (key.downArrow) { setScrollOffset((v) => Math.max(0, v - 1)); return }
    if (key.pageUp) { setScrollOffset((v) => v + 8); return }
    if (key.pageDown) { setScrollOffset((v) => Math.max(0, v - 8)); return }
    if (key.escape) { setInput(""); return }
    if (key.return) { void submit(); return }
    if (key.backspace || key.delete) { setInput((v) => v.slice(0, -1)); return }
    if (char && !key.ctrl && !key.meta) { setInput((v) => v + char) }
  })

  if (!ready && config.theme.showBootAnimation) {
    return <BootScreen state={boot} animate={config.theme.animations} />
  }

  return (
    <MainScreen
      root={root}
      model={mode === "build" ? config.models.patcher : config.models.summarizer}
      ollamaReady={ollamaReady}
      filesTotal={boot.filesTotal}
      dirtyFiles={boot.dirtyFiles}
      logs={logs}
      mode={mode}
      input={input}
      busy={busy}
      phase={phase}
      intent={intent}
      packet={packet}
      answer={answer}
      patchText={patchText}
      output={output}
      maxTokens={config.context.maxPromptTokens}
      animations={config.theme.animations}
      scrollOffset={scrollOffset}
    />
  )
}
