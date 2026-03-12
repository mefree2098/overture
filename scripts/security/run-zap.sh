#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/.overture/security}"
CONFIG_FILE="$ROOT_DIR/scripts/security/zap-rules.conf"
mkdir -p "$OUTPUT_DIR"

TARGET_URL="${ZAP_TARGET_URL:-http://127.0.0.1:3000}"
CONTAINER_TARGET_URL="$TARGET_URL"

case "$TARGET_URL" in
  http://127.0.0.1:*|http://127.0.0.1|http://localhost:*|http://localhost|https://127.0.0.1:*|https://127.0.0.1|https://localhost:*|https://localhost)
    CONTAINER_TARGET_URL="${TARGET_URL/127.0.0.1/host.docker.internal}"
    CONTAINER_TARGET_URL="${CONTAINER_TARGET_URL/localhost/host.docker.internal}"
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the ZAP baseline scan." >&2
  exit 2
fi

docker run --rm \
  --add-host host.docker.internal:host-gateway \
  -v "$OUTPUT_DIR:/zap/wrk" \
  -v "$CONFIG_FILE:/zap/rules.conf:ro" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t "$CONTAINER_TARGET_URL" \
  -c /zap/rules.conf \
  -J zap-report.json \
  -r zap-report.html

echo "ZAP reports written to $OUTPUT_DIR/zap-report.json and $OUTPUT_DIR/zap-report.html"
