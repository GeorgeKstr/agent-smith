import React, { useEffect, useState, useMemo } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import type { SmithDatabase } from "../../core/db.js"
import type { SmithConfig } from "../../types/index.js"
import { theme } from "../theme.js"

type FileSummaryRow = {
  path: string
  language: string
  summary: string | null
  isTest: number
  tags: string[]
  importance: number
}

type FileEdgeCount = {
  path: string
  outbound: number
  inbound: number
}

type TagCount = {
  name: string
  count: number
}

type DashData = {
  totalFiles: number
  totalSymbols: number
  totalImports: number
  totalWithSummary: number
  files: FileSummaryRow[]
  topEdges: FileEdgeCount[]
  topTags: TagCount[]
  langCounts: Array<{ language: string; count: number }>
  projectSummary: string
}

function fuzzyScore(query: string, target: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  if (t === q) return 100
  if (t.startsWith(q)) return 80 + 1 / (t.length + 1)
  if (t.includes(q)) return 60 + q.length / t.length

  let qi = 0
  let matches = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches++
      qi++
    }
  }
  if (qi === q.length) {
    return Math.round((matches / t.length) * 40)
  }
  return 0
}

function matchPosition(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const idx = t.indexOf(q)
  return idx === -1 ? Infinity : idx
}

function generateProjectSummaryFallback(args: {
  totalFiles: number
  totalSymbols: number
  totalImports: number
  files: FileSummaryRow[]
  langCounts: Array<{ language: string; count: number }>
  topTags: TagCount[]
}): string {
  const { totalFiles, totalSymbols, totalImports, langCounts, topTags } = args
  const languageText = langCounts.slice(0, 5).map((l) => `${l.language}(${l.count})`).join(", ") || "unknown"
  const tagText = topTags.slice(0, 6).map((t) => t.name).join(", ") || "none"
  return `${totalFiles} files, ${totalSymbols} symbols, ${totalImports} imports across ${languageText}. Tags: ${tagText}.`
}

