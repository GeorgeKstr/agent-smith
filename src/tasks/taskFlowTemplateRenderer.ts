import type { TaskFlowTemplateFormat, TaskFlowTemplateOptions } from "../types/index.js";
import { getTemplate, getTemplateBucketsAndTasks } from "./taskFlowTemplates.js";

type RenderResult = { filename: string; mimeType: string; content: string };

export function renderTaskFlowTemplate(args: {
  templateId: string;
  format: TaskFlowTemplateFormat;
  options?: TaskFlowTemplateOptions;
}): RenderResult {
  const template = getTemplate(args.templateId);
  if (!template) throw new Error(`Template not found: ${args.templateId}`);

  const data = getTemplateBucketsAndTasks(template.kind);
  const opts = args.options ?? {};
  const format = args.format;
  const ext = format === "plain" ? "txt" : format;
  const filename = `agent-smith-task-flow.${ext}`;

  let content: string;
  switch (format) {
    case "json": content = renderJson(data, opts); break;
    case "csv": content = renderCsv(data, opts); break;
    case "markdown": content = renderMarkdown(data, opts); break;
    default: content = renderPlain(data, opts); break;
  }

  const mimeTypes: Record<string, string> = {
    markdown: "text/markdown", json: "application/json", csv: "text/csv", plain: "text/plain"
  };

  return { filename, mimeType: mimeTypes[format] ?? "text/plain", content };
}

function renderMarkdown(data: { buckets: Array<{ name: string; tasks: Array<{ title: string; prompt?: string; priority?: number }> }> }, opts: TaskFlowTemplateOptions): string {
  const lines: string[] = ["# Agent Smith Task Flow", ""];
  if (opts.projectName) lines.push(`Project: ${opts.projectName}`);
  if (opts.assignedAgentId) lines.push(`Default agent: ${opts.assignedAgentId}`);
  if (opts.implementModel) lines.push(`Implement model: ${opts.implementModel}`);
  if (opts.reviewModel) lines.push(`Review model: ${opts.reviewModel}`);
  if (opts.maxIterations) lines.push(`Max iterations: ${opts.maxIterations}`);
  if (opts.autoApprove !== undefined) lines.push(`Auto approve: ${opts.autoApprove}`);
  if (opts.autoApply !== undefined) lines.push(`Auto apply: ${opts.autoApply}`);
  lines.push("");

  for (const bucket of data.buckets) {
    lines.push(`## ${bucket.name}`, "");
    for (const task of bucket.tasks) {
      lines.push(`- [ ] ${task.title}`);
      if (task.prompt && opts.includeDescriptions !== false) lines.push(`  - prompt: ${task.prompt}`);
      if (task.priority) lines.push(`  - priority: ${task.priority}`);
      if (opts.checks && opts.checks.length > 0) lines.push(`  - checks: ${opts.checks.join(",")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderJson(data: { buckets: Array<{ name: string; tasks: Array<{ title: string; prompt?: string; priority?: number }> }> }, opts: TaskFlowTemplateOptions): string {
  const defaults: Record<string, unknown> = {};
  if (opts.projectName) defaults.project = opts.projectName;
  if (opts.assignedAgentId) defaults.assignedAgentId = opts.assignedAgentId;
  if (opts.implementModel) defaults.implementModel = opts.implementModel;
  if (opts.reviewModel) defaults.reviewModel = opts.reviewModel;
  if (opts.maxIterations) defaults.maxIterations = opts.maxIterations;
  if (opts.autoApprove !== undefined) defaults.autoApprove = opts.autoApprove;
  if (opts.autoApply !== undefined) defaults.autoApply = opts.autoApply;
  if (opts.requireChecks !== undefined) defaults.requireChecks = opts.requireChecks;
  if (opts.checks && opts.checks.length > 0) defaults.checks = opts.checks;

  const tasks: Array<Record<string, unknown>> = [];
  for (const bucket of data.buckets) {
    for (const task of bucket.tasks) {
      const t: Record<string, unknown> = { title: task.title };
      if (task.prompt) t.prompt = task.prompt;
      if (opts.includeBuckets !== false && bucket.name !== "Tasks") t.bucket = bucket.name;
      if (task.priority) t.priority = task.priority;
      tasks.push(t);
    }
  }
  return JSON.stringify(Object.keys(defaults).length > 0 ? { defaults, tasks } : { tasks }, null, 2);
}

function renderCsv(data: { buckets: Array<{ name: string; tasks: Array<{ title: string; prompt?: string; priority?: number }> }> }, opts: TaskFlowTemplateOptions): string {
  const rows: string[] = ["title,prompt,bucket,priority,assignedAgentId,implementModel,reviewModel,maxIterations,autoApprove,autoApply,requireChecks,checks"];
  for (const bucket of data.buckets) {
    for (const task of bucket.tasks) {
      const row = [
        escapeCsv(task.title),
        task.prompt ? escapeCsv(task.prompt) : "",
        opts.includeBuckets !== false && bucket.name !== "Tasks" ? escapeCsv(bucket.name) : "",
        task.priority ? String(task.priority) : "",
        opts.assignedAgentId ?? "",
        opts.implementModel ?? "",
        opts.reviewModel ?? "",
        opts.maxIterations ? String(opts.maxIterations) : "",
        opts.autoApprove !== undefined ? String(opts.autoApprove) : "",
        opts.autoApply !== undefined ? String(opts.autoApply) : "",
        opts.requireChecks !== undefined ? String(opts.requireChecks) : "",
        opts.checks ? opts.checks.join(";") : ""
      ].join(",");
      rows.push(row);
    }
  }
  return rows.join("\n");
}

function renderPlain(data: { buckets: Array<{ name: string; tasks: Array<{ title: string; prompt?: string; priority?: number }> }> }, _opts: TaskFlowTemplateOptions): string {
  const lines: string[] = [];
  for (const bucket of data.buckets) {
    for (const task of bucket.tasks) {
      lines.push(task.title);
    }
  }
  return lines.join("\n");
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
