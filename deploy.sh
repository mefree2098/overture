#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$MODE" in
  local)
    cp -n "$ROOT_DIR/.env.example" "$ROOT_DIR/.env" 2>/dev/null || true
    mkdir -p "$ROOT_DIR/.overture"
    HOST_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
    if [ ! -f "$HOST_CODEX_HOME/auth.json" ]; then
      echo "Docker deployment requires an existing ChatGPT-authenticated Codex login at $HOST_CODEX_HOME/auth.json." >&2
      exit 1
    fi
    if ! CODEX_HOME="$HOST_CODEX_HOME" codex login status >/dev/null 2>&1; then
      echo "The host Codex login at $HOST_CODEX_HOME is not usable. Run Codex login on the host first." >&2
      exit 1
    fi
    export OVERTURE_CODEX_AUTH_SOURCE_DIR="$HOST_CODEX_HOME"
    docker compose up --build -d
    echo "Overture is starting on http://127.0.0.1:3000"
    echo "Runtime data is bind-mounted to $ROOT_DIR/.overture"
    echo "The Docker image now bootstraps Codex CLI, Symphony dependencies, and ChatGPT-backed Codex auth automatically."
    echo "Health probe: curl http://127.0.0.1:3000/api/health"
    ;;
  jetson)
    echo "Jetson deployment notes are in infra/jetson/README.md"
    echo "Use an arm64 image build and provide OPENAI_API_KEY so the container can bootstrap Codex automatically."
    ;;
  azure)
    echo "Azure deployment assets are in infra/azure/main.bicep"
    echo "Recommended flow:"
    echo "1. az group create --name overture-rg --location eastus"
    echo "2. az deployment group create --resource-group overture-rg --template-file infra/azure/main.bicep"
    echo "3. Deploy the built container image to the created Container App"
    echo "4. Provide OPENAI_API_KEY as the container secret so Codex bootstraps on start"
    ;;
  aws)
    echo "AWS baseline assets are in infra/aws/template.yaml"
    echo "The current AWS template is a planning stub and must be replaced with a container-hosted runtime that injects OPENAI_API_KEY before live Symphony execution."
    ;;
  *)
    echo "Usage: ./deploy.sh [local|jetson|azure|aws]" >&2
    exit 1
    ;;
esac
