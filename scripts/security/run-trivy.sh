#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAN_ROOT="${SCAN_ROOT:-$ROOT_DIR}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/.overture/security}"
mkdir -p "$OUTPUT_DIR"

if command -v trivy >/dev/null 2>&1; then
  trivy fs \
    --scanners vuln,secret,misconfig \
    --skip-dirs "$SCAN_ROOT/node_modules" \
    --skip-dirs "$SCAN_ROOT/.next" \
    --skip-dirs "$SCAN_ROOT/.overture" \
    --skip-dirs "$SCAN_ROOT/.overture-e2e" \
    --skip-dirs "$SCAN_ROOT/vendor" \
    --format json \
    --output "$OUTPUT_DIR/trivy.json" \
    "$SCAN_ROOT"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$SCAN_ROOT:/src" \
    -v "$OUTPUT_DIR:/out" \
    aquasec/trivy:latest \
    fs \
    --scanners vuln,secret,misconfig \
    --skip-dirs /src/node_modules \
    --skip-dirs /src/.next \
    --skip-dirs /src/.overture \
    --skip-dirs /src/.overture-e2e \
    --skip-dirs /src/vendor \
    --format json \
    --output /out/trivy.json \
    /src
else
  echo "Trivy is unavailable and docker is not installed." >&2
  exit 2
fi

echo "Trivy report written to $OUTPUT_DIR/trivy.json"
