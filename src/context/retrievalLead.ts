import type { SmithDatabase } from "../db/db.js";
import type { TaskPacket } from "./taskPacket.js";
import type { ScoredFile } from "../types/index.js";

export type RetrievalLeadEvidenceType =
  | "grep"
  | "symbol"
  | "summary"
  | "tag"
  | "graph"
  | "memory"
  | "file_hint"
  | "test";

export type RetrievalLeadEvidence = {
  type: RetrievalLeadEvidenceType;
  text: string;
  lines?: [number, number];
};

export type RetrievalLead = {
  path: string;
  score: number;
  reason: string;
  evidence: RetrievalLeadEvidence[];
  recommendedAction: "read_lines" | "read_symbol" | "search_more" | "ignore";
  suggestedRanges?: Array<[number, number]>;
};

export function scoredFileToLead(
  file: ScoredFile,
  symbolRanges?: Array<{ name: string; startLine: number; endLine: number }>
): RetrievalLead {
  const evidence: RetrievalLeadEvidence[] = [];

  for (const detail of file.reasonDetails ?? []) {
    const lines = file.path ? undefined : undefined;
    evidence.push({
      type: detail.signal as RetrievalLeadEvidenceType,
      text: detail.detail,
      lines,
    });
  }

  const ranges: Array<[number, number]> = [];
  if (symbolRanges && symbolRanges.length > 0) {
    for (const s of symbolRanges.slice(0, 3)) {
      ranges.push([s.startLine, s.endLine]);
    }
  }

  let action: RetrievalLead["recommendedAction"] = "search_more";
  if (ranges.length > 0) {
    action = "read_lines";
  } else if (file.reasons.some((r) => r.startsWith("sym:"))) {
    action = "read_symbol";
  }

  return {
    path: file.path,
    score: file.score,
    reason: file.reasons.join(", ") || "related",
    evidence: evidence.slice(0, 4),
    recommendedAction: action,
    suggestedRanges: ranges.length > 0 ? ranges : undefined,
  };
}

export function leadsFromScoredFiles(
  files: ScoredFile[],
  maxLeads: number,
  maxEvidencePerLead: number,
  symbolMap?: Map<string, Array<{ name: string; startLine: number; endLine: number }>>
): RetrievalLead[] {
  return files.slice(0, maxLeads).map((file) => {
    const lead = scoredFileToLead(file, symbolMap?.get(file.path));
    lead.evidence = lead.evidence.slice(0, maxEvidencePerLead);
    return lead;
  });
}

export type RetrieveLeadsResult = {
  leads: RetrievalLead[];
};

export async function retrieveLeads(input: {
  db: SmithDatabase;
  root: string;
  packet: TaskPacket;
  scoredFiles: ScoredFile[];
  maxLeads?: number;
  maxEvidencePerLead?: number;
}): Promise<RetrieveLeadsResult> {
  const maxLeads = input.maxLeads ?? 12;

  const symbolRows = input.db
    .prepare(
      `SELECT s.name, s.start_line, s.end_line, f.path
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       ORDER BY f.path, s.start_line`
    )
    .all() as Array<{ name: string; start_line: number; end_line: number; path: string }>;

  const symbolMap = new Map<string, Array<{ name: string; startLine: number; endLine: number }>>();
  for (const row of symbolRows) {
    const list = symbolMap.get(row.path) ?? [];
    list.push({ name: row.name, startLine: row.start_line, endLine: row.end_line });
    symbolMap.set(row.path, list);
  }

  const ranked = input.scoredFiles.filter((f) => f.score > 0).sort((a, b) => b.score - a.score);
  const leads = leadsFromScoredFiles(ranked, maxLeads, input.maxEvidencePerLead ?? 4, symbolMap);

  return { leads };
}
