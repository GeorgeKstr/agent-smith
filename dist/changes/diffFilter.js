export function filterDiffToFiles(diff, acceptedPaths) {
    if (!diff || !diff.trim())
        return "";
    if (acceptedPaths.length === 0)
        return "";
    const accepted = new Set(acceptedPaths.map((p) => p.replace(/^[ab]\//, "")));
    const lines = diff.split("\n");
    const result = [];
    let currentPath = null;
    let collecting = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith("diff --git ")) {
            const match = trimmed.match(/diff --git a\/(.*) b\/(.*)/);
            if (match) {
                currentPath = match[2] !== "/dev/null" ? match[2] : match[1];
                collecting = accepted.has(currentPath);
            }
            else {
                currentPath = null;
                collecting = false;
            }
            if (collecting) {
                result.push(line);
            }
            continue;
        }
        if (collecting) {
            result.push(line);
        }
    }
    return result.join("\n").trim();
}
