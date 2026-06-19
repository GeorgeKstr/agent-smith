import { execa } from "execa";
import type { AgentTool } from "./toolRegistry.js";

const MAX_RESULTS = 8;
const MAX_PREVIEW_CHARS = 200;

export const searchTool: AgentTool = {
  name: "search",
  description:
    "Search indexed files, symbols, summaries, and text. Returns compact leads, not full files.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query string." },
      kind: {
        type: "string",
        enum: ["all", "text", "file", "symbol", "summary"],
        description: "What to search. Defaults to 'all'.",
      },
      maxResults: {
        type: "number",
        description: "Maximum results. Defaults to 8.",
      },
    },
    required: ["query"],
  },
  mode: "readonly",

  async handler(rawArgs, ctx): Promise<any> {
    const args = rawArgs as Record<string, unknown>;
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { ok: false, summary: "No query provided." };

    const kind = typeof args.kind === "string" ? args.kind : "all";
    const maxResults =
      typeof args.maxResults === "number" && Number.isFinite(args.maxResults)
        ? Math.min(Math.max(1, Math.floor(args.maxResults)), 20)
        : MAX_RESULTS;

    const results: string[] = [];

    if (kind === "all" || kind === "file") {
      const like = `%${query}%`;
      const rows = ctx.db
        .prepare(
          `SELECT path, language, COALESCE(summary, '') as summary
           FROM files
           WHERE path LIKE ? OR summary LIKE ?
           ORDER BY CASE WHEN path LIKE ? THEN 0 ELSE 1 END, length(path)
           LIMIT ?`
        )
        .all(like, like, like, Math.ceil(maxResults / 2)) as Array<{
        path: string;
        language: string;
        summary: string;
      }>;
      for (const row of rows) {
        results.push(`FILE: ${row.path} (${row.language || "?"})${row.summary ? ` - ${row.summary.slice(0, MAX_PREVIEW_CHARS)}` : ""}`);
      }
    }

    if (kind === "all" || kind === "symbol") {
      const like = `%${query}%`;
      const rows = ctx.db
        .prepare(
          `SELECT s.name, s.kind, s.start_line, f.path
           FROM symbols s
           JOIN files f ON f.id = s.file_id
           WHERE s.name LIKE ? OR COALESCE(s.signature, '') LIKE ?
           ORDER BY length(s.name), f.path
           LIMIT ?`
        )
        .all(like, like, Math.ceil(maxResults / 2)) as Array<{
        name: string;
        kind: string;
        start_line: number;
        path: string;
      }>;
      for (const row of rows) {
        results.push(`SYMBOL: ${row.name} (${row.kind}) @ ${row.path}:${row.start_line}`);
      }
    }

    if (kind === "all" || kind === "summary") {
      const like = `%${query}%`;
      const rows = ctx.db
        .prepare(
          `SELECT path, summary FROM files WHERE summary IS NOT NULL AND summary LIKE ? ORDER BY length(path) LIMIT ?`
        )
        .all(like, Math.ceil(maxResults / 3)) as Array<{ path: string; summary: string }>;
      for (const row of rows) {
        results.push(`SUMMARY: ${row.path} - ${row.summary.slice(0, MAX_PREVIEW_CHARS)}`);
      }
    }

    if (kind === "all" || kind === "text") {
      try {
        const { stdout } = await execa(
          "rg",
          [
            "--no-heading",
            "--line-number",
            "--max-count=3",
            "-e",
            escapeRegex(query),
            ".",
          ],
          { cwd: ctx.root, reject: false, timeout: 10_000 }
        );
        const lines = stdout.split("\n").filter(Boolean);
        let added = 0;
        for (const line of lines) {
          if (added >= Math.ceil(maxResults / 2)) break;
          const colon1 = line.indexOf(":");
          const colon2 = line.indexOf(":", colon1 + 1);
          if (colon2 === -1) {
            results.push(`TEXT: ${line.slice(0, MAX_PREVIEW_CHARS)}`);
          } else {
            const file = line.slice(0, colon1);
            const ln = line.slice(colon1 + 1, colon2);
            const content = line.slice(colon2 + 1).slice(0, MAX_PREVIEW_CHARS);
            results.push(`TEXT: ${file}:${ln} - ${content}`);
          }
          added++;
        }
      } catch {
        // ripgrep not available
      }
    }

    const limited = results.slice(0, maxResults);
    if (limited.length === 0) {
      return {
        ok: true,
        summary: `No results found for "${query}" (kind: ${kind}).`,
        nextActions: ["Try a different query or broader kind."],
      };
    }

    return {
      ok: true,
      summary: `Found ${limited.length} result(s) for "${query}":`,
      content: limited.join("\n"),
      nextActions: ["Use read to inspect specific files."],
    };
  },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
