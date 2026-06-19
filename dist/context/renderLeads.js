const MAX_EVIDENCE_TEXT_CHARS = 240;
export function renderRetrievalLeads(leads, maxEvidenceChars) {
    if (leads.length === 0)
        return "No relevant leads found.";
    const limit = maxEvidenceChars ?? MAX_EVIDENCE_TEXT_CHARS;
    const lines = ["Relevant leads:"];
    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        lines.push(`${i + 1}. ${lead.path}`);
        lines.push(`   Reason: ${lead.reason}`);
        if (lead.evidence.length > 0) {
            lines.push("   Evidence:");
            for (const ev of lead.evidence) {
                const loc = ev.lines && ev.lines.length === 2
                    ? ` lines ${ev.lines[0]}-${ev.lines[1]}`
                    : "";
                const text = ev.text.length > limit
                    ? ev.text.slice(0, limit) + "..."
                    : ev.text;
                lines.push(`   - ${ev.type}${loc}: ${text}`);
            }
        }
        const action = lead.recommendedAction;
        if (action === "read_lines" && lead.suggestedRanges && lead.suggestedRanges.length > 0) {
            const rangeStr = lead.suggestedRanges
                .slice(0, 2)
                .map(([s, e]) => `${s}-${e}`)
                .join(", ");
            lines.push(`   Recommended: read_lines ${rangeStr}.`);
        }
        else if (action === "read_symbol") {
            lines.push("   Recommended: read_symbol.");
        }
        else if (action === "search_more") {
            lines.push("   Recommended: search_more to narrow down.");
        }
        else {
            lines.push("   Recommended: ignore.");
        }
    }
    return lines.join("\n");
}
