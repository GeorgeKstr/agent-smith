const DEFAULT_MAX_CHARS = 1500;
const TS_ERROR_PATTERN = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(\w+):\s*(.+)$/gm;
const ESLINT_PATTERN = /^\s*(\d+:\d+)\s+(error|warning)\s+(.+?)\s+(.+)$/gm;
const TEST_FAIL_PATTERN = /\s*(✗|✕|FAIL)\s+(.+?)\s*>/gm;
const ASSERT_PATTERN = /assert.*?(?:failed|error).*$/gim;
export function summarizeCheckOutput(input) {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    const ok = input.exitCode === 0;
    const combined = (input.stdout + "\n" + input.stderr).trim();
    const relevantErrors = [];
    // TypeScript errors
    let m;
    TS_ERROR_PATTERN.lastIndex = 0;
    while ((m = TS_ERROR_PATTERN.exec(combined)) !== null) {
        relevantErrors.push({
            file: m[1],
            line: parseInt(m[2], 10) || undefined,
            message: `${m[5]}: ${m[6]}`,
        });
        if (relevantErrors.length >= 6)
            break;
    }
    TS_ERROR_PATTERN.lastIndex = 0;
    // ESLint errors
    if (relevantErrors.length < 6) {
        ESLINT_PATTERN.lastIndex = 0;
        while ((m = ESLINT_PATTERN.exec(combined)) !== null) {
            const loc = m[1].split(":");
            relevantErrors.push({
                line: parseInt(loc[0], 10) || undefined,
                message: `${m[2]}: ${m[3]} — ${m[4]}`,
            });
            if (relevantErrors.length >= 6)
                break;
        }
        ESLINT_PATTERN.lastIndex = 0;
    }
    // Test failures
    if (relevantErrors.length < 6) {
        TEST_FAIL_PATTERN.lastIndex = 0;
        while ((m = TEST_FAIL_PATTERN.exec(combined)) !== null) {
            relevantErrors.push({
                file: m[2].trim() || undefined,
                message: `Test failed: ${m[0].trim()}`,
            });
            if (relevantErrors.length >= 6)
                break;
        }
        TEST_FAIL_PATTERN.lastIndex = 0;
    }
    // Generic assertion errors
    if (relevantErrors.length < 6) {
        ASSERT_PATTERN.lastIndex = 0;
        while ((m = ASSERT_PATTERN.exec(combined)) !== null) {
            relevantErrors.push({
                message: m[0].trim(),
            });
            if (relevantErrors.length >= 6)
                break;
        }
        ASSERT_PATTERN.lastIndex = 0;
    }
    // Fallback: grab first meaningful lines
    if (relevantErrors.length === 0 && !ok) {
        const lines = combined
            .split("\n")
            .filter((l) => l.trim())
            .slice(0, 4);
        for (const line of lines) {
            relevantErrors.push({ message: line.trim().slice(0, 200) });
        }
    }
    const truncated = combined.length > maxChars;
    return {
        ok,
        summary: ok
            ? `${input.name}: PASS`
            : `${input.name}: FAIL (${relevantErrors.length} issue(s))`,
        relevantErrors: relevantErrors.slice(0, 6),
        truncated,
    };
}
