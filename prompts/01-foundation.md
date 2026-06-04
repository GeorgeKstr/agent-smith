You are a senior TypeScript systems engineer.

Continue the Agent Smith project base.

Goal:
Make Stage 1 rock-solid.

Requirements:
- Keep the Matrix/Agent Smith branding and visual theme.
- Keep the app compiling.
- Improve the existing Ink TUI.
- Ensure the boot screen renders immediately.
- Ensure scanning/indexing does not block rendering.
- Ensure `.agent/config.json` is created if missing.
- Ensure `.agent/index.sqlite` is created if missing.
- Ensure `agent-smith`, `agent-smith index`, and `agent-smith status` work.
- Ensure watcher starts while the TUI is open.
- Keep Ollama optional. The app must not crash if Ollama is not running.

Implement/fix:
- scanner
- watcher
- DB bootstrap
- event bus
- boot progress state
- main HUD layout
- clean shutdown where possible

Do not implement patching yet.
