import React, { useEffect, useRef, useState } from "react"
import { Box, Text, useStdout } from "ink"
import { theme } from "../theme.js"

const CHARS = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍｦｲｸｺｿﾁﾄﾉﾌﾎﾏﾔﾚｦ0123456789<>/{}[]|&^%$#@!"
const BG = "#001a00"

type Drop = {
  x: number
  y: number
  speed: number
  length: number
  chars: string[]
}

function createDrop(x: number): Drop {
  const length = Math.floor(Math.random() * 10) + 4
  return {
    x,
    y: -(Math.random() * length),
    speed: 0.2 + Math.random() * 0.6,
    length,
    chars: Array.from({ length }, () => CHARS[Math.floor(Math.random() * CHARS.length)]),
  }
}

type Cell = {
  char: string
  brightness: number
}

export function MatrixRain({ enabled, maxRows }: { enabled: boolean; maxRows?: number }) {
  const { stdout } = useStdout()
  const cols = stdout.columns ?? 80
  const rows = maxRows ?? (stdout.rows ?? 24)
  const dropsRef = useRef<Drop[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    dropsRef.current = Array.from(
      { length: Math.floor(cols / 3) },
      () => ({
        ...createDrop(Math.floor(Math.random() * cols)),
        y: Math.random() * rows,
      })
    )
    const interval = setInterval(() => {
      dropsRef.current = dropsRef.current
        .map((d) => {
          const y = d.y + d.speed
          if (y > rows + d.length) return createDrop(d.x)
          const chars = d.chars.map((c) =>
            Math.random() < 0.04
              ? CHARS[Math.floor(Math.random() * CHARS.length)]
              : c
          )
          return { ...d, y, chars }
        })
      if (Math.random() < 0.15 && dropsRef.current.length < cols * 0.5) {
        dropsRef.current.push(createDrop(Math.floor(Math.random() * cols)))
      }
      setTick((t) => (t + 1) % 1000)
    }, 80)
    return () => clearInterval(interval)
  }, [enabled, rows, cols])

  if (!enabled) return null

  return (
    <Box position="absolute" width={cols} height={rows} flexDirection="column">
      {buildRows(dropsRef.current, rows, cols)}
    </Box>
  )
}

type Seg = { chars: string; color: string; dimColor: boolean; bg: string }

function buildRows(drops: Drop[], rows: number, cols: number) {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ char: " ", brightness: 0 }))
  )

  for (const drop of drops) {
    const top = Math.floor(drop.y)
    for (let i = 0; i < drop.length; i++) {
      const r = top + i
      if (r < 0 || r >= rows) continue
      const c = drop.x
      if (c < 0 || c >= cols) continue
      const cell = grid[r][c]
      cell.char = drop.chars[i] ?? cell.char
      const brightness = drop.length - i
      if (brightness > cell.brightness) {
        cell.brightness = brightness
      }
    }
  }

  const rowEls: React.ReactElement[] = []
  for (let r = 0; r < rows; r++) {
    const segs: Seg[] = []
    let current: Seg | null = null

    for (let c = 0; c < cols; c++) {
      const { char, brightness } = grid[r][c]
      let color: string
      let dimColor: boolean

      if (brightness >= 4) {
        color = theme.primary; dimColor = false
      } else if (brightness === 3) {
        color = theme.text; dimColor = false
      } else if (brightness === 2) {
        color = theme.text; dimColor = true
      } else {
        color = "gray"; dimColor = true
      }

      const ch = brightness <= 0 ? " " : char

      if (current && current.color === color && current.dimColor === dimColor) {
        current.chars += ch
      } else {
        if (current) segs.push(current)
        current = { chars: ch, color, dimColor, bg: BG }
      }
    }
    if (current) segs.push(current)

    rowEls.push(
      <Box key={r} height={1}>
        {segs.map((s, i) => (
          <Text key={i} color={s.color} dimColor={s.dimColor} backgroundColor={s.bg}>
            {s.chars}
          </Text>
        ))}
      </Box>
    )
  }

  return rowEls
}
