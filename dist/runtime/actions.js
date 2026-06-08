export function actionLabel(kind) {
    const map = {
        ask: "Ask",
        patch: "Patch",
        retrieve: "Retrieve",
        context: "Context",
        inspect: "Inspect",
        graph: "Graph",
        index: "Index",
        reindex: "Re-index",
        check: "Check",
        smoke: "Smoke test",
        "setup-check": "Setup"
    };
    return map[kind] ?? kind;
}
