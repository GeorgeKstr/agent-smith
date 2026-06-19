export function buildUnifiedDiffFromEdit(input) {
    const { path, before, after } = input;
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    const header = `--- a/${path}\n+++ b/${path}\n`;
    // Find changed ranges
    const hunks = [];
    let i = 0;
    let j = 0;
    while (i < beforeLines.length || j < afterLines.length) {
        while (i < beforeLines.length && j < afterLines.length && beforeLines[i] === afterLines[j]) {
            i++;
            j++;
        }
        if (i >= beforeLines.length && j >= afterLines.length)
            break;
        const hunkStart = Math.max(0, i - 3);
        let hunkEndOld = i;
        let hunkEndNew = j;
        let oldCount = 0;
        let newCount = 0;
        while (hunkEndOld < beforeLines.length || hunkEndNew < afterLines.length) {
            const same = hunkEndOld < beforeLines.length &&
                hunkEndNew < afterLines.length &&
                beforeLines[hunkEndOld] === afterLines[hunkEndNew];
            if (same)
                break;
            if (hunkEndOld < beforeLines.length) {
                oldCount++;
                hunkEndOld++;
            }
            if (hunkEndNew < afterLines.length) {
                newCount++;
                hunkEndNew++;
            }
        }
        const contextAfter = Math.min(3, beforeLines.length - hunkEndOld);
        hunkEndOld += contextAfter;
        hunkEndNew += contextAfter;
        const hunkHeader = `@@ -${hunkStart + 1},${hunkEndOld - hunkStart} +${hunkStart + 1},${hunkEndNew - hunkStart} @@`;
        const hunkLines = [hunkHeader];
        for (let k = hunkStart; k < hunkEndOld; k++) {
            const line = beforeLines[k] ?? "";
            if (k >= i && k < hunkEndOld - contextAfter) {
                hunkLines.push(`-${line}`);
            }
            else {
                hunkLines.push(` ${line}`);
            }
        }
        for (let k = hunkStart; k < hunkEndNew; k++) {
            const line = afterLines[k] ?? "";
            const isNew = k >= j &&
                (k >= beforeLines.length ||
                    beforeLines[k] !== afterLines[k]);
            if (isNew && k < hunkEndNew - contextAfter) {
                hunkLines.push(`+${line}`);
            }
            else if (k >= beforeLines.length) {
                hunkLines.push(`+${line}`);
            }
        }
        hunks.push(hunkLines.join("\n"));
        i = hunkEndOld;
        j = hunkEndNew;
    }
    return header + hunks.join("\n");
}
