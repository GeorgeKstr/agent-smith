export function planChecks(input) {
    const { packet, changedFiles, config } = input;
    const checks = [];
    const hasTypeScript = changedFiles.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    if (hasTypeScript && config.commands.typecheck) {
        checks.push("typecheck");
    }
    const isBug = /\b(bug|fix|broken|error|crash|regression)\b/i.test(`${packet.goal} ${packet.keywords.join(" ")}`);
    const wantsVerification = packet.verificationPlan.some((v) => v === "test");
    if ((isBug || wantsVerification) && config.commands.test) {
        checks.push("test");
    }
    const hasSourceFiles = changedFiles.some((f) => f.endsWith(".ts") ||
        f.endsWith(".tsx") ||
        f.endsWith(".js") ||
        f.endsWith(".jsx"));
    if (hasSourceFiles && config.commands.lint) {
        checks.push("lint");
    }
    if (packet.verificationPlan.includes("build") && config.commands.build) {
        checks.push("build");
    }
    return checks;
}
