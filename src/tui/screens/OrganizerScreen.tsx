import React, { useEffect, useState } from "react"
import { Box, Text, useInput } from "ink"
import { theme } from "../theme.js"
import { openOrganizerDatabase, listOrganizerAgents, markStaleAgentsOffline, listOrganizerTasks } from "../../organizer/organizerDb.js"

type AgentRow = {
  id: string
  name: string
  hostname: string
  project_name: string
  project_root: string
  status: string
  api_base_url: string
  api_enabled: number
  actions_json: string
  models_json: string
  index_json: string
  capabilities_json: string
  current_task_id: string | null
  last_heartbeat_at: number
  registered_at: number
  updated_at: number
}

type TaskRow = {
  id: string
  title: string
  status: string
  assignedAgentId: string | null
  currentIteration: number
  maxIterations: number
  priority: number
  mode: string
  autoApprove: boolean
  autoApply: boolean
}

export type OrganizerScreenProps = {
  onBack: () => void
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 0) return "now"
  if (s < 5) return "now"
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

function statusColor(s: string): string {
  switch (s) {
    case "offline": return theme.dim
    case "error": return theme.error
    case "busy":
    case "indexing": return theme.warn
    default: return theme.primary
  }
}

function dot(s: string): string {
  switch (s) {
    case "offline":
    case "error": return "○"
    case "busy":
    case "indexing": return "◉"
    default: return "●"
  }
}

function parseModels(json: string): string {
  try { const m = JSON.parse(json) as Record<string, string>; return Object.values(m).find(Boolean) ?? "?"; } catch { return "?" }
}

function parseModelsAll(json: string): Record<string, string> {
  try { return JSON.parse(json) as Record<string, string>; } catch { return {} }
}

function parseIndex(json: string): { files: number; symbols: number; dirty: number; freshness: number } {
  try { return JSON.parse(json) as { files: number; symbols: number; dirty: number; freshness: number }; } catch { return { files: 0, symbols: 0, dirty: 0, freshness: 1 }; }
}

function parseCapabilities(json: string): string[] {
  try { return JSON.parse(json) as string[]; } catch { return [] }
}

function taskStatusColor(s: string): string {
  switch (s) {
    case "running":
    case "iterating": return theme.warn
    case "needs_review": return theme.accent
    case "failed": return theme.error
    case "completed":
    case "auto_approved": return theme.primary
    case "skipped":
    case "cancelled": return theme.dim
    default: return theme.dim
  }
}

function taskStatusTag(s: string): string {
  return s.replace(/_/g, " ")
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n, " ").slice(0, n)
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

