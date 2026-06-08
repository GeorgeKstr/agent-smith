import React, { useEffect, useState } from "react"
import { Box, Text, useInput } from "ink"
import { theme } from "../theme.js"
import { openOrganizerDatabase, listOrganizerAgents, markStaleAgentsOffline } from "../../organizer/organizerDb.js"

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

export type OrganizerScreenProps = {
  onBack: () => void
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
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

function parseIndex(json: string): { files: number; symbols: number; dirty: number; freshness: number } {
  try { return JSON.parse(json) as { files: number; symbols: number; dirty: number; freshness: number }; } catch { return { files: 0, symbols: 0, dirty: 0, freshness: 1 }; }
}

export function OrganizerScreen({ onBack }: OrganizerScreenProps) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const db = openOrganizerDatabase()
    markStaleAgentsOffline(db, 15000)
    const list = listOrganizerAgents(db)
    setAgents(list as AgentRow[])
    db.close()
  }, [tick])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 2000)
    return () => clearInterval(interval)
  }, [])

  useInput((_char, key) => {
    if (key.escape) { onBack(); return }
  })

  const online = agents.filter(a => a.status !== "offline")
  const offline = agents.filter(a => a.status === "offline")

  return (
    <Box flexDirection="column" width="100%" height="100%" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color={theme.primary} bold>Agent Smith Organizer</Text>
          <Text color={theme.dim}>  port 8787</Text>
        </Text>
        <Text color={theme.dim}>
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
          {online.length > 0 && <Text color={theme.primary}>, {online.length} online</Text>}
          {offline.length > 0 && <Text color={theme.dim}>, {offline.length} offline</Text>}
          {"  "}Esc to exit
        </Text>
      </Box>

      <Box flexDirection="column">
        {agents.length === 0 && (
          <Box marginY={1}>
            <Text color={theme.dim}>No agents connected. Workers auto-register via smith api or /api</Text>
          </Box>
        )}

        {online.map(a => (
          <Box key={a.id} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={statusColor(a.status)}>{dot(a.status)} </Text>
              <Text color={theme.primary} bold>{a.name}</Text>
              {a.current_task_id && <Text color={theme.warn}>  [{a.status}]</Text>}
            </Text>
            <Text color={theme.dim}>
              {"  "}{a.hostname} · {a.project_name}
              {" · model: "}{parseModels(a.models_json)}
              {a.api_enabled ? ` · API: ${a.api_base_url}` : ""}
            </Text>
            {(() => { const ix = parseIndex(a.index_json); return ix.files > 0 ? (
              <Text color={theme.dim}>
                {"  "}index: {ix.files} files, {ix.symbols} symbols
                {ix.dirty > 0 ? `, ${ix.dirty} dirty` : ""}
                {" ("}{Math.round(ix.freshness * 100)}% fresh{")"}
              </Text>
            ) : null })()}
            <Text color={theme.dim}>{"  "}seen {ago(a.last_heartbeat_at)}</Text>
          </Box>
        ))}

        {offline.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.dim}>Offline</Text>
            {offline.slice(0, 8).map(a => (
              <Box key={a.id}>
                <Text>
                  <Text color={theme.dim}>{dot(a.status)} </Text>
                  <Text color={theme.dim}>{a.name}</Text>
                  <Text color={theme.dim}>  last seen {ago(a.last_heartbeat_at)}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}
