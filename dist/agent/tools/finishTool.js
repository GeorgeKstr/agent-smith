const finishTool = {
    name: "finish",
    description: "Finish the task with a concise summary.",
    parameters: {
        type: "object",
        properties: {
            summary: { type: "string", description: "What was done and why." },
            changedFiles: {
                type: "array",
                items: { type: "string" },
                description: "List of changed file paths.",
            },
            checksRun: {
                type: "array",
                items: { type: "string" },
                description: "List of checks that were run.",
            },
            remainingIssues: {
                type: "array",
                items: { type: "string" },
                description: "Any unresolved issues.",
            },
        },
        required: ["summary", "changedFiles", "checksRun"],
    },
    mode: "patch",
    async handler(rawArgs) {
        const args = rawArgs;
        const summary = typeof args.summary === "string" ? args.summary : "Task completed.";
        const changedFiles = Array.isArray(args.changedFiles)
            ? args.changedFiles.map(String)
            : [];
        const checksRun = Array.isArray(args.checksRun)
            ? args.checksRun.map(String)
            : [];
        const remainingIssues = Array.isArray(args.remainingIssues)
            ? args.remainingIssues.map(String)
            : [];
        return {
            ok: true,
            summary: `FINISHED: ${summary}`,
            content: summary,
            metadata: {
                changedFiles,
                checksRun,
                remainingIssues,
                isFinish: true,
            },
        };
    },
};
export { finishTool };
