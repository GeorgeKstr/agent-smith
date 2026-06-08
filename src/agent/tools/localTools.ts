import fs from "node:fs/promises";
import path from "node:path";
import type { SmithDatabase } from "../../db/db.js";
import type { RegisteredQwenTool } from "./qwenTools.js";
import { fileNeighbors } from "../../index/graph.js";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function insideRoot(root: string, relPath: string): boolean {
  const resolved = path.resolve(root, relPath);
  const rel = path.relative(root, resolved);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function createLocalProjectTools(args: { root: string; db: SmithDatabase }): RegisteredQwenTool[] {
  const { root, db } = args;

  return [
    {
      function: {
        name: "find_files",
        description: "Find indexed project files by path or summary. Use this before reading files.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Keyword or path fragment to search for." },
            limit: { type: "number", description: "Maximum number of files to return. Defaults to 8." }
          },
          required: ["query"]
        }
      },
      handler: ({ query, limit }) => {
        const q = `%${str(query)}%`;
        const rows = db
          .prepare(
            `SELECT path, language, summary
             FROM files
             WHERE path LIKE ? OR COALESCE(summary, '') LIKE ?
             ORDER BY CASE WHEN path LIKE ? THEN 0 ELSE 1 END, length(path)
             LIMIT ?`
          )
          .all(q, q, q, num(limit, 8, 1, 30)) as Array<{ path: string; language: string; summary: string | null }>;
        return rows;
      }
    },
    {
      function: {
        name: "find_symbols",
        description: "Find indexed functions, classes, methods, interfaces, types, components, or enums.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Symbol name or keyword to search for." },
            limit: { type: "number", description: "Maximum number of symbols to return. Defaults to 12." }
          },
          required: ["query"]
        }
      },
      handler: ({ query, limit }) => {
        const q = `%${str(query)}%`;
        return db
          .prepare(
            `SELECT s.name, s.kind, s.start_line AS startLine, s.end_line AS endLine, f.path
             FROM symbols s
             JOIN files f ON f.id = s.file_id
             WHERE s.name LIKE ? OR COALESCE(s.signature, '') LIKE ? OR f.path LIKE ?
             ORDER BY length(s.name), f.path
             LIMIT ?`
          )
          .all(q, q, q, num(limit, 12, 1, 40));
      }
    },
    {
      function: {
        name: "read_file",
        description: "Read a small window from a project file by relative path.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative project path." },
            startLine: { type: "number", description: "1-based start line. Defaults to 1." },
            maxLines: { type: "number", description: "Maximum lines to return. Defaults to 160." }
          },
          required: ["path"]
        }
      },
      handler: async ({ path: relPath, startLine, maxLines }) => {
        const rel = str(relPath);
        if (!rel || !insideRoot(root, rel)) return { error: `Invalid path: ${rel}` };
        const text = await fs.readFile(path.join(root, rel), "utf8");
        const lines = text.split("\n");
        const start = num(startLine, 1, 1, Math.max(1, lines.length)) - 1;
        const count = num(maxLines, 160, 1, 400);
        return {
          path: rel,
          startLine: start + 1,
          endLine: Math.min(lines.length, start + count),
          content: lines.slice(start, start + count).join("\n")
        };
      }
    },
    {
      function: {
        name: "file_neighbors",
        description: "Return immediate local import graph neighbors for a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative project path." }
          },
          required: ["path"]
        }
      },
      handler: ({ path: relPath }) => fileNeighbors(db, str(relPath)) ?? { error: "File not found in graph" }
    }
  ];
}
