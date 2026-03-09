#!/bin/sh
set -eu

export PORT="${PORT:-3000}"
export OVERTURE_BIND_HOST="${OVERTURE_BIND_HOST:-0.0.0.0}"
export HOSTNAME="$OVERTURE_BIND_HOST"
export OVERTURE_ROOT="${OVERTURE_ROOT:-/app}"
export CODEX_HOME="${CODEX_HOME:-$OVERTURE_ROOT/.overture/codex-home}"
export OVERTURE_CODEX_AUTH_SOURCE="${OVERTURE_CODEX_AUTH_SOURCE:-/codex-host/auth.json}"

mkdir -p "$CODEX_HOME"

if [ -f "$OVERTURE_CODEX_AUTH_SOURCE" ]; then
  cp "$OVERTURE_CODEX_AUTH_SOURCE" "$CODEX_HOME/auth.json"
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed in the container image." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is not installed in the container image." >&2
  exit 1
fi

if [ -n "${OPENAI_API_KEY:-}" ]; then
  printf '%s\n' "$OPENAI_API_KEY" | codex login --with-api-key >/dev/null
fi

if ! codex login status >/dev/null 2>&1; then
  echo "Codex is not authenticated. Provide host ChatGPT Codex auth or OPENAI_API_KEY before starting the container." >&2
  exit 1
fi

exec node .next/standalone/server.js
