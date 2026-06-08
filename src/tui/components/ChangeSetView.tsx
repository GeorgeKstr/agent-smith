import React from "react"
import { Box, Text } from "ink"
import type { ChangeSet, ChangedFileReview, ChangedHunkReview } from "../../types/index.js"
import { theme } from "../theme.js"

export type ChangeSetViewProps = {
  changeSet: ChangeSet | null
  files: ChangedFileReview[]
  selectedPath?: string | null
  diffPreview: string
  hunks: ChangedHunkReview[]
  selectedHunkIndex: number
  reviewFocus: "files" | "hunks"
}

const BG = "black"

export function ChangeSetView({ changeSet, files, selectedPath, diffPreview, hunks, selectedHunkIndex, reviewFocus }: ChangeSetViewProps) {
  if (!changeSet) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.dim}>No change set selected.</Text>
      </Box>
    )
  }

  const diffLines = diffPreview.split("\n")
  const selFileHunks = hunks

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.primary} backgroundColor={BG}>
        ── CHANGE SET {changeSet.id} ──
      </Text>
      <Box marginTop={1}>
        <Text color={theme.accent}>status: </Text>
        <Text color={theme.text}>{changeSet.status}</Text>
      </Box>
      <Box>
        <Text color={theme.accent}>summary: </Text>
        <Text color={theme.text}>{changeSet.summary ?? "(none)"}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={reviewFocus === "files" ? theme.primary : theme.dim}>
          ── Files ({files.length}) ──
        </Text>
      </Box>
      {files.map((f, i) => {
        const sel = f.path === selectedPath && reviewFocus === "files"
        const statusColor = f.status === "accepted" ? theme.primary : f.status === "rejected" ? theme.error : theme.dim
        return (
          <Box key={i}>
            <Text color={sel ? "yellow" : undefined}>{sel ? "> " : "  "}</Text>
            <Text color={statusColor}>[{f.status.padEnd(8)}]</Text>
            <Text color={theme.text}> +{String(f.additions).padStart(3)} -{String(f.deletions).padStart(3)}  </Text>
            <Text color={theme.dim}>{f.path}</Text>
          </Box>
        )
      })}

      {selectedPath && (
        <>
          <Box marginTop={1}>
            <Text color={reviewFocus === "hunks" ? theme.primary : theme.dim}>
              ── Hunks ({selFileHunks.length}) ──
            </Text>
          </Box>
          {selFileHunks.length === 0 ? (
            <Text color={theme.dim}>  No hunks stored for selected file.</Text>
          ) : (
            selFileHunks.map((h, i) => {
              const sel = i === selectedHunkIndex && reviewFocus === "hunks"
              const statusColor = h.status === "accepted" ? theme.primary : h.status === "rejected" ? theme.error : theme.dim
              return (
                <Box key={i}>
                  <Text color={sel ? "yellow" : undefined}>{sel ? "> " : "  "}</Text>
                  <Text color={statusColor}>[{h.status.padEnd(8)}]</Text>
                  <Text color={theme.dim}> #{h.hunkIndex} {h.header} +{h.additions} -{h.deletions}</Text>
                </Box>
              )
            })
          )}
        </>
      )}

      {diffPreview && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.accent}>── Diff Preview ──</Text>
          {diffLines.slice(0, 40).map((line, i) => (
            <Text key={i} color={line.startsWith("+") ? theme.primary : line.startsWith("-") ? theme.error : theme.dim}>
              {line.length > 240 ? line.slice(0, 240) + "…" : line}
            </Text>
          ))}
          {diffLines.length > 40 && <Text color={theme.dim}>... more lines ...</Text>}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.dim}>
          files: ↑/↓ select · a/r accept/reject  |  hunks: Tab/f/h switch · ↑/↓ select · a/r accept/reject
        </Text>
      </Box>
      <Box>
        <Text color={theme.dim}>A accept all · R reject all · p apply accepted files · Esc back</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.warn}>
          Hunk review is stored for planning/review only. Apply still uses accepted files.
        </Text>
      </Box>
    </Box>
  )
}
