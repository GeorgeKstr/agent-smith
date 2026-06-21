export function getPatchPhase(input) {
    const threshold = input.inspectedFileThreshold ?? 2;
    const evidence = input.evidence;
    const changed = evidence.filesEdited.length > 0 ||
        evidence.filesCreated.length > 0;
    const checkPassed = evidence.checksRun.some((check) => check.ok);
    if (changed && checkPassed)
        return "verified";
    if (changed)
        return "changed";
    if (evidence.filesRead.length >= threshold) {
        return "ready_to_propose";
    }
    if (evidence.filesRead.length > 0) {
        return "ready_to_change";
    }
    const searched = evidence.toolResults.some((result) => result.tool === "search" && result.ok);
    if (searched)
        return "inspecting";
    return "locating";
}
