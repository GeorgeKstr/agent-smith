import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { theme } from "../theme.js";
const CHARS = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍｦｲｸｺｿﾁﾄﾉﾌﾎﾏﾔﾚｦ0123456789<>/{}[]|&^%$#@!";
const BG = "#001a00";
function createDrop(x) {
    const length = Math.floor(Math.random() * 10) + 4;
    return {
        x,
        y: -(Math.random() * length),
        speed: 0.2 + Math.random() * 0.6,
        length,
        chars: Array.from({ length }, () => CHARS[Math.floor(Math.random() * CHARS.length)]),
    };
}
export function MatrixRain({ enabled, maxRows }) {
    const { stdout } = useStdout();
    const cols = stdout.columns ?? 80;
    const rows = maxRows ?? (stdout.rows ?? 24);
    const dropsRef = useRef([]);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!enabled)
            return;
        dropsRef.current = Array.from({ length: Math.floor(cols / 3) }, () => ({
            ...createDrop(Math.floor(Math.random() * cols)),
            y: Math.random() * rows,
        }));
        const interval = setInterval(() => {
            dropsRef.current = dropsRef.current
                .map((d) => {
                const y = d.y + d.speed;
                if (y > rows + d.length)
                    return createDrop(d.x);
                const chars = d.chars.map((c) => Math.random() < 0.04
                    ? CHARS[Math.floor(Math.random() * CHARS.length)]
                    : c);
                return { ...d, y, chars };
            });
            if (Math.random() < 0.15 && dropsRef.current.length < cols * 0.5) {
                dropsRef.current.push(createDrop(Math.floor(Math.random() * cols)));
            }
            setTick((t) => (t + 1) % 1000);
        }, 80);
        return () => clearInterval(interval);
    }, [enabled, rows, cols]);
    if (!enabled)
        return null;
    return (_jsx(Box, { position: "absolute", width: cols, height: rows, flexDirection: "column", children: buildRows(dropsRef.current, rows, cols) }));
}
function buildRows(drops, rows, cols) {
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ char: " ", brightness: 0 })));
    for (const drop of drops) {
        const top = Math.floor(drop.y);
        for (let i = 0; i < drop.length; i++) {
            const r = top + i;
            if (r < 0 || r >= rows)
                continue;
            const c = drop.x;
            if (c < 0 || c >= cols)
                continue;
            const cell = grid[r][c];
            cell.char = drop.chars[i] ?? cell.char;
            const brightness = drop.length - i;
            if (brightness > cell.brightness) {
                cell.brightness = brightness;
            }
        }
    }
    const rowEls = [];
    for (let r = 0; r < rows; r++) {
        const segs = [];
        let current = null;
        for (let c = 0; c < cols; c++) {
            const { char, brightness } = grid[r][c];
            let color;
            let dimColor;
            if (brightness >= 4) {
                color = theme.primary;
                dimColor = false;
            }
            else if (brightness === 3) {
                color = theme.text;
                dimColor = false;
            }
            else if (brightness === 2) {
                color = theme.text;
                dimColor = true;
            }
            else {
                color = "gray";
                dimColor = true;
            }
            const ch = brightness <= 0 ? " " : char;
            if (current && current.color === color && current.dimColor === dimColor) {
                current.chars += ch;
            }
            else {
                if (current)
                    segs.push(current);
                current = { chars: ch, color, dimColor, bg: BG };
            }
        }
        if (current)
            segs.push(current);
        rowEls.push(_jsx(Box, { height: 1, children: segs.map((s, i) => (_jsx(Text, { color: s.color, dimColor: s.dimColor, backgroundColor: s.bg, children: s.chars }, i))) }, r));
    }
    return rowEls;
}
