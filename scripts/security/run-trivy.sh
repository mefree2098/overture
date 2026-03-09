#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/.overture/security"
mkdir -p "$OUTPUT_DIR"

if command -v trivy >/dev/null 2>&1; then
  trivy fs \
    --scanners vuln,secret,misconfig \
    --skip-dirs "$ROOT_DIR/node_modules" \
    --skip-dirs "$ROOT_DIR/.next" \
    --skip-dirs "$ROOT_DIR/.overture" \
    --skip-dirs "$ROOT_DIR/.overture-e2e" \
    --skip-dirs "$ROOT_DIR/vendor" \
    --format json \
    --output "$OUTPUT_DIR/trivy.json" \
    "$ROOT_DIR"
else
  docker run --rm \
    -v "$ROOT_DIR:/src" \
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
fi

echo "Trivy report written to $OUTPUT_DIR/trivy.json"