export function OrganizerScreen({ onBack }: OrganizerScreenProps) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [tick, setTick] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [detailTab, setDetailTab] = useState<"overview" | "tasks" | "capabilities">("overview")

  useEffect(() => {
    const db = openOrganizerDatabase()
    markStaleAgentsOffline(db, 15000)
    const agentList = listOrganizerAgents(db) as AgentRow[]
    const taskList = listOrganizerTasks(db) as TaskRow[]
    setAgents(agentList)
    setTasks(taskList)
    db.close()
  }, [tick])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 2000)
    return () => clearInterval(interval)
  }, [])

  useInput((char, key) => {
    if (key.escape) { onBack(); return }
    if (key.downArrow || (char === "j" && !key.ctrl)) {
      setSelectedIdx((v) => Math.min(v + 1, agents.length - 1))
      return
    }
    if (key.upArrow || (char === "k" && !key.ctrl)) {
      setSelectedIdx((v) => Math.max(0, v - 1))
      return
    }
    if (key.tab) {
      setDetailTab((t) => {
        const tabs: Array<"overview" | "tasks" | "capabilities"> = ["overview", "tasks", "capabilities"]
        const idx = tabs.indexOf(t)
        return tabs[(idx + 1) % tabs.length]
      })
      return
    }
    if (char === "1") { setDetailTab("overview"); return }
    if (char === "2") { setDetailTab("tasks"); return }
    if (char === "3") { setDetailTab("capabilities"); return }
  })

  const online = agents.filter(a => a.status !== "offline")
  const offline = agents.filter(a => a.status === "offline")
  const selected = agents[selectedIdx]

  const taskCounts = { total: tasks.length, running: 0, needs_review: 0, completed: 0, failed: 0, queued: 0, assigned: 0 }
  for (const t of tasks) {
    if (t.status in taskCounts) (taskCounts as Record<string, number>)[t.status]++
  }

  const agentTasks = selected ? tasks.filter(t => t.assignedAgentId === selected.id) : []

  const LIST_WIDTH = 36

  return (
    <Box flexDirection="column" width="100%" height="100%" paddingX={0}>
      {/* Header bar */}
      <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
        <Box>
          <Text>
            <Text color={theme.primary} bold>Agent Smith Organizer</Text>
            <Text color={theme.dim}>  port 8787  </Text>
            <Text color={theme.accent}>http://127.0.0.1:8787/dashboard</Text>
          </Text>
        </Box>
        <Box>
          <Text color={theme.dim}>
            {agents.length} agents · {online.length} online · {offline.length} offline
            {" · "}{taskCounts.running} running · {taskCounts.needs_review} needs review · {taskCounts.completed} done
            {"  "}<Text color={theme.dim}>[↑↓:nav] [Tab:switch tab] [1/2/3:tabs] [Esc:exit]</Text>
          </Text>
        </Box>
      </Box>

      {/* Main content: left agent list + right detail */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left panel: agent list */}
        <Box
          flexDirection="column"
          width={LIST_WIDTH}
          borderStyle="single"
          borderColor={theme.border}
          borderTop={false}
          paddingX={1}
          flexShrink={0}
        >
          <Text color={theme.accent} bold>AGENTS ({agents.length})</Text>
          <Box flexDirection="column" marginTop={0}>
            {agents.length === 0 && (
              <Box marginY={1}>
                <Text color={theme.dim}>No agents connected.</Text>
                <Text color={theme.dim}>Workers auto-register via</Text>
                <Text color={theme.dim}>smith api or /api</Text>
              </Box>
            )}
            {agents.map((a, i) => {
              const active = i === selectedIdx
              const agentTaskCount = tasks.filter(t => t.assignedAgentId === a.id && (t.status === "running" || t.status === "iterating" || t.status === "assigned" || t.status === "reviewing" || t.status === "needs_review")).length
              const bgColor = active ? theme.accent : undefined
              const fgColor = active ? "black" : statusColor(a.status)
              const nameColor = active ? "black" : theme.primary
              return (
                <Box key={a.id} flexDirection="column">
                  <Text>
                    {active ? <Text color={bgColor} inverse>{">"}</Text> : <Text> </Text>}
                    <Text color={active ? "black" : undefined} inverse={active}>
                      <Text color={statusColor(a.status)}>{dot(a.status)}</Text>
                      <Text color={active ? "black" : theme.primary} bold={!active}> {trunc(a.name, 20)}</Text>
                    </Text>
                  </Text>
                  <Text color={active ? "black" : theme.dim} inverse={active}>
                    {"  "}{trunc(a.status, 8)} · {trunc(a.project_name || a.hostname, 16)}
                  </Text>
                  {agentTaskCount > 0 && (
                    <Text color={active ? "black" : theme.warn} inverse={active}>
                      {"  "}{agentTaskCount} active task{agentTaskCount > 1 ? "s" : ""}
                    </Text>
                  )}
                  <Text color={active ? "black" : theme.dim} inverse={active}>
                    {"  "}seen {ago(a.last_heartbeat_at)}
                  </Text>
                </Box>
              )
            })}
          </Box>
        </Box>

        {/* Right panel: agent detail */}
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor={theme.border}
          borderTop={false}
          borderLeft={false}
          paddingX={1}
        >
          {!selected ? (
            <Box flexDirection="column" alignItems="center" marginTop={2}>
              <Text color={theme.dim}>← Select an agent to view details</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {/* Tabs */}
              <Box flexDirection="row" marginBottom={1} gap={2}>
                <Text color={detailTab === "overview" ? theme.accent : theme.dim} inverse={detailTab === "overview"} bold={detailTab === "overview"}>
                  [1] Overview
                </Text>
                <Text color={detailTab === "tasks" ? theme.accent : theme.dim} inverse={detailTab === "tasks"} bold={detailTab === "tasks"}>
                  [2] Tasks ({agentTasks.length})
                </Text>
                <Text color={detailTab === "capabilities" ? theme.accent : theme.dim} inverse={detailTab === "capabilities"} bold={detailTab === "capabilities"}>
                  [3] Capabilities
                </Text>
              </Box>

              {detailTab === "overview" && (
                <Box flexDirection="column">
                  <Text><Text color={theme.primary} bold>{selected.name}</Text></Text>
                  <Text color={theme.dim}>{selected.id}</Text>
                  <Box marginTop={1} flexDirection="column">
                    <Text><Text color={theme.dim}>Status:     </Text><Text color={statusColor(selected.status)}>{selected.status}</Text></Text>
                    <Text><Text color={theme.dim}>Host:       </Text><Text>{selected.hostname}</Text></Text>
                    <Text><Text color={theme.dim}>Project:    </Text><Text>{selected.project_name}</Text></Text>
                    <Text><Text color={theme.dim}>Root:       </Text><Text>{trunc(selected.project_root, 50)}</Text></Text>
                    <Text><Text color={theme.dim}>API URL:    </Text><Text>{selected.api_base_url || "—"}</Text></Text>
                    <Text><Text color={theme.dim}>API Enabled:</Text><Text>{selected.api_enabled ? "Yes" : "No"}</Text></Text>
                    <Text><Text color={theme.dim}>Model:      </Text><Text>{parseModels(selected.models_json)}</Text></Text>
                    <Text>
                      <Text color={theme.dim}>Last seen:  </Text>
                      <Text color={selected.status === "offline" ? theme.error : theme.dim}>{ago(selected.last_heartbeat_at)}</Text>
                    </Text>
                  </Box>

                  {(() => { const ix = parseIndex(selected.index_json); return ix.files > 0 ? (
                    <Box flexDirection="column" marginTop={1}>
                      <Text color={theme.accent} bold>Index</Text>
                      <Text color={theme.dim}>  Files: {ix.files}  Symbols: {ix.symbols}  Dirty: {ix.dirty}</Text>
                      <Text color={theme.dim}>  Freshness: {Math.round(ix.freshness * 100)}%</Text>
                    </Box>
                  ) : null })()}

                  {(() => {
                    const allModels = parseModelsAll(selected.models_json)
                    const entries = Object.entries(allModels).filter(([,v]) => v)
                    if (entries.length === 0) return null
                    return (
                      <Box flexDirection="column" marginTop={1}>
                        <Text color={theme.accent} bold>Models</Text>
                        {entries.map(([k, v]) => (
                          <Text key={k} color={theme.dim}>  {k}: {v}</Text>
                        ))}
                      </Box>
                    )
                  })()}

                  {selected.current_task_id && (
                    <Box flexDirection="column" marginTop={1}>
                      <Text color={theme.warn} bold>Current Task</Text>
                      <Text color={theme.dim}>  ID: {selected.current_task_id}</Text>
                      {(() => {
                        const ct = tasks.find(t => t.id === selected.current_task_id)
                        if (!ct) return null
                        return (
                          <Box flexDirection="column">
                            <Text color={theme.primary}>  {ct.title}</Text>
                            <Text color={taskStatusColor(ct.status)}>  Status: {taskStatusTag(ct.status)}</Text>
                            <Text color={theme.dim}>  Iteration: {ct.currentIteration}/{ct.maxIterations}</Text>
                            <Text color={theme.dim}>  Mode: {ct.mode || "—"}</Text>
                          </Box>
                        )
                      })()}
                    </Box>
                  )}
                </Box>
              )}

              {detailTab === "tasks" && (
                <Box flexDirection="column">
                  <Text color={theme.dim} bold>Tasks for {selected.name}</Text>
                  {agentTasks.length === 0 ? (
                    <Box marginY={1}>
                      <Text color={theme.dim}>No tasks assigned to this agent.</Text>
                    </Box>
                  ) : (
                    agentTasks.map(t => (
                      <Box key={t.id} flexDirection="column" marginBottom={0}>
                        <Text>
                          <Text color={taskStatusColor(t.status)}>● </Text>
                          <Text color={theme.primary}>{trunc(t.title, 50)}</Text>
                        </Text>
                        <Text color={theme.dim}>
                          {"  "}Status: {taskStatusTag(t.status)} · Iter: {t.currentIteration}/{t.maxIterations} · Mode: {t.mode || "—"}
                          {" · Priority: "}{t.priority}
                          {t.autoApprove ? <Text color={theme.primary}> AUTO</Text> : null}
                          {t.autoApply ? <Text color={theme.accent}> APPLY</Text> : null}
                        </Text>
                      </Box>
                    ))
                  )}
                </Box>
              )}

              {detailTab === "capabilities" && (
                <Box flexDirection="column">
                  <Text color={theme.dim} bold>Capabilities</Text>
                  {(() => {
                    const caps = parseCapabilities(selected.capabilities_json)
                    if (caps.length === 0) return <Text color={theme.dim}>No capabilities listed</Text>
                    return (
                      <Box flexDirection="column" marginTop={1}>
                        {caps.map(c => (
                          <Text key={c} color={theme.primary}>  ✓ {c}</Text>
                        ))}
                      </Box>
                    )
                  })()}

                  <Box marginTop={1}>
                    <Text color={theme.dim} bold>Actions</Text>
                  </Box>
                  {(() => {
                    try {
                      const actions = JSON.parse(selected.actions_json) as Array<{ name: string; description: string }>
                      if (!Array.isArray(actions) || actions.length === 0) return <Text color={theme.dim}>No actions listed</Text>
                      return (
                        <Box flexDirection="column" marginTop={0}>
                          {actions.map((a, i) => (
                            <Text key={i} color={theme.dim}>  {a.name}: {a.description}</Text>
                          ))}
                        </Box>
                      )
                    } catch { return <Text color={theme.dim}>—</Text> }
                  })()}
                </Box>
              )}

              {/* Agent actions */}
              <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={theme.border} paddingX={1}>
                <Text color={theme.dim}>
                  API: {selected.api_base_url} (use <Text color={theme.accent}>/agent {selected.name}</Text> in web dashboard or agent chat proxy)
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box borderStyle="single" borderColor={theme.border} paddingX={1}>
        <Text color={theme.dim}>
          Port 8787 · Tasks: {taskCounts.total} total ({taskCounts.running} running, {taskCounts.needs_review} needs review, {taskCounts.completed} done)
          {" · Agents: "}{online.length} online / {agents.length} total
        </Text>
      </Box>
    </Box>
  )
}
