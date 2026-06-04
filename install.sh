#!/usr/bin/env bash
#
# Agent Smith installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/GeorgeKstr/agent-smith/main/install.sh | bash
#
# Environment overrides:
#   AGENT_SMITH_REPO   GitHub "owner/repo" slug   (default: GeorgeKstr/agent-smith)
#   AGENT_SMITH_REF    git branch/tag to install  (default: main)
#   AGENT_SMITH_DIR    install location           (default: $HOME/.agent-smith)
#
set -euo pipefail

REPO="${AGENT_SMITH_REPO:-GeorgeKstr/agent-smith}"
REF="${AGENT_SMITH_REF:-main}"
INSTALL_DIR="${AGENT_SMITH_DIR:-$HOME/.agent-smith}"

err() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
info() { printf '\033[32m%s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
for bin in git node npm; do
  command -v "$bin" >/dev/null 2>&1 || { err "Missing dependency: $bin"; exit 1; }
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 is required (found $(node -v))."
  exit 1
fi

# --- fetch -------------------------------------------------------------------
info "Installing Agent Smith from $REPO@$REF into $INSTALL_DIR ..."
rm -rf "$INSTALL_DIR"
git clone --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$INSTALL_DIR"
cd "$INSTALL_DIR"

# --- build + link ------------------------------------------------------------
# `npm install` triggers the "prepare" script which compiles TypeScript to dist/.
npm install

# Expose the `smith` command globally. If system-global install fails (EACCES),
# fall back to a user-writable prefix.
if npm install -g . >/dev/null 2>&1; then
  info "Installed globally via npm."
elif npm install -g --prefix "$HOME/.local" . >/dev/null 2>&1; then
  info "Installed to user prefix at $HOME/.local."
  info "If needed, add to PATH: export PATH=\"$HOME/.local/bin:\$PATH\""
elif npm link >/dev/null 2>&1; then
  info "Linked globally via npm link."
else
  err "Could not install globally."
  err "Run it directly instead:  $INSTALL_DIR/dist/main.js"
  err "Or set a user-level npm prefix:  npm config set prefix \"\$HOME/.local\""
  exit 1
fi

info "Done. Make sure Ollama is running, then:  smith --help"