function loadData(db: SmithDatabase): DashData {
  const totalFiles = (db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c
  const totalSymbols = (db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }).c
  const totalImports = (db.prepare("SELECT COUNT(*) AS c FROM imports").get() as { c: number }).c
  const totalWithSummary = (db.prepare("SELECT COUNT(*) AS c FROM files WHERE summary IS NOT NULL AND summary != ''").get() as { c: number }).c

  const fileRows = db
    .prepare("SELECT id, path, language, summary, is_test AS isTest FROM files ORDER BY CASE WHEN summary IS NULL OR summary = '' THEN 1 ELSE 0 END, path")
    .all() as Array<{ id: number; path: string; language: string; summary: string | null; isTest: number }>

  const tagRows = db
    .prepare("SELECT ft.file_id, t.name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id")
    .all() as Array<{ file_id: number; name: string }>

  const tagsByFile = new Map<number, string[]>()
  for (const row of tagRows) {
    const list = tagsByFile.get(row.file_id) ?? []
    list.push(row.name)
    tagsByFile.set(row.file_id, list)
  }

  // LLM-rated importance from meta table (keyed by file hash); fall back to heuristic.
  const impMeta = db
    .prepare("SELECT m.key, m.value FROM meta m WHERE m.key LIKE 'importance:%'")
    .all() as Array<{ key: string; value: string }>;
  const hashToImp = new Map<string, number>();
  for (const row of impMeta) {
    const hash = row.key.replace("importance:", "");
    const val = parseInt(row.value, 10);
    if (!isNaN(val)) hashToImp.set(hash, val);
  }
  const fileHashes = db
    .prepare("SELECT id, hash FROM files")
    .all() as Array<{ id: number; hash: string }>;
  const llmImpMap = new Map<number, number>();
  for (const fh of fileHashes) {
    const imp = hashToImp.get(fh.hash);
    if (imp) llmImpMap.set(fh.id, imp);
  }

  // Heuristic fallback for files without LLM importance.
  const importanceRows = db
    .prepare(`
      SELECT f.id,
        IFNULL(inb.c, 0) AS inbound,
        IFNULL(outb.c, 0) AS outbound,
        IFNULL(sym.c, 0) AS symbols
      FROM files f
      LEFT JOIN (SELECT to_file_id AS fid, COUNT(*) AS c FROM imports GROUP BY to_file_id) inb ON inb.fid = f.id
      LEFT JOIN (SELECT from_file_id AS fid, COUNT(*) AS c FROM imports GROUP BY from_file_id) outb ON outb.fid = f.id
      LEFT JOIN (SELECT file_id AS fid, COUNT(*) AS c FROM symbols GROUP BY file_id) sym ON sym.fid = f.id
    `)
    .all() as Array<{ id: number; inbound: number; outbound: number; symbols: number }>

  const heurImpMap = new Map<number, number>()
  for (const row of importanceRows) {
    heurImpMap.set(row.id, Math.round(row.inbound * 3 + row.outbound * 1 + row.symbols * 0.5))
  }

  const files: FileSummaryRow[] = fileRows.map((r) => ({
    path: r.path,
    language: r.language,
    summary: r.summary,
    isTest: r.isTest,
    tags: tagsByFile.get(r.id) ?? [],
    importance: llmImpMap.get(r.id) ?? heurImpMap.get(r.id) ?? 0,
  }))

  const topEdges = db
    .prepare(`
      SELECT f.path,
        IFNULL(out.o, 0) AS outbound,
        IFNULL(inc.i, 0) AS inbound
      FROM files f
      LEFT JOIN (SELECT from_file_id AS fid, COUNT(*) AS o FROM imports GROUP BY from_file_id) out ON out.fid = f.id
      LEFT JOIN (SELECT to_file_id AS fid, COUNT(*) AS i FROM imports GROUP BY to_file_id) inc ON inc.fid = f.id
      ORDER BY (IFNULL(out.o, 0) + IFNULL(inc.i, 0)) DESC
      LIMIT 20
    `)
    .all() as FileEdgeCount[]

  const topTags = db
    .prepare(`
      SELECT t.name, COUNT(ft.file_id) AS count
      FROM file_tags ft
      JOIN tags t ON t.id = ft.tag_id
      GROUP BY ft.tag_id
      ORDER BY count DESC
      LIMIT 10
    `)
    .all() as TagCount[]

  const langCounts = db
    .prepare(`
      SELECT language, COUNT(*) AS count
      FROM files
      WHERE language IS NOT NULL AND language != ''
      GROUP BY language
      ORDER BY count DESC
    `)
    .all() as Array<{ language: string; count: number }>

  let projectSummary = (db.prepare("SELECT value FROM meta WHERE key = 'project_summary'").get() as { value: string } | undefined)?.value ?? ""
  if (!projectSummary) {
    projectSummary = generateProjectSummaryFallback({ totalFiles, totalSymbols, totalImports, files, langCounts, topTags })
    try {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("project_summary", projectSummary)
    } catch {
      // Some older DB snapshots may have a different meta helper; display fallback anyway.
    }
  }

  return { totalFiles, totalSymbols, totalImports, totalWithSummary, files, topEdges, topTags, langCounts, projectSummary }
}

export type IndexDashboardProps = {
  db: SmithDatabase
  config: SmithConfig
  onBack: () => void
}

type Section = "overview" | "summaries" | "graph" | "tags"

type TextSegment = { text: string; color?: string; bold?: boolean }

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trimEnd()
}

function plainLength(segs: TextSegment[]): number {
  return segs.reduce((total, s) => total + oneLine(s.text || " ").length, 0)
}

function fitLine(text: string, width: number): string {
  text = oneLine(text)
  if (width <= 0) return ""
  if (text.length === width) return text
  if (text.length < width) return text + " ".repeat(width - text.length)
  if (width <= 1) return "…"
  return text.slice(0, width - 1) + "…"
}

function sameStyle(a: TextSegment, b: TextSegment): boolean {
  return (a.color ?? theme.text) === (b.color ?? theme.text) && !!a.bold === !!b.bold
}

function pushStyledPiece(row: TextSegment[], seg: TextSegment, text: string) {
  if (!text) return
  const piece: TextSegment = { ...seg, text }
  const prev = row[row.length - 1]
  if (prev && sameStyle(prev, piece)) {
    prev.text += text
  } else {
    row.push(piece)
  }
}

