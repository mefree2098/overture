#!/bin/sh
set -eu

export PORT="${PORT:-3000}"
export OVERTURE_BIND_HOST="${OVERTURE_BIND_HOST:-0.0.0.0}"
export HOSTNAME="$OVERTURE_BIND_HOST"
export OVERTURE_ROOT="${OVERTURE_ROOT:-/app}"
export CODEX_HOME="${CODEX_HOME:-$OVERTURE_ROOT/.overture/codex-home}"
export OVERTURE_CODEX_AUTH_SOURCE="${OVERTURE_CODEX_AUTH_SOURCE:-/codex-host/auth.json}"
export OVERTURE_HOST_DATA_SOURCE="${OVERTURE_HOST_DATA_SOURCE:-/app/.overture-host-data}"

DATA_DIR="${OVERTURE_ROOT}/.overture/data"
WORKSPACES_DIR="${OVERTURE_ROOT}/.overture/workspaces"

mkdir -p "$CODEX_HOME" "$DATA_DIR" "$WORKSPACES_DIR"

if [ ! -f "$DATA_DIR/overture.db" ] && [ -f "$OVERTURE_HOST_DATA_SOURCE/overture.db" ]; then
  echo "Migrating existing Overture SQLite state into the Docker data volume..."
  cp "$OVERTURE_HOST_DATA_SOURCE"/overture.db* "$DATA_DIR"/ 2>/dev/null || true
fi

if [ -f "$OVERTURE_CODEX_AUTH_SOURCE" ]; then
  cp "$OVERTURE_CODEX_AUTH_SOURCE" "$CODEX_HOME/auth.json"
fi

chown -R node:node "$CODEX_HOME" "$DATA_DIR" "$WORKSPACES_DIR" 2>/dev/null || true

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed in the container image." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is not installed in the container image." >&2
  exit 1
fi

if [ -n "${OPENAI_API_KEY:-}" ]; then
  AUTH_TEMP_FILE="$(mktemp)"
  printf '%s\n' "$OPENAI_API_KEY" > "$AUTH_TEMP_FILE"
  chown node:node "$AUTH_TEMP_FILE" 2>/dev/null || true
  su -p node -s /bin/sh -c "cat '$AUTH_TEMP_FILE' | codex login --with-api-key >/dev/null"
  rm -f "$AUTH_TEMP_FILE"
fi

if ! su -p node -s /bin/sh -c "codex login status >/dev/null 2>&1"; then
  echo "Codex is not authenticated. Provide host ChatGPT Codex auth or OPENAI_API_KEY before starting the container." >&2
  exit 1
fi

exec su -p node -s /bin/sh -c "exec node .next/standalone/server.js"
