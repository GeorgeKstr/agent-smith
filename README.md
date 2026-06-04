# Agent Smith

A Matrix-themed local-first terminal coding agent for small/medium codebases and local Ollama models.

Agent Smith is designed around one principle:

> The app is the agent. The model is a constrained reasoning and patching engine.

Instead of dumping the whole repo into a local model, Agent Smith builds a persistent project intelligence index:

- file hashes and summaries
- global numeric tags
- tree-sitter symbols
- import/symbol graph
- task memory
- dense context packets
- patch/test/re-index loop

## Requirements

- **Node.js >= 18** and npm
- **[Ollama](https://ollama.com)** running locally (optional but recommended).
  Without it, indexing/retrieval still work; summaries, classification, and
  patch generation degrade gracefully.
- **git** (used by the patch apply/repair loop and by the install script)

## Install

### Option 1 — npm, straight from GitHub (no publish needed)

```bash
npm install -g github:GeorgeKstr/agent-smith
```

This clones the repo, runs the `prepare` script to build it, and puts the
`smith` command (plus an `agent-smith` alias) on your PATH.

### Option 2 — run without installing

```bash
npx github:GeorgeKstr/agent-smith --help
```

### Option 3 — one-line install script

```bash
curl -fsSL https://raw.githubusercontent.com/GeorgeKstr/agent-smith/main/install.sh | bash
```

The script clones into `~/.agent-smith`, builds, and links the command globally.
Override with `AGENT_SMITH_REPO`, `AGENT_SMITH_REF`, or `AGENT_SMITH_DIR`.

### Option 4 — from source (for development)

```bash
git clone https://github.com/GeorgeKstr/agent-smith.git
cd agent-smith
npm install        # builds via the prepare script
npm link           # exposes `smith` globally
# or run directly during development:
npm run dev -- --help
```

### Publishing to the public npm registry (optional)

The package is configured to publish. To make `npm install -g agent-smith` work
for everyone, run `npm publish` from a clean checkout (the `prepare` script
builds `dist/` automatically).

## Usage

After installation the command is **`smith`** (an `agent-smith` alias is also
installed). Run it inside the project you want to work on — every command
forwards whatever arguments you pass:

```bash
smith                 # interactive Matrix-themed TUI + file watcher
smith index           # fast structural index (files, symbols, graph, tags)
smith index --summarize  # also run the slower model intelligence pass
smith status          # index + Ollama status
smith ask "where is the checkout total calculated?"
smith patch "add discount codes"          # generate + apply a patch
smith patch "add discount codes" --dry-run  # validate without applying
smith inspect src/file.ts                 # tags / summary / symbols
smith graph src/file.ts                   # import neighborhood
```

## Visual theme

Matrix / Agent Smith inspired:

- green-on-black terminal style
- falling-symbol boot background
- sunglasses ASCII badge
- index boot animation
- HUD-style panes

## Staged prompts

Use these with your coding agent:

1. `prompts/01-foundation.md`
2. `prompts/02-indexing.md`
3. `prompts/03-retrieval-patching.md`