function trimRowRight(row: TextSegment[]): TextSegment[] {
  const copy = row.map((s) => ({ ...s }))
  while (copy.length > 0) {
    const last = copy[copy.length - 1]
    const trimmed = last.text.replace(/\s+$/g, "")
    if (trimmed.length > 0) {
      last.text = trimmed
      break
    }
    copy.pop()
  }
  return copy.length > 0 ? copy : [{ text: " " }]
}

function wrapSegments(segs: TextSegment[], width: number): TextSegment[][] {
  if (width <= 0) return [[{ text: " " }]]

  const rows: TextSegment[][] = []
  let row: TextSegment[] = []
  let used = 0

  const commitRow = () => {
    rows.push(trimRowRight(row))
    row = []
    used = 0
  }

  for (const seg of segs) {
    const text = oneLine(seg.text || " ")
    const tokens = text.match(/\S+\s*|\s+/g) ?? [text]

    for (let token of tokens) {
      if (!token) continue
      if (used === 0) token = token.replace(/^\s+/g, "")
      if (!token) continue

      while (token.length > 0) {
        const remaining = width - used

        if (token.length <= remaining) {
          pushStyledPiece(row, seg, token)
          used += token.length
          token = ""
          break
        }

        if (used > 0) {
          commitRow()
          token = token.replace(/^\s+/g, "")
          continue
        }

        // Very long unbroken text, such as a deep file path, cannot wrap on a
        // word boundary. Hard-wrap it so Ink never lets it spill past the frame.
        pushStyledPiece(row, seg, token.slice(0, width))
        token = token.slice(width).replace(/^\s+/g, "")
        commitRow()
      }
    }
  }

  if (row.length > 0) commitRow()
  return rows.length > 0 ? rows : [[{ text: " " }]]
}

function wrapBodyRows(rows: TextSegment[][], width: number): TextSegment[][] {
  const out: TextSegment[][] = []
  for (const row of rows) {
    out.push(...wrapSegments(row, width))
  }
  return out
}

function clipSegments(segs: TextSegment[], width: number): TextSegment[] {
  const out: TextSegment[] = []
  let used = 0

  for (const seg of segs) {
    if (used >= width) break

    const raw = oneLine(seg.text || " ") || " "
    const remaining = width - used
    const text = raw.length <= remaining ? raw : raw.slice(0, remaining)

    if (text.length > 0) {
      out.push({ ...seg, text })
      used += text.length
    }
  }

  return out
}

