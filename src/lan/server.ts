import http from "node:http"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import type { SmithDatabase } from "../db/db.js"
import type { SmithConfig, ContextPacket, PromptIntent } from "../types/index.js"
import type { Indexer } from "../index/indexer.js"
import { runAsk } from "../agent/taskRunner.js"
import { summarizeFile } from "../agent/summarizer.js"
import { listProviderModels, resolveProviderModelName } from "../providers/providers.js"
import { html } from "../web/html.js"
import { styles } from "../web/styles.js"
import { clientJs } from "../web/client.js"
import { sendChatMessage, getSessionWithMessages } from "../chat/chatRuntime.js"
import { createChatSession, listChatSessions, getChatSession, listChatMessages, getOpenQuestions, answerUserQuestion } from "../chat/chatStore.js"

export type ChatEntry = {
  role: "user" | "assistant" | "system" | "patch"
  content: string
  ts: number
}

export type LanServerState = {
  scanPhase: string
  scanProgress: number
  scanScanned: number
  scanTotal: number
  ollamaReady: boolean | null
  phase: string
  intent: PromptIntent | null
  packet: ContextPacket | null
  answer: string
  patchText: string
  output: string[]
  busy: boolean
  mode: "discuss" | "build"
  modelOverride: string | null
  uptime: number
  chatLog: ChatEntry[]
}

function parseOutputToChat(lines: string[]): ChatEntry[] {
  const chat: ChatEntry[] = []
  for (const line of lines) {
    if (line.startsWith("▶ ")) {
      const content = line.slice(2).replace(/^(build|discuss):\s*/, "")
      chat.push({ role: "user", content, ts: 0 })
    } else if (line.startsWith("> ")) {
      chat.push({ role: "user", content: line.slice(2), ts: 0 })
    } else if (line.startsWith("AI: ")) {
      chat.push({ role: "assistant", content: line.slice(4), ts: 0 })
    } else if (line.startsWith("  ") && chat.length > 0) {
      const last = chat[chat.length - 1]
      if (last.ts === 0) last.content += "\n" + line.trim()
    } else if (line.startsWith("⌘ ")) {
      chat.push({ role: "system", content: line.slice(2), ts: 0 })
    }
  }
  return chat
}

