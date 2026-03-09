#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$MODE" in
  local)
    cp -n "$ROOT_DIR/.env.example" "$ROOT_DIR/.env" 2>/dev/null || true
    docker compose up --build -d
    echo "Overture is starting on http://127.0.0.1:3000"
    ;;
  azure)
    echo "Azure deployment assets are in infra/azure/main.bicep"
    echo "Recommended flow:"
    echo "1. az group create --name overture-rg --location eastus"
    echo "2. az deployment group create --resource-group overture-rg --template-file infra/azure/main.bicep"
    echo "3. Deploy the built container image to the created Container App"
    ;;
  *)
    echo "Usage: ./deploy.sh [local|azure]" >&2
    exit 1
    ;;
esac
