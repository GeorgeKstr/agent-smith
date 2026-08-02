#!/usr/bin/env bash
set -e

echo "╔══════════════════════════════════════╗"
echo "║   Agent Smith v2 — Quick Install    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Find or clone the repo ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/pyproject.toml" ]; then
    REPO_DIR="$SCRIPT_DIR"
    echo "✓ Using existing repo: $REPO_DIR"
else
    REPO_DIR="$HOME/Projects/agent-smith"
    if [ -d "$REPO_DIR" ]; then
        echo "✓ Found existing clone: $REPO_DIR"
        cd "$REPO_DIR" && git pull
    else
        echo "→ Cloning into $REPO_DIR..."
        mkdir -p "$(dirname "$REPO_DIR")"
        git clone https://github.com/GeorgeKstr/agent-smith.git "$REPO_DIR"
    fi
fi

cd "$REPO_DIR"

# ── Python setup ────────────────────────────────────────
echo ""
echo "→ Setting up Python environment..."

python3 -m venv .venv 2>/dev/null || true
source .venv/bin/activate 2>/dev/null || true

pip install -e . --quiet

# ── Add ~/.local/bin to PATH if needed ──────────────────
LOCAL_BIN="$HOME/.local/bin"
if [ -f "$LOCAL_BIN/smith2" ]; then
    echo "✓ smith2 command installed at $LOCAL_BIN/smith2"
fi

if ! echo "$PATH" | grep -q "$LOCAL_BIN"; then
    echo ""
    echo "→ Adding $LOCAL_BIN to your PATH..."
    SHELL_RC=""
    if [ -n "$ZSH_VERSION" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        if [ -f "$HOME/.bashrc" ]; then
            SHELL_RC="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            SHELL_RC="$HOME/.bash_profile"
        fi
    fi
    if [ -n "$SHELL_RC" ]; then
        if ! grep -q "$LOCAL_BIN" "$SHELL_RC" 2>/dev/null; then
            echo "export PATH=\"$LOCAL_BIN:\$PATH\"" >> "$SHELL_RC"
            echo "✓ Added to $SHELL_RC"
        fi
    fi
    export PATH="$LOCAL_BIN:$PATH"
fi

# ── Verify ──────────────────────────────────────────────
echo ""
if command -v smith2 &>/dev/null; then
    echo "✅ Agent Smith v2 installed successfully!"
    echo ""
    echo "   Run it:"
    echo "     smith2          # Web UI on http://localhost:8080"
    echo "     smith2 app      # Full app with project picker"
    echo ""
    echo "   Or point it at a project:"
    echo "     cd /path/to/your/project"
    echo "     smith2"
else
    echo "⚠ smith2 not in PATH — run with full path:"
    echo "     $LOCAL_BIN/smith2"
    echo ""
    echo "   Or restart your terminal, then:"
    echo "     smith2"
fi
