import path from "node:path";
/** True if a relative path matches any forbidden path fragment. */
export function isForbiddenPath(relPath, forbidden) {
    const normalized = relPath.split(path.sep).join("/");
    return forbidden.some((item) => {
        const needle = item.split(path.sep).join("/");
        return normalized === needle || normalized.includes(needle) || path.basename(normalized) === needle;
    });
}
/** True if the resolved target stays inside the project root. */
export function isInsideRoot(root, relPath) {
    const resolved = path.resolve(root, relPath);
    const rel = path.relative(root, resolved);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
}
/**
 * Enforce all patch safety rules: no forbidden paths, nothing outside the root,
 * and within the configured file/line limits.
 */
export function checkPatchSafety(args) {
    const { root, config, files, changedLines } = args;
    const violations = [];
    for (const file of files) {
        if (!isInsideRoot(root, file))
            violations.push(`outside project root: ${file}`);
        if (isForbiddenPath(file, config.safety.forbiddenPaths))
            violations.push(`forbidden path: ${file}`);
    }
    if (files.length > config.safety.maxPatchFiles) {
        violations.push(`too many files (${files.length} > ${config.safety.maxPatchFiles})`);
    }
    if (changedLines > config.safety.maxPatchLines) {
        violations.push(`too many changed lines (${changedLines} > ${config.safety.maxPatchLines})`);
    }
    return { ok: violations.length === 0, violations };
}
