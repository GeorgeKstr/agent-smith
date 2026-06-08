import type { TaskImportFormat, ParsedImportedTask, TaskImportPreview } from "../types/index.js";

export function parseTaskImport(text: string, format?: TaskImportFormat): TaskImportPreview {
  const raw = text.trim();
  if (!raw) return { format: "plain", tasks: [], warnings: ["Empty input"] };

  const detected = format ?? detectFormat(raw);
  const warnings: string[] = [];

  let tasks: ParsedImportedTask[];

  switch (detected) {
    case "json": tasks = parseJson(raw, warnings); break;
    case "csv": tasks = parseCsv(raw, warnings); break;
    case "markdown": tasks = parseMarkdown(raw, warnings); break;
    default: tasks = parsePlain(raw, warnings); break;
  }

  return { format: detected, tasks, warnings };
}

function detectFormat(text: string): TaskImportFormat {
  const first = text.trimStart();
  if (first.startsWith("{") || first.startsWith("[")) return "json";
  const lines = text.split("\n").filter((l) => l.trim());
  const firstLine = lines[0] ?? "";
  if (firstLine.includes(",")) {
    const fields = firstLine.split(",").map((f) => f.trim().toLowerCase().replace(/"/g, ""));
    if (fields.includes("title")) return "csv";
  }
  for (const line of lines.slice(0, 10)) {
    const t = line.trim();
    if (t.startsWith("#") || t.startsWith("- [") || t.startsWith("* [")) return "markdown";
  }
  return "plain";
}

function parsePlain(text: string, warnings: string[]): ParsedImportedTask[] {
  const tasks: ParsedImportedTask[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^[-*•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .trim();
    if (line) tasks.push({ title: line });
  }
  return tasks;
}

function parseMarkdown(text: string, warnings: string[]): ParsedImportedTask[] {
  const tasks: ParsedImportedTask[] = [];
  let currentBucket: string | undefined;
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line) continue;

    // Headings become bucket names
    const hMatch = line.match(/^#{2,4}\s+(.+)/);
    if (hMatch) {
      currentBucket = hMatch[1].trim();
      continue;
    }

    // Checkbox items
    const cbMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)/);
    if (cbMatch) {
      const checked = cbMatch[1].toLowerCase() !== " ";
      const title = cbMatch[2].trim();
      tasks.push({
        title,
        bucketName: currentBucket,
        status: checked ? "done" : undefined
      });
      if (checked) warnings.push(`Task "${title.slice(0, 50)}" marked as completed`);
      continue;
    }

    // Bullet items
    const bulletMatch = line.match(/^[-*+]\s+(.+)/);
    if (bulletMatch) {
      tasks.push({ title: bulletMatch[1].trim(), bucketName: currentBucket });
      continue;
    }

    // Plain lines under a heading
    if (currentBucket && !line.startsWith("#") && !line.startsWith("```")) {
      tasks.push({ title: line, bucketName: currentBucket });
    }
  }
  return tasks;
}

function parseCsv(text: string, warnings: string[]): ParsedImportedTask[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) { warnings.push("CSV must have header + data rows"); return []; }

  const header = rows[0].map((h) => h.toLowerCase().trim());
  const tasks: ParsedImportedTask[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cols[j]?.trim() ?? "";

    const title = row.title ?? row.prompt ?? "";
    if (!title) { warnings.push(`Row ${i + 1}: missing title`); continue; }

    const checksStr = row.checks || "";
    const checks = checksStr ? checksStr.split(/[,;]/).map((c) => c.trim()).filter(Boolean) : undefined;

    tasks.push({
      title,
      prompt: row.prompt || undefined,
      description: row.description || undefined,
      bucketName: row.bucket || row.bucketname || undefined,
      priority: row.priority ? parseInt(row.priority) || undefined : undefined,
      assignedAgentId: row.agent || row.assignedagentid || undefined,
      implementModel: row.implementmodel || undefined,
      reviewModel: row.reviewmodel || undefined,
      maxIterations: row.maxiterations ? parseInt(row.maxiterations) || undefined : undefined,
      autoApprove: row.autoapprove ? row.autoapprove.toLowerCase() === "true" : undefined,
      autoApply: row.autoapply ? row.autoapply.toLowerCase() === "true" : undefined,
      requireChecks: row.requirechecks ? row.requirechecks.toLowerCase() === "true" : undefined,
      checks
    });
  }
  return tasks;
}

function parseJson(text: string, warnings: string[]): ParsedImportedTask[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { warnings.push("Invalid JSON"); return []; }

  if (Array.isArray(parsed)) {
    return parsed.map((item: unknown) => jsonToTask(item, warnings)).filter(Boolean) as ParsedImportedTask[];
  }

  if (typeof parsed === "object" && parsed) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.tasks)) {
      return (obj.tasks as unknown[]).map((item) => jsonToTask(item, warnings)).filter(Boolean) as ParsedImportedTask[];
    }
  }

  warnings.push("JSON must be an array or {tasks:[...]}");
  return [];
}

function jsonToTask(item: unknown, warnings: string[]): ParsedImportedTask | null {
  if (typeof item !== "object" || !item) return null;
  const t = item as Record<string, unknown>;
  const title = typeof t.title === "string" ? t.title.trim() : "";
  if (!title) { warnings.push("JSON item missing title"); return null; }
  return {
    title,
    prompt: typeof t.prompt === "string" ? t.prompt : undefined,
    description: typeof t.description === "string" ? t.description : undefined,
    bucketName: typeof t.bucketName === "string" ? t.bucketName : undefined,
    status: typeof t.status === "string" ? t.status : undefined,
    priority: typeof t.priority === "number" ? t.priority : undefined,
    assignedAgentId: typeof t.assignedAgentId === "string" ? t.assignedAgentId : undefined,
    implementModel: typeof t.implementModel === "string" ? t.implementModel : undefined,
    reviewModel: typeof t.reviewModel === "string" ? t.reviewModel : undefined,
    maxIterations: typeof t.maxIterations === "number" ? t.maxIterations : undefined,
    autoApprove: typeof t.autoApprove === "boolean" ? t.autoApprove : undefined,
    autoApply: typeof t.autoApply === "boolean" ? t.autoApply : undefined,
    requireChecks: typeof t.requireChecks === "boolean" ? t.requireChecks : undefined,
    checks: Array.isArray(t.checks) ? (t.checks as string[]) : undefined,
  };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { cols.push(current); current = ""; continue; }
      current += ch;
    }
    cols.push(current);
    rows.push(cols);
  }
  return rows;
}