export function startLanServer(args: {
  root: string
  config: SmithConfig
  db: SmithDatabase
  events: NodeJS.EventEmitter
  indexer: Indexer
  port?: number
  initialOutput?: string[]
  initialMode?: "discuss" | "build"
  initialModelOverride?: string | null
}): { port: number; stop: () => void } {
  const { root, config, db, events, indexer } = args
  const port = args.port ?? 3000

  const lanState: LanServerState = {
    scanPhase: "idle",
    scanProgress: 0,
    scanScanned: 0,
    scanTotal: 0,
    ollamaReady: null,
    phase: "idle",
    intent: null,
    packet: null,
    answer: "",
    patchText: "",
    output: [],
    busy: false,
    mode: args.initialMode ?? "build",
    modelOverride: args.initialModelOverride ?? null,
    uptime: Date.now(),
    chatLog: parseOutputToChat(args.initialOutput ?? []),
  }

  const sseClients = new Set<http.ServerResponse>()
  let currentAbort: AbortController | null = null
  let currentTaskSource: "web" | "cli" | null = null

  function broadcast(data: Record<string, unknown>) {
    const msg = `data: ${JSON.stringify(data)}\n\n`
    for (const res of sseClients) {
      try { res.write(msg) } catch { sseClients.delete(res) }
    }
  }

  function emitState() {
    broadcast({ type: "state", data: { ...lanState, uptime: lanState.uptime } })
  }

  function emitStatus(partial: Partial<LanServerState>) {
    Object.assign(lanState, partial)
    broadcast({ type: "status", data: partial })
  }

  function appendChat(entry: ChatEntry, source: "web" | "cli" | "system" = "system") {
    lanState.chatLog.push(entry)
    broadcast({ type: "chat", data: entry })
    if (source === "web") {
      events.emit("chat:entry", { entry, source: "web", mode: lanState.mode })
    }
  }

  function cancelCurrent() {
    if (currentAbort) {
      currentAbort.abort()
      currentAbort = null
    }
    lanState.busy = false
    lanState.phase = "idle"
    emitState()
    appendChat({ role: "system", content: "⏹ Cancelled", ts: Date.now() }, "web")
  }

  // Subscribe to events
  const onProgress = (s: Record<string, unknown>) => {
    const update: Partial<LanServerState> = {}
    if (s.phase) update.scanPhase = String(s.phase)
    if (s.progress !== undefined) update.scanProgress = Number(s.progress)
    if (s.filesScanned !== undefined) update.scanScanned = Number(s.filesScanned)
    if (s.filesTotal !== undefined) update.scanTotal = Number(s.filesTotal)
    emitStatus(update)
  }

  const onOllama = (ok: boolean) => {
    lanState.ollamaReady = ok
    emitState()
  }

  const onPhase = (p: string) => emitStatus({ phase: p, busy: p !== "idle" })
  const onIntent = (intent: PromptIntent) => emitStatus({ intent })
  const onContext = (packet: ContextPacket) => {
    lanState.packet = packet
    emitState()
    const source = currentTaskSource === "web" ? "web" : "cli"
    // TUI-originated prompt: add user message if not duplicate
    const last = lanState.chatLog[lanState.chatLog.length - 1]
    if (packet.task && (!last || last.role !== "user" || last.content !== packet.task)) {
      appendChat({ role: "user", content: packet.task, ts: Date.now() }, source)
    }
  }
  const onAnswer = (answer: string) => {
    const source = currentTaskSource === "web" ? "web" : "cli"
    lanState.answer = answer
    const last = lanState.chatLog[lanState.chatLog.length - 1]
    if (answer && (!last || last.role !== "assistant")) {
      appendChat({ role: "assistant", content: answer, ts: Date.now() }, source)
    }
    emitState()
  }
  const onPatch = (patchText: string) => {
    const source = currentTaskSource === "web" ? "web" : "cli"
    lanState.patchText = patchText
    const last = lanState.chatLog[lanState.chatLog.length - 1]
    if (patchText && (!last || last.role !== "patch")) {
      appendChat({ role: "patch", content: patchText, ts: Date.now() }, source)
    }
    emitStatus({ patchText })
  }

  const onUiModeSet = (payload: { mode?: "discuss" | "build"; source?: "web" | "cli" | "system" }) => {
    if (payload?.mode !== "build" && payload?.mode !== "discuss") return
    if (lanState.mode !== payload.mode) {
      lanState.mode = payload.mode
      emitState()
    }
  }

  const onUiModelSet = (payload: { model?: string | null; source?: "web" | "cli" | "system" }) => {
    if (!(typeof payload?.model === "string" || payload?.model === null)) return
    const nextModel = payload.model === null ? null : payload.model.trim() || null
    if (lanState.modelOverride !== nextModel) {
      lanState.modelOverride = nextModel
      emitState()
    }
  }

  events.on("index:progress", onProgress)
  events.on("ollama:status", onOllama)
  events.on("task:phase", onPhase)
  events.on("task:intent", onIntent)
  events.on("task:context", onContext)
  events.on("task:answer", onAnswer)
  events.on("task:patch", onPatch)
  events.on("ui:mode:set", onUiModeSet)
  events.on("ui:model:set", onUiModelSet)

  const onStream = (data: { text: string }) => {
    broadcast({ type: "stream", data: { text: data.text } })
  }
  events.on("task:stream", onStream)

  function dashboardData() {
    const totalFiles = (db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c
    const totalSymbols = (db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }).c
    const totalImports = (db.prepare("SELECT COUNT(*) AS c FROM imports").get() as { c: number }).c
    const totalWithSummary = (db.prepare("SELECT COUNT(*) AS c FROM files WHERE summary IS NOT NULL AND summary != ''").get() as { c: number }).c
    const fileRows = db.prepare("SELECT id,path,language,summary,is_test AS isTest FROM files ORDER BY CASE WHEN summary IS NULL OR summary='' THEN 1 ELSE 0 END,path").all() as Array<{ id: number; path: string; language: string; summary: string | null; isTest: number }>
    const tagRows = db.prepare("SELECT ft.file_id,t.name FROM file_tags ft JOIN tags t ON t.id=ft.tag_id").all() as Array<{ file_id: number; name: string }>
    const tagsByFile = new Map<number, string[]>()
    for (const r of tagRows) {
      const list = tagsByFile.get(r.file_id) ?? []
      list.push(r.name)
      tagsByFile.set(r.file_id, list)
    }
    const impMeta = db.prepare("SELECT m.key,m.value FROM meta m WHERE m.key LIKE 'importance:%'").all() as Array<{ key: string; value: string }>
    const hashToImp = new Map<string, number>()
    for (const r of impMeta) {
      const h = r.key.replace("importance:", "")
      const v = parseInt(r.value, 10)
      if (!isNaN(v)) hashToImp.set(h, v)
    }
    const fileHashes = db.prepare("SELECT id,hash FROM files").all() as Array<{ id: number; hash: string }>
    const llmImpMap = new Map<number, number>()
    for (const fh of fileHashes) {
      const imp = hashToImp.get(fh.hash)
      if (imp) llmImpMap.set(fh.id, imp)
    }
    const impRows = db.prepare("SELECT f.id,IFNULL(inb.c,0) AS inbound,IFNULL(outb.c,0) AS outbound,IFNULL(sym.c,0) AS symbols FROM files f LEFT JOIN(SELECT to_file_id AS fid,COUNT(*)AS c FROM imports GROUP BY to_file_id)inb ON inb.fid=f.id LEFT JOIN(SELECT from_file_id AS fid,COUNT(*)AS c FROM imports GROUP BY from_file_id)outb ON outb.fid=f.id LEFT JOIN(SELECT file_id AS fid,COUNT(*)AS c FROM symbols GROUP BY file_id)sym ON sym.fid=f.id").all() as Array<{ id: number; inbound: number; outbound: number; symbols: number }>
    const heurImpMap = new Map<number, number>()
    for (const r of impRows) heurImpMap.set(r.id, Math.round(r.inbound * 3 + r.outbound * 1 + r.symbols * 0.5))
    const files = fileRows.map((r) => ({
      path: r.path,
      language: r.language,
      summary: r.summary,
      isTest: !!r.isTest,
      tags: tagsByFile.get(r.id) ?? [],
      importance: llmImpMap.get(r.id) ?? heurImpMap.get(r.id) ?? 0,
    }))
    const topTags = db.prepare("SELECT t.name,COUNT(ft.file_id)AS count FROM file_tags ft JOIN tags t ON t.id=ft.tag_id GROUP BY ft.tag_id ORDER BY count DESC LIMIT 10").all() as Array<{ name: string; count: number }>
    const langCounts = db.prepare("SELECT language,COUNT(*)AS count FROM files WHERE language IS NOT NULL AND language!='' GROUP BY language ORDER BY count DESC").all() as Array<{ language: string; count: number }>
    const projectSummary = (db.prepare("SELECT value FROM meta WHERE key='project_summary'").get() as { value: string } | undefined)?.value ?? ""
    return { totalFiles, totalSymbols, totalImports, totalWithSummary, files, topTags, langCounts, projectSummary }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    const pathname = url.pathname

    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }

    if (pathname === "/api/state" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ...lanState, uptime: lanState.uptime }))
      return
    }

    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      })
      res.write(`data: ${JSON.stringify({ type: "state", data: { ...lanState, uptime: lanState.uptime } })}\n\n`)
      const dash = dashboardData()
      res.write(`data: ${JSON.stringify({ type: "dashboard", data: dash })}\n\n`)
      sseClients.add(res)
      req.on("close", () => { sseClients.delete(res) })
      return
    }

    if (pathname === "/api/dashboard" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(dashboardData()))
      return
    }

    if (pathname === "/api/filetree" && req.method === "GET") {
      try {
        const files = db.prepare("SELECT path, language FROM files ORDER BY path").all() as Array<{path: string; language: string}>
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ files }))
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    if (pathname === "/api/file" && req.method === "GET") {
      const filePath = url.searchParams.get("path")
      if (!filePath) { res.writeHead(400); res.end(JSON.stringify({ error: "missing path" })); return }
      const resolvedRoot = path.resolve(root)
      const absPath = path.resolve(root, filePath)
      const rel = path.relative(resolvedRoot, absPath)
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "access denied" }))
        return
      }
      void (async () => {
        try {
          const content = await readFile(absPath, "utf-8")
          const fileRow = db.prepare("SELECT summary, importance FROM files WHERE path=?").get(rel) as { summary: string | null; importance: number } | undefined
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ content, summary: fileRow?.summary ?? null, importance: fileRow?.importance ?? 0 }))
        } catch {
          res.writeHead(404, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "file not found" }))
        }
      })()
      return
    }

    if (pathname === "/api/file" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => { body += chunk })
      req.on("end", async () => {
        try {
          const { path: filePath, content } = JSON.parse(body) as { path: string; content: string }
          if (!filePath || content === undefined) { res.writeHead(400); res.end(JSON.stringify({ error: "missing fields" })); return }
          const resolvedRoot = path.resolve(root)
          const absPath = path.resolve(root, filePath)
          const rel = path.relative(resolvedRoot, absPath)
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            res.writeHead(403, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "access denied" }))
            return
          }
          await writeFile(absPath, content, "utf-8")
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
      })
      return
    }

    if (pathname === "/api/config" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      const safeConfig: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(config)) {
        if (k === "providers") {
          const safeProviders: Record<string, unknown> = {}
          for (const [pid, entry] of Object.entries(v as Record<string, unknown>)) {
            const e = entry as Record<string, unknown>
            safeProviders[pid] = {
              type: e.type,
              baseUrl: e.baseUrl,
              apiKeyEnv: e.apiKeyEnv,
              hasApiKey: Boolean(e.apiKey)
            }
          }
          safeConfig[k] = safeProviders
        } else {
          safeConfig[k] = v
        }
      }
      res.end(JSON.stringify(safeConfig))
      return
    }

    if (pathname === "/api/models" && req.method === "GET") {
      void (async () => {
        try {
          const models = await listProviderModels(config)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ models, selected: lanState.modelOverride ?? "" }))
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ models: [], selected: lanState.modelOverride ?? "" }))
        }
      })()
      return
    }

    if (pathname === "/api/prompt" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => { body += chunk })
      req.on("end", async () => {
        try {
          const { text, model } = JSON.parse(body)
          if (!text) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "missing text" })); return }

          // Handle slash commands client-side can also send to /api/command,
          // but /mode is common enough to intercept here.
          if (text === "/mode discuss" || text === "/mode build") {
            lanState.mode = text === "/mode build" ? "build" : "discuss"
            events.emit("ui:mode:set", { mode: lanState.mode, source: "web" })
            emitState()
            appendChat({ role: "system", content: `Switched to ${lanState.mode} mode`, ts: Date.now() }, "web")
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (text.startsWith("/")) {
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: true }))
            return
          }

          currentAbort = new AbortController()
          currentTaskSource = "web"
          lanState.busy = true
          const selectedModel = typeof model === "string" && model.trim() ? model.trim() : lanState.modelOverride ?? undefined
          if (selectedModel && selectedModel !== lanState.modelOverride && lanState.modelOverride !== null) {
            lanState.modelOverride = selectedModel
            events.emit("ui:model:set", { model: selectedModel, source: "web" })
          }
          const last = lanState.chatLog[lanState.chatLog.length - 1]
          if (!last || last.role !== "user" || last.content !== text) {
            appendChat({ role: "user", content: text, ts: Date.now() }, "web")
          }
          emitState()

          try {
            await runAsk({ db, root, config, events, indexer }, text, { signal: currentAbort.signal, modelOverride: selectedModel })
          } finally {
            currentAbort = null
            currentTaskSource = null
          }

          lanState.busy = false
          emitState()

          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          currentAbort = null
          currentTaskSource = null
          lanState.busy = false
          emitState()
          appendChat({ role: "system", content: `Error: ${err instanceof Error ? err.message : String(err)}`, ts: Date.now() }, "web")
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
      })
      return
    }

    if (pathname === "/api/cancel" && req.method === "POST") {
      cancelCurrent()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (pathname === "/api/command" && req.method === "POST") {
      let body = ""
      req.on("data", (chunk) => { body += chunk })
      req.on("end", async () => {
        try {
          const { command, args } = JSON.parse(body)
          switch (command) {
            case "mode":
              if (args === "build" || args === "discuss") {
                lanState.mode = args
                events.emit("ui:mode:set", { mode: lanState.mode, source: "web" })
                emitState()
                appendChat({ role: "system", content: `Switched to ${lanState.mode} mode`, ts: Date.now() }, "web")
              }
              break
            case "model": {
              const raw = typeof args === "string" ? args.trim() : ""
              if (!raw || raw === "list") {
                const models = await listProviderModels(config).catch(() => [])
                if (models.length) {
                  appendChat({ role: "assistant", content: "? Available models\n" + models.map((m: string) => "- " + m).join("\n"), ts: Date.now() }, "web")
                } else {
                  appendChat({ role: "system", content: "No models available from any provider.", ts: Date.now() }, "web")
                }
                break
              }
              if (raw === "reset" || raw === "default" || raw === "auto") {
                lanState.modelOverride = null
                events.emit("ui:model:set", { model: null, source: "web" })
                emitState()
                appendChat({ role: "system", content: "Model reset to mode default", ts: Date.now() }, "web")
                break
              }
              const models = await listProviderModels(config).catch(() => [])
              const resolved = models.length ? await resolveProviderModelName(config, raw, models) : raw
              lanState.modelOverride = resolved || null
              events.emit("ui:model:set", { model: lanState.modelOverride, source: "web" })
              emitState()
              appendChat({ role: "system", content: `Model set to ${lanState.modelOverride}`, ts: Date.now() }, "web")
              break
            }
            case "reindex":
              void indexer.quickStartupScan()
              appendChat({ role: "system", content: "Reindexing started", ts: Date.now() }, "web")
              break
            case "clear":
              lanState.chatLog = []
              emitState()
              events.emit("chat:cleared", { source: "web" })
              break
            case "summarize": {
              const targetPath = (args as string | undefined)?.trim() || ""
              void (async () => {
                if (targetPath) {
                  // Summarize a specific file
                  try {
                    const absPath = path.resolve(root, targetPath)
                    const rel = path.relative(path.resolve(root), absPath)
                    if (rel.startsWith("..") || path.isAbsolute(rel)) return
                    const content = await readFile(absPath, "utf-8")
                    const row = db.prepare("SELECT language FROM files WHERE path=?").get(rel) as { language: string } | undefined
                    const lang = row?.language ?? "text"
                    appendChat({ role: "system", content: `Summarizing ${rel}…`, ts: Date.now() }, "web")
                    const { summary, importance } = await summarizeFile({ config, relPath: rel, language: lang, content })
                    if (summary) {
                      db.prepare("UPDATE files SET summary=?,importance=? WHERE path=?").run(summary, importance, rel)
                      appendChat({ role: "system", content: `Summarized ${rel}: ${summary}`, ts: Date.now() }, "web")
                    } else {
                      appendChat({ role: "system", content: `Summarize failed for ${rel} (provider unavailable?)`, ts: Date.now() }, "web")
                    }
                  } catch (e) {
                    appendChat({ role: "system", content: `Summarize error: ${String(e)}`, ts: Date.now() }, "web")
                  }
                } else {
                  // Summarize all files without summaries
                  const unsummarized = db.prepare("SELECT path, language FROM files WHERE summary IS NULL OR summary='' ORDER BY importance DESC").all() as Array<{ path: string; language: string }>
                  if (!unsummarized.length) {
                    appendChat({ role: "system", content: "All files already have summaries.", ts: Date.now() }, "web")
                    return
                  }
                  appendChat({ role: "system", content: `Starting summarization of ${unsummarized.length} files…`, ts: Date.now() }, "web")
                  let done = 0
                  for (const f of unsummarized) {
                    try {
                      const absPath = path.resolve(root, f.path)
                      const content = await readFile(absPath, "utf-8").catch(() => "")
                      if (!content) continue
                      const { summary, importance } = await summarizeFile({ config, relPath: f.path, language: f.language, content })
                      if (summary) {
                        db.prepare("UPDATE files SET summary=?,importance=? WHERE path=?").run(summary, importance, f.path)
                        done++
                      }
                    } catch { /* skip */ }
                    if (done % 5 === 0 && done > 0) appendChat({ role: "system", content: `Summarized ${done}/${unsummarized.length}…`, ts: Date.now() }, "web")
                  }
                  appendChat({ role: "system", content: `Summarization complete: ${done}/${unsummarized.length} files.`, ts: Date.now() }, "web")
                }
              })()
              break
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
      })
      return
    }

    if (pathname === "/style.css" || pathname === "/dashboard/styles.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" })
      res.end(styles)
      return
    }
    if (pathname === "/script.js" || pathname === "/dashboard/client.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" })
      res.end(clientJs)
      return
    }

    // Chat session API (same as the API server so dashboards can use these paths universally)
    if (pathname === "/api/chat/sessions" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, sessions: listChatSessions(db) }))
      return
    }
    if (pathname === "/api/chat/sessions" && req.method === "POST") {
      let bdy = ""; req.on("data", (c: string) => { bdy += c });
      req.on("end", () => {
        try {
          const b = JSON.parse(bdy) as Record<string, unknown> | null;
          const s = createChatSession(db, { title: typeof b?.title === "string" ? b.title : undefined, scope: typeof b?.scope === "string" ? b.scope as "local" | "task" : undefined, taskId: typeof b?.taskId === "string" ? b.taskId : undefined });
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true, session: s }))
        } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e) })) }
      })
      return
    }

    // Match /api/chat/sessions/:id
    {
      const m = pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/)
      if (m && req.method === "GET") {
        void (async () => {
          const data = await getSessionWithMessages(db, m[1])
          if (!data) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Not found" })); return }
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true, session: data.session, messages: data.messages, openQuestions: data.openQuestions }))
        })()
        return
      }
      if (m && req.method === "POST") {
        let bdy = ""; req.on("data", (c: string) => { bdy += c });
        req.on("end", async () => {
          try {
            const b = JSON.parse(bdy) as Record<string, unknown> | null;
            const result = await sendChatMessage({ root, config, db, events, indexer, sessionId: m[1], prompt: (b?.prompt as string) || "", actionKind: typeof b?.actionKind === "string" ? b.actionKind : undefined, model: typeof b?.model === "string" ? b.model : undefined });
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: result.ok, session: result.session, userMessage: result.userMessage, assistantMessage: result.assistantMessage, result: result.result }))
          } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e) })) }
        })
        return
      }
    }

    // GET /api/questions/open
    if (pathname === "/api/questions/open" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, questions: getOpenQuestions(db) }))
      return
    }

    // POST /api/questions/:id/answer
    {
      const m = pathname.match(/^\/api\/questions\/([^/]+)\/answer$/)
      if (m && req.method === "POST") {
        let bdy = ""; req.on("data", (c: string) => { bdy += c });
        req.on("end", () => {
          try {
            const b = JSON.parse(bdy) as Record<string, unknown> | null;
            const q = answerUserQuestion(db, m[1], b?.answer)
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: !!q, question: q }))
          } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e) })) }
        })
        return
      }
    }

    // GET /api/dashboard
    if (pathname === "/api/dashboard" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(dashboardData()))
      return
    }

    // Default: serve the SPA shell
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(
      html
        .replace("_STYLE__URL_", "/style.css")
        .replace("_SCRIPT__URL_", "/script.js")
        .replace("_API_BASE_", "/api")
        .replace("_HAS_SIDEBAR_", "false")
    )
  })

  server.listen(port, () => {
    lanState.uptime = Date.now()
  })

  function stop() {
    events.off("index:progress", onProgress)
    events.off("ollama:status", onOllama)
    events.off("task:phase", onPhase)
    events.off("task:intent", onIntent)
    events.off("task:context", onContext)
    events.off("task:answer", onAnswer)
    events.off("task:patch", onPatch)
    events.off("task:stream", onStream)
    events.off("ui:mode:set", onUiModeSet)
    events.off("ui:model:set", onUiModelSet)
    for (const client of sseClients) {
      try { client.end() } catch { /* ignore */ }
    }
    sseClients.clear()
    server.close()
  }

  return { port, stop }
}
