import React, { useEffect, useState, useCallback } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { theme } from "../theme.js"
import { openOrganizerDatabase, listOrganizerAgents, markStaleAgentsOffline, listOrganizerTasks } from "../../organizer/organizerDb.js"

type AgentRow = {
  id: string; name: string; status: string; last_heartbeat_at: number
}
type TaskRow = {
  id: string; title: string; status: string; assignedAgentId: string | null
  implementModel: string; reviewModel: string; updatedAt: number
}

export type OrganizerScreenProps = { onBack: () => void }

function truncEnd(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

function pad(s: string | number, n: number): string {
  const str = String(s)
  return str.length > n ? str.slice(0, n) : str + " ".repeat(n - str.length)
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 0) return "now"
  if (s < 5) return "now"
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

function countMap<T extends Record<string, number>>(items: Array<{ status: string }>, keys: string[]): T {
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = 0
  for (const i of items) {
    if (out[i.status] !== undefined) out[i.status]++
  }
  return out as T
}

export function OrganizerScreen({ onBack }: OrganizerScreenProps) {
  const { stdout } = useStdout()
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const cols = stdout.columns ?? 80
  const rows = stdout.rows ?? 24

  const load = useCallback(() => {
    try {
      const db = openOrganizerDatabase()
      markStaleAgentsOffline(db, 15000)
      setAgents(listOrganizerAgents(db) as AgentRow[])
      setTasks(listOrganizerTasks(db) as TaskRow[])
      db.close()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { load() }, [tick, load])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 2000)
    return () => clearInterval(interval)
  }, [])

  useInput((char, key) => {
    if (key.escape || char === "q") { onBack(); return }
    if (char === "r") { load(); return }
  })

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color={theme.error}>Organizer unavailable: {error}</Text>
        <Text color={theme.dim}>Dashboard: http://127.0.0.1:8787/dashboard</Text>
        <Text color={theme.dim}>Press q or Esc to exit</Text>
      </Box>
    )
  }

  const agentCounts = countMap<Record<string, number>>(agents, ["online", "busy", "indexing", "idle", "offline", "error", "paused"])
  const agentOnline = agentCounts.online + agentCounts.idle
  const agentBusy = agentCounts.busy + agentCounts.indexing
  const agentOff = agentCounts.offline + (agentCounts.error ?? 0)

  const taskCounts = countMap<Record<string, number>>(tasks, [
    "queued", "assigned", "running", "reviewing", "iterating",
    "needs_review", "auto_approved", "completed", "failed", "skipped", "cancelled"
  ])
  const taskActive = taskCounts.running + taskCounts.iterating + taskCounts.reviewing
  const taskReview = taskCounts.needs_review + taskCounts.auto_approved
  const taskDone = taskCounts.completed

  // Model usage from tasks with assignedAgentId
  type ModelUsage = { model: string; impl: number; review: number }
  const modelMap = new Map<string, ModelUsage>()
  for (const t of tasks) {
    if (t.implementModel) {
      const m = modelMap.get(t.implementModel) ?? { model: t.implementModel, impl: 0, review: 0 }
      m.impl++
      modelMap.set(t.implementModel, m)
    }
    if (t.reviewModel) {
      const m = modelMap.get(t.reviewModel) ?? { model: t.reviewModel, impl: 0, review: 0 }
      m.review++
      modelMap.set(t.reviewModel, m)
    }
  }
  const models = [...modelMap.values()].sort((a, b) => (b.impl + b.review) - (a.impl + b.review))

  // Recent activity from task updatedAt
  const recent = [...tasks]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12)

  const innerWidth = cols - 2
  const maxModelLines = rows > 40 ? 6 : 4
  const fixedRows = 11
  const maxRecent = Math.max(2, Math.min(12, rows - fixedRows - maxModelLines))

  function line(label: string, value: string, color?: string): string {
    const labelLen = label.length
    const valueLen = innerWidth - 2 - labelLen
    const d = truncEnd(value, valueLen)
    const padLen = Math.max(0, innerWidth - labelLen - d.length)
    return label + d + " ".repeat(padLen)
  }

  function makeline(label: string, ...parts: Array<{ text: string; color?: string }>) {
    const labelStr = truncEnd(label, 14)
    let rest = ""
    for (const p of parts) rest += p.text + " "
    rest = truncEnd(rest.trim(), innerWidth - labelStr.length)
    return (
      <Text>
        <Text color={theme.dim}>{labelStr}</Text>
        <Text>{rest}</Text>
      </Text>
    )
  }

  return (
    <Box flexDirection="column" width={cols} height={rows} paddingX={1}>
      {/* Title line */}
      <Box flexDirection="row">
        <Text>
          <Text color={theme.primary} bold>Agent Smith Organizer</Text>
          <Text color={theme.dim}>  http://127.0.0.1:8787/dashboard</Text>
        </Text>
      </Box>

      {/* Stats */}
      <Box flexDirection="column" marginTop={0}>
        <Text>
          <Text color={theme.accent}>Agents: </Text>
          <Text>total {agents.length} · </Text>
          <Text color={theme.primary}>online {agentOnline} </Text>
          <Text>· </Text>
          <Text color={theme.warn}>busy {agentBusy} </Text>
          <Text>· </Text>
          <Text color={theme.dim}>off {agentOff}</Text>
        </Text>
        <Text>
          <Text color={theme.accent}>Tasks:  </Text>
          <Text>total {tasks.length} · </Text>
          <Text color={theme.warn}>active {taskActive} </Text>
          <Text>· review {taskReview} · done {taskDone}</Text>
          {taskCounts.queued > 0 && <Text color={theme.dim}> · queued {taskCounts.queued}</Text>}
          {taskCounts.failed > 0 && <Text color={theme.error}> · failed {taskCounts.failed}</Text>}
        </Text>
      </Box>

      {/* Models */}
      {models.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color={theme.dim}>Models</Text>
          {models.slice(0, maxModelLines).map(m => (
            <Text key={m.model}>
              <Text color={theme.dim}>  {truncEnd(m.model, 30)} </Text>
              <Text color={theme.primary}>impl {m.impl}</Text>
              <Text color={m.review > 0 ? theme.accent : theme.dim}> review {m.review}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Recent activity */}
      {recent.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color={theme.dim}>Recent</Text>
          {recent.slice(0, maxRecent).map(t => {
            const title = truncEnd(t.title, innerWidth - 28)
            return (
              <Text key={t.id}>
                <Text color={theme.dim}>{ago(t.updatedAt).padEnd(4)} </Text>
                <Text color={theme.dim}>{truncEnd(t.status, 14).padEnd(15)}</Text>
                <Text>{title}</Text>
              </Text>
            )
          })}
        </Box>
      )}

      {agents.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.dim}>No agents connected. Full dashboard: http://127.0.0.1:8787/dashboard</Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={0} flexDirection="row">
        <Text color={theme.dim}>
          q quit · r refresh · full controls at http://127.0.0.1:8787/dashboard
        </Text>
      </Box>
    </Box>
  )
}