export const IndexDashboard = React.memo(function IndexDashboard({ db, config, onBack }: IndexDashboardProps) {
  const { stdout } = useStdout()
  const termRows = stdout.rows ?? 24
  const termWidth = stdout.columns ?? 80

  // Border consumes two terminal columns. Do not use padding-only rows here:
  // Ink leaves padding cells as the terminal default background, which shows up
  // as grey gaps in some terminals. Every row below is painted with black Text.
  const frameInnerWidth = Math.max(1, termWidth - 2)
  const bodyInnerWidth = frameInnerWidth

  const [data, setData] = useState<DashData | null>(null)
  const [section, setSection] = useState<Section>("overview")
  const [scrollY, setScrollY] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    setData(loadData(db))
  }, [db])

  const filteredFiles = useMemo(() => {
    if (!data || !searchQuery) return data?.files ?? []
    const scored = data.files.map((f) => {
      const pathScore = fuzzyScore(searchQuery, f.path)
      const summaryScore = f.summary ? fuzzyScore(searchQuery, f.summary) : 0
      const tagScore = f.tags.some((t) => fuzzyScore(searchQuery, t) > 0) ? 10 : 0
      const total = Math.max(pathScore, summaryScore, tagScore)
      return { file: f, score: total, pathPos: matchPosition(searchQuery, f.path) }
    })
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => {
        const diff = b.score - a.score
        if (diff !== 0) return diff
        const posDiff = a.pathPos - b.pathPos
        if (posDiff !== 0) return posDiff
        const aHas = a.file.summary ? 0 : 1
        const bHas = b.file.summary ? 0 : 1
        if (aHas !== bHas) return aHas - bHas
        return a.file.path.localeCompare(b.file.path)
      })
      .map((s) => s.file)
  }, [data, searchQuery])

  useInput((char, key) => {
    if (key.escape) {
      if (searchQuery) { setSearchQuery(""); return }
      onBack()
      return
    }
    if (key.upArrow) { setScrollY((v) => Math.max(0, v - 1)); return }
    if (key.downArrow) { setScrollY((v) => v + 1); return }
    if (key.pageUp) { setScrollY((v) => Math.max(0, v - 10)); return }
    if (key.pageDown) { setScrollY((v) => v + 10); return }
    if (key.return) { onBack(); return }

    if (char === "1") { setSection("overview"); setSearchQuery(""); setScrollY(0); return }
    if (char === "2") { setSection("summaries"); setSearchQuery(""); setScrollY(0); return }
    if (char === "3") { setSection("graph"); setSearchQuery(""); setScrollY(0); return }
    if (char === "4") { setSection("tags"); setSearchQuery(""); setScrollY(0); return }

    if (section === "summaries") {
      if (key.backspace || key.delete) {
        setSearchQuery((v) => v.slice(0, -1))
        return
      }
      if (char && !key.ctrl && !key.meta) {
        setSearchQuery((v) => v + char)
        return
      }
    }
  })

  if (!data) {
    return (
      <Box justifyContent="center" alignItems="center" height="100%">
        <Text color={theme.dim}>Loading index data...</Text>
      </Box>
    )
  }
  const d: DashData = data

  const searchActive = section === "summaries"
  const innerRows = Math.max(1, termRows - 2)
  const headerRows = 1
  const searchRows = searchActive ? 2 : 0
  const bodyHeight = Math.max(1, innerRows - headerRows - searchRows)

  const HEADER = fitLine(`INDEX DASHBOARD  [1]Overview  [2]Summaries  [3]Graph  [4]Tags  [Esc/Enter]Back`, bodyInnerWidth)

  function buildOverviewLines(): TextSegment[][] {
    const out: TextSegment[][] = []
    const sumRate = d.totalFiles > 0 ? Math.round((d.totalWithSummary / d.totalFiles) * 100) : 0

    out.push([{ text: `── Indexing Stats ──`, color: theme.primary, bold: true }])
    out.push([{ text: `  Files: ${d.totalFiles}     Symbols: ${d.totalSymbols}     Imports: ${d.totalImports}` }])
    out.push([{ text: `  Summarized: ${d.totalWithSummary}/${d.totalFiles} (${sumRate}%)` }])
    if (d.langCounts.length > 0) {
      out.push([{ text: `  Languages: ${d.langCounts.map((l) => `${l.language} (${l.count})`).join(" · ")}`, color: theme.dim }])
    }
    if (d.topTags.length > 0) {
      out.push([{ text: `  Top tags: ${d.topTags.slice(0, 6).map((t) => `${t.name} (${t.count})`).join(" · ")}`, color: theme.dim }])
    }
    out.push([{ text: `── Project Summary ──`, color: theme.primary, bold: true }])
    const langStr = d.langCounts.map((l) => `${l.language}(${l.count})`).join(", ") || "unknown"
    const tagStr = d.topTags.map((t) => t.name).join(", ") || "none"
    out.push([{ text: `  Files:${d.totalFiles}  Symbols:${d.totalSymbols}  Imports:${d.totalImports}  Langs:${langStr}`, color: theme.text }])
    out.push([{ text: `  Tags: ${tagStr}`, color: theme.dim }])
    if (d.projectSummary) {
      out.push([{ text: `  ${d.projectSummary}`, color: "cyan" }])
    } else {
      out.push([{ text: "  (not yet generated)" }])
    }

    const top20 = [...d.files]
      .filter((f) => f.summary)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 20)

    out.push([{ text: `── Top 20 Most Important Files ──`, color: theme.primary, bold: true }])
    if (top20.length === 0) {
      out.push([{ text: "  (no summaries available yet — run indexing first)" }])
    } else {
      for (let i = 0; i < top20.length; i++) {
        const f = top20[i]
        const rank = `${(i + 1).toString().padStart(2)}.`
        const impStar = f.importance >= 8 ? "★★★" : f.importance >= 5 ? "★★" : f.importance >= 3 ? "★" : " "
        const tagStr = f.tags.length > 0 ? ` [${f.tags.slice(0, 3).join(", ")}${f.tags.length > 3 ? ",..." : ""}]` : ""
        const label = f.isTest ? "[test] " : ""
        out.push([
          { text: `  ${rank} ${impStar} ${label}`, color: f.importance >= 8 ? theme.accent : theme.text, bold: f.importance >= 8 },
          { text: f.path, color: theme.accent, bold: true },
          { text: tagStr, color: "yellow" },
        ])
        if (f.summary) {
          out.push([{ text: `       ${f.summary}`, color: theme.dim }])
        }
      }
    }

    return out
  }

  function buildGraphLines(): TextSegment[][] {
    const out: TextSegment[][] = [
      [{ text: `── File Relevance Graph (top ${d.topEdges.length} by connections) ──`, color: theme.primary, bold: true }],
    ]
    if (d.topEdges.length === 0) {
      out.push([{ text: "  (no import data)" }])
    } else {
      const maxEdges = Math.max(...d.topEdges.map((e) => e.outbound + e.inbound))
      for (const e of d.topEdges) {
        const total = e.outbound + e.inbound
        const barLen = maxEdges > 0 ? Math.round((total / maxEdges) * 30) : 0
        out.push([
          { text: `  ${"█".repeat(barLen)}`, color: theme.primary },
          { text: ` ${e.path} (${e.outbound}→ ${e.inbound}←)` },
        ])
      }
    }
    return out
  }

  function buildTagsLines(): TextSegment[][] {
    const out: TextSegment[][] = [
      [{ text: `── Top Tags ──`, color: theme.primary, bold: true }],
    ]
    if (d.topTags.length === 0) {
      out.push([{ text: "  (no tag data)" }])
    } else {
      const maxTag = Math.max(...d.topTags.map((t) => t.count))
      for (const t of d.topTags) {
        const barLen = maxTag > 0 ? Math.round((t.count / maxTag) * 30) : 0
        out.push([
          { text: `  ${t.name.padEnd(16)} ` },
          { text: `${"▓".repeat(barLen)}`, color: theme.primary },
          { text: ` ${t.count}` },
        ])
      }
    }
    return out
  }

  function buildSummaryLines(): TextSegment[][] {
    const displayFiles = searchQuery ? filteredFiles : d.files
    const out: TextSegment[][] = [
      [{ text: searchQuery
        ? `── File Summaries (${displayFiles.length}/${d.files.length} files filtered) ──`
        : `── File Summaries (${d.files.length} files) ──`,
        color: theme.primary, bold: true }],
    ]

    for (const f of displayFiles) {
      const row: TextSegment[] = []
      row.push({ text: "  " })
      if (f.importance >= 50) row.push({ text: "★★★ ", color: theme.accent, bold: true })
      else if (f.importance >= 20) row.push({ text: "★★ ", color: theme.primary, bold: true })
      else if (f.importance >= 5) row.push({ text: "★ ", color: theme.text })
      if (f.isTest) row.push({ text: "[test] ", color: theme.warn })
      row.push({ text: f.path, color: theme.accent, bold: true })
      if (f.tags.length > 0) {
        const tagStr = f.tags.slice(0, 4).join(", ") + (f.tags.length > 4 ? ",..." : "")
        row.push({ text: ` [${tagStr}]`, color: "yellow" })
      }
      out.push(row)

      const summary = f.summary ? f.summary : "(no summary)"
      out.push([{ text: `    ${summary}`, color: theme.dim }])
    }

    if (searchQuery && displayFiles.length === 0) {
      out.push([{ text: `  (no files match "${searchQuery}")`, color: theme.warn }])
    }

    return out
  }

  function computeBodySegments(): TextSegment[][] {
    let segs: TextSegment[][]
    if (section === "overview") segs = buildOverviewLines()
    else if (section === "summaries") segs = buildSummaryLines()
    else if (section === "graph") segs = buildGraphLines()
    else segs = buildTagsLines()

    if (section !== "overview") {
      segs.push([{ text: `${d.totalFiles} files · ${d.totalSymbols} symbols · ${d.totalImports} imports`, color: theme.dim }])
    }

    return segs
  }
  const bodySegments = wrapBodyRows(computeBodySegments(), bodyInnerWidth)

  const bodyLineCount = bodySegments.length
  const maxBodyScroll = Math.max(0, bodyLineCount - bodyHeight)
  const bodyScroll = Math.min(scrollY, maxBodyScroll)
  const canScroll = bodyLineCount > bodyHeight && bodyScroll < maxBodyScroll
  const visibleBodyCapacity = Math.max(0, bodyHeight - (canScroll ? 1 : 0))
  const visibleBody = bodySegments.slice(bodyScroll, bodyScroll + visibleBodyCapacity)

  function renderSegments(segs: TextSegment[], key: number | string) {
    const clipped = clipSegments(segs, bodyInnerWidth)
    const used = plainLength(clipped)
    const fill = " ".repeat(Math.max(0, bodyInnerWidth - used))

    return (
      <Box key={key} width={bodyInnerWidth} height={1} overflow="hidden">
        {clipped.map((s, si) => (
          <Text key={si} color={s.color ?? theme.text} bold={s.bold} backgroundColor="black">
            {s.text || " "}
          </Text>
        ))}
        <Text backgroundColor="black">{fill}</Text>
      </Box>
    )
  }

  const lineFill = " ".repeat(bodyInnerWidth)

  function BlackLine({ keyName }: { keyName: string }) {
    return (
      <Box key={keyName} width={bodyInnerWidth} height={1} overflow="hidden">
        <Text backgroundColor="black">{lineFill}</Text>
      </Box>
    )
  }

  function BlackCanvas() {
    return (
      <Box flexDirection="column" width={termWidth} height={termRows} overflow="hidden">
        {Array.from({ length: Math.max(0, termRows) }, (_, i) => (
          <Text key={`dash-bg-${i}`} backgroundColor="black">{" ".repeat(Math.max(0, termWidth))}</Text>
        ))}
      </Box>
    )
  }

  const fillerRows = Array.from({ length: Math.max(0, visibleBodyCapacity - visibleBody.length) }, (_, i) => (
    <BlackLine key={`fill-${i}`} keyName={`fill-${i}`} />
  ))

  const scrollRow = canScroll ? (
    <Box key="scroll" width={bodyInnerWidth} height={1} overflow="hidden">
      <Text color={theme.dim} backgroundColor="black">
        {fitLine(`${'\u2193'} scroll with ${'\u2191'}${'\u2193'}`, bodyInnerWidth)}
      </Text>
    </Box>
  ) : null

  const searchLine = fitLine(`Search: ${searchQuery || "(type to filter files)"}`, bodyInnerWidth)
  const searchHelp = fitLine(`Type to filter · Esc to clear · ${'\u2191'}${'\u2193'} scroll`, bodyInnerWidth)

  return (
    <Box position="relative" flexDirection="column" width={termWidth} height={termRows} overflow="hidden">
      <Box position="absolute" width={termWidth} height={termRows} overflow="hidden">
        <BlackCanvas />
      </Box>

      <Box
        flexDirection="column"
        width={termWidth}
        height={termRows}
        borderStyle="round"
        borderColor={theme.accent}
        overflow="hidden"
      >
        <Box flexShrink={0} width={bodyInnerWidth} overflow="hidden">
          <Text color={theme.accent} bold backgroundColor="black">{HEADER}</Text>
        </Box>

        <Box flexGrow={1} flexShrink={1} flexDirection="column" width={bodyInnerWidth} overflow="hidden">
          {visibleBody.map((segs, i) => renderSegments(segs, i))}
          {fillerRows}
          {scrollRow}
        </Box>

        {searchActive && (
          <Box flexShrink={0} flexDirection="column" width={bodyInnerWidth} overflow="hidden">
            <Text color={theme.accent} bold backgroundColor="black">{searchLine}</Text>
            <Text color={theme.dim} backgroundColor="black">{searchHelp}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
})
