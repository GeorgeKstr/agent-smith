export class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    registerAll(tools) {
        for (const tool of tools) {
            this.register(tool);
        }
    }
    list(mode) {
        const all = [...this.tools.values()];
        if (!mode)
            return all;
        return all.filter((t) => t.mode === mode);
    }
    get(name) {
        return this.tools.get(name);
    }
    has(name) {
        return this.tools.has(name);
    }
}
