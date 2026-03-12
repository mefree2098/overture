#!/usr/bin/env bash
set -euo pipefail

if [ -z "${OVERTURE_IMAGE:-}" ]; then
  echo "OVERTURE_IMAGE is required." >&2
  exit 1
fi

if [ -z "${OVERTURE_REGISTRY_SERVER:-}" ]; then
  echo "OVERTURE_REGISTRY_SERVER is required." >&2
  exit 1
fi

if [ -z "${OVERTURE_REGISTRY_USERNAME:-}" ]; then
  echo "OVERTURE_REGISTRY_USERNAME is required." >&2
  exit 1
fi

if [ -z "${OVERTURE_REGISTRY_PASSWORD_B64:-}" ]; then
  echo "OVERTURE_REGISTRY_PASSWORD_B64 is required." >&2
  exit 1
fi

if [ -z "${OVERTURE_ENV_B64:-}" ]; then
  echo "OVERTURE_ENV_B64 is required." >&2
  exit 1
fi

mkdir -p /opt/overture/runtime
printf '%s' "$OVERTURE_ENV_B64" | base64 -d >/opt/overture/overture.env
printf '%s' "$OVERTURE_REGISTRY_PASSWORD_B64" | base64 -d | docker login "$OVERTURE_REGISTRY_SERVER" --username "$OVERTURE_REGISTRY_USERNAME" --password-stdin
docker pull "$OVERTURE_IMAGE"
docker rm -f overture >/dev/null 2>&1 || true
docker run -d \
  --name overture \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file /opt/overture/overture.env \
  -v /opt/overture/runtime:/app/.overture \
  "$OVERTURE_IMAGE"
docker ps --filter name=overture
