#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/.overture/security"
mkdir -p "$OUTPUT_DIR"

if command -v semgrep >/dev/null 2>&1; then
  semgrep scan \
    --config auto \
    --json \
    --output "$OUTPUT_DIR/semgrep.json" \
    --exclude node_modules \
    --exclude .next \
    --exclude .overture \
    --exclude vendor \
    "$ROOT_DIR"
else
  docker run --rm \
    -v "$ROOT_DIR:/src" \
    -v "$OUTPUT_DIR:/out" \
    semgrep/semgrep:latest \
    semgrep scan --config auto --json --output /out/semgrep.json --exclude vendor /src
fi

echo "Semgrep report written to $OUTPUT_DIR/semgrep.json"
