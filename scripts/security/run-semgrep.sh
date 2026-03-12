#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAN_ROOT="${SCAN_ROOT:-$ROOT_DIR}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/.overture/security}"
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
    "$SCAN_ROOT"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$SCAN_ROOT:/src" \
    -v "$OUTPUT_DIR:/out" \
    semgrep/semgrep:latest \
    semgrep scan --config auto --json --output /out/semgrep.json --exclude vendor /src
else
  echo "Semgrep is unavailable and docker is not installed." >&2
  exit 2
fi

echo "Semgrep report written to $OUTPUT_DIR/semgrep.json"
