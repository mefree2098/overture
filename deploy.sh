#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  local help_text="$2"
  if [ -z "${!name:-}" ]; then
    echo "$help_text" >&2
    exit 1
  fi
}

wait_for_url() {
  local url="$1"
  local timeout_seconds="${2:-180}"
  local started_at
  started_at="$(date +%s)"

  while [ $(( "$(date +%s)" - started_at )) -lt "$timeout_seconds" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  return 1
}

find_xcode_container() {
  find . -maxdepth 1 \( -name "*.xcworkspace" -o -name "*.xcodeproj" \) | head -n 1
}

run_local() {
  require_command docker
  require_command curl
  require_command codex

  cp -n "$ROOT_DIR/.env.example" "$ROOT_DIR/.env" 2>/dev/null || true
  mkdir -p "$ROOT_DIR/.overture"

  local host_codex_home="${CODEX_HOME:-$HOME/.codex}"
  if [ ! -f "$host_codex_home/auth.json" ]; then
    echo "Docker deployment requires an existing ChatGPT-authenticated Codex login at $host_codex_home/auth.json." >&2
    exit 1
  fi

  if ! CODEX_HOME="$host_codex_home" codex login status >/dev/null 2>&1; then
    echo "The host Codex login at $host_codex_home is not usable. Run Codex login on the host first." >&2
    exit 1
  fi

  export OVERTURE_CODEX_AUTH_SOURCE_DIR="$host_codex_home"
  docker compose up --build -d --force-recreate

  if ! wait_for_url "http://127.0.0.1:3000/api/health" 240; then
    echo "Overture did not become healthy on http://127.0.0.1:3000 within the expected time." >&2
    exit 1
  fi

  echo "Overture is healthy on http://127.0.0.1:3000"
  echo "Project artifacts and runtime files stay under $ROOT_DIR/.overture"
  echo "SQLite data and active Symphony workspaces live in Docker-managed volumes for stability."
  echo "The Docker image bootstraps Codex CLI, Symphony dependencies, and ChatGPT-backed Codex auth automatically."
  echo "Project and model defaults can be adjusted in the UI at http://127.0.0.1:3000/settings"
  echo "Health probe: curl http://127.0.0.1:3000/api/health"
}

run_arm_device_release() {
  local mode="$1"
  require_command docker
  require_command ssh
  require_command scp
  require_env OVERTURE_REMOTE_HOST "Set OVERTURE_REMOTE_HOST to the SSH target for the ${mode} deployment."

  local image="${OVERTURE_IMAGE:-overture:${mode}}"
  local remote_host="${OVERTURE_REMOTE_HOST}"
  local remote_port="${OVERTURE_REMOTE_PORT:-3000}"
  local remote_runtime_dir="${OVERTURE_REMOTE_RUNTIME_DIR:-\$HOME/overture-runtime}"
  local remote_env_file="${OVERTURE_REMOTE_ENV_FILE:-${remote_runtime_dir}/.env}"
  local remote_codex_dir="${OVERTURE_REMOTE_CODEX_DIR:-\$HOME/.codex}"
  local archive_path
  archive_path="$(mktemp -t overture-image.XXXXXX.tar)"
  trap 'rm -f "$archive_path"' EXIT

  docker buildx build --platform linux/arm64 -t "$image" --load "$ROOT_DIR"
  docker save "$image" >"$archive_path"
  scp "$archive_path" "${remote_host}:/tmp/overture-image.tar"

  ssh "$remote_host" "
    set -euo pipefail
    mkdir -p ${remote_runtime_dir}/.overture
    docker load -i /tmp/overture-image.tar
    docker rm -f overture >/dev/null 2>&1 || true
    docker run -d \
      --name overture \
      --restart unless-stopped \
      -p ${remote_port}:3000 \
      --env-file ${remote_env_file} \
      -e OVERTURE_BIND_HOST=0.0.0.0 \
      -v ${remote_runtime_dir}/.overture:/app/.overture \
      -v ${remote_codex_dir}:/codex-host:ro \
      ${image}
  "

  ssh "$remote_host" "curl -fsS http://127.0.0.1:${remote_port}/api/health >/dev/null"
  echo "Overture is running on ${mode} target ${remote_host}:${remote_port}"
}

run_azure() {
  require_command az
  require_env AZURE_RESOURCE_GROUP "Set AZURE_RESOURCE_GROUP before running the Azure deployment."

  local location="${AZURE_LOCATION:-eastus}"
  local environment_name="${AZURE_ENVIRONMENT_NAME:-overture-env}"
  local app_name="${AZURE_APP_NAME:-overture-control-plane}"
  local image="${OVERTURE_IMAGE:-ghcr.io/example/overture:latest}"

  az group create --name "$AZURE_RESOURCE_GROUP" --location "$location" >/dev/null
  az deployment group create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --template-file "$ROOT_DIR/infra/azure/main.bicep" \
    --parameters \
      location="$location" \
      environmentName="$environment_name" \
      appName="$app_name" \
      image="$image" >/dev/null

  local fqdn
  fqdn="$(az containerapp show --resource-group "$AZURE_RESOURCE_GROUP" --name "$app_name" --query properties.configuration.ingress.fqdn -o tsv)"
  if [ -n "$fqdn" ]; then
    echo "Azure deployment is available at https://${fqdn}"
  else
    echo "Azure deployment completed. Inspect the container app in the Azure portal for ingress details."
  fi
}

run_aws() {
  require_command aws
  require_env AWS_STACK_NAME "Set AWS_STACK_NAME before running the AWS deployment."

  aws cloudformation deploy \
    --stack-name "$AWS_STACK_NAME" \
    --template-file "$ROOT_DIR/infra/aws/template.yaml" \
    --capabilities CAPABILITY_NAMED_IAM

  echo "AWS baseline deployment completed for stack ${AWS_STACK_NAME}."
}

run_ios_prep() {
  require_command xcodebuild

  local mode="$1"
  local xcode_container
  xcode_container="$(find_xcode_container)"

  if [ -z "$xcode_container" ]; then
    echo "No .xcodeproj or .xcworkspace was found in $(pwd)." >&2
    exit 1
  fi

  local scheme="${IOS_SCHEME:-$(basename "$xcode_container")}"
  scheme="${scheme%.*}"
  local archive_path="${IOS_ARCHIVE_PATH:-$(pwd)/build/${scheme}.xcarchive}"
  mkdir -p "$(dirname "$archive_path")"

  if [ "${xcode_container##*.}" = "xcworkspace" ]; then
    xcodebuild -workspace "$xcode_container" -scheme "$scheme" -configuration Release -archivePath "$archive_path" archive
  else
    xcodebuild -project "$xcode_container" -scheme "$scheme" -configuration Release -archivePath "$archive_path" archive
  fi

  echo "Created archive at $archive_path"
  if [ "$mode" = "ios_app_store" ]; then
    echo "Archive and submission prep completed. Final App Store release still requires operator confirmation."
  else
    echo "Archive completed for TestFlight upload prep."
  fi
}

case "$MODE" in
  local)
    run_local
    ;;
  jetson)
    run_arm_device_release jetson
    ;;
  raspberry_pi)
    run_arm_device_release raspberry_pi
    ;;
  azure)
    run_azure
    ;;
  aws)
    run_aws
    ;;
  ios_testflight)
    run_ios_prep ios_testflight
    ;;
  ios_app_store)
    run_ios_prep ios_app_store
    ;;
  *)
    echo "Usage: ./deploy.sh [local|jetson|raspberry_pi|azure|aws|ios_testflight|ios_app_store]" >&2
    exit 1
    ;;
esac
