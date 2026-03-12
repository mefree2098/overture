#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-local}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_HELPER="$ROOT_DIR/scripts/deploy/run-cloud-container.sh"

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

log() {
  printf '[overture deploy] %s\n' "$*"
}

usage() {
  cat <<'EOF' >&2
Usage: ./deploy.sh [local|jetson|raspberry_pi|azure|aws|ios_testflight|ios_app_store]

Cloud deployment prerequisites:
- Azure: az CLI login plus OPENAI_API_KEY
- AWS: aws CLI credentials, Docker buildx, and OPENAI_API_KEY

Cloud deployments publish the current repo as a single-instance control plane and inject
hosted API Codex auth through OPENAI_API_KEY.
EOF
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

pick_first_existing() {
  local candidate
  for candidate in "$@"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

find_xcode_container() {
  find . -maxdepth 1 \( -name "*.xcworkspace" -o -name "*.xcodeproj" \) | head -n 1
}

slug_compact() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9'
}

base64_compact() {
  base64 | tr -d '\n'
}

build_container_env_file() {
  local public_origin="$1"

  cat <<EOF
PORT=3000
OVERTURE_BIND_HOST=0.0.0.0
OVERTURE_ROOT=/app
OPENAI_API_KEY=${OPENAI_API_KEY}
OVERTURE_ORIGIN=${public_origin}
OVERTURE_INTERNAL_ORIGIN=http://127.0.0.1:3000
OVERTURE_DEFAULT_EXECUTION_MODE=hosted_api
EOF

  local passthrough
  for passthrough in \
    CONTROL_PLANE_TRACKER_TOKEN \
    SYMPHONY_TRACKER_TOKEN \
    NEXT_PUBLIC_DEFAULT_REPO \
    OVERTURE_DEFAULT_REPO_SOURCE \
    OVERTURE_DEFAULT_RESEARCH_PROVIDER \
    OVERTURE_SYMPHONY_PORT_BASE
  do
    if [ -n "${!passthrough:-}" ]; then
      printf '%s=%s\n' "$passthrough" "${!passthrough}"
    fi
  done
}

build_remote_cloud_script() {
  local image="$1"
  local registry_server="$2"
  local registry_username="$3"
  local registry_password_b64="$4"
  local env_b64="$5"

  {
    printf '#!/usr/bin/env bash\n'
    printf 'export OVERTURE_IMAGE=%q\n' "$image"
    printf 'export OVERTURE_REGISTRY_SERVER=%q\n' "$registry_server"
    printf 'export OVERTURE_REGISTRY_USERNAME=%q\n' "$registry_username"
    printf 'export OVERTURE_REGISTRY_PASSWORD_B64=%q\n' "$registry_password_b64"
    printf 'export OVERTURE_ENV_B64=%q\n' "$env_b64"
    tail -n +2 "$CLOUD_HELPER"
  }
}

print_cloud_summary() {
  local label="$1"
  local app_url="$2"
  local health_url="$3"

  echo "${label} deployment completed."
  echo "App URL: ${app_url}"
  echo "Health URL: ${health_url}"
  echo "The cloud deployment uses hosted API Codex auth because OPENAI_API_KEY was injected into the container."
  echo "Rerun this same deploy.sh target to publish a fresh image."
  echo "OVERTURE_APP_URL=${app_url}"
  echo "OVERTURE_HEALTHCHECK_URL=${health_url}"
}

require_docker_buildx() {
  require_command docker

  if ! docker buildx version >/dev/null 2>&1; then
    echo "Docker buildx is required for this deployment." >&2
    exit 1
  fi
}

resolve_azure_ssh_public_key() {
  local configured="${AZURE_SSH_PUBLIC_KEY_FILE:-}"

  if [ -n "$configured" ] && [ -f "$configured" ]; then
    printf '%s\n' "$configured"
    return 0
  fi

  pick_first_existing "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_rsa.pub"
}

default_azure_registry_name() {
  local seed hash base
  seed="$(az account show --query id -o tsv)"
  hash="$(printf '%s' "$seed" | cksum | awk '{print $1}' | cut -c1-6)"
  base="$(slug_compact "${AZURE_RESOURCE_GROUP:-overture}${AZURE_VM_NAME:-overture}")"
  if [ -z "$base" ]; then
    base="overture"
  fi
  printf 'ov%s%s\n' "${base:0:20}" "$hash" | cut -c1-50
}

wait_for_azure_vm_agent() {
  local resource_group="$1"
  local vm_name="$2"
  local attempts=40

  while [ "$attempts" -gt 0 ]; do
    if az vm run-command invoke \
      --resource-group "$resource_group" \
      --name "$vm_name" \
      --command-id RunShellScript \
      --scripts "echo ready" >/dev/null 2>&1; then
      return 0
    fi

    attempts=$((attempts - 1))
    sleep 15
  done

  return 1
}

wait_for_aws_ssm_instance() {
  local region="$1"
  local instance_id="$2"
  local attempts=40
  local status=""

  while [ "$attempts" -gt 0 ]; do
    status="$(aws ssm describe-instance-information \
      --region "$region" \
      --filters "Key=InstanceIds,Values=${instance_id}" \
      --query 'InstanceInformationList[0].PingStatus' \
      -o text 2>/dev/null || true)"

    if [ "$status" = "Online" ]; then
      return 0
    fi

    attempts=$((attempts - 1))
    sleep 15
  done

  return 1
}

wait_for_aws_command() {
  local region="$1"
  local command_id="$2"
  local instance_id="$3"
  local attempts=90
  local status=""

  while [ "$attempts" -gt 0 ]; do
    status="$(aws ssm get-command-invocation \
      --region "$region" \
      --command-id "$command_id" \
      --instance-id "$instance_id" \
      --query 'Status' \
      -o text 2>/dev/null || true)"

    case "$status" in
      Success|Failed|Cancelled|TimedOut|Cancelling)
        printf '%s\n' "$status"
        return 0
        ;;
    esac

    attempts=$((attempts - 1))
    sleep 10
  done

  printf 'TimedOut\n'
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
  echo "OVERTURE_APP_URL=http://127.0.0.1:3000"
  echo "OVERTURE_HEALTHCHECK_URL=http://127.0.0.1:3000/api/health"
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
  echo "OVERTURE_APP_URL=http://${remote_host}:${remote_port}"
  echo "OVERTURE_HEALTHCHECK_URL=http://${remote_host}:${remote_port}/api/health"
}

run_azure() {
  require_command az
  require_command curl
  require_env AZURE_RESOURCE_GROUP "Set AZURE_RESOURCE_GROUP before running the Azure deployment."
  require_env OPENAI_API_KEY "Set OPENAI_API_KEY before running the Azure deployment. Cloud deployments use hosted API Codex auth."

  local location="${AZURE_LOCATION:-eastus}"
  local vm_name="${AZURE_VM_NAME:-overture-control-plane}"
  local admin_username="${AZURE_VM_ADMIN_USERNAME:-overture}"
  local vm_size="${AZURE_VM_SIZE:-Standard_D4s_v5}"
  local app_allowed_cidr="${AZURE_APP_ALLOWED_CIDR:-0.0.0.0/0}"
  local ssh_allowed_cidr="${AZURE_SSH_ALLOWED_CIDR:-}"
  local ssh_public_key_file
  ssh_public_key_file="$(resolve_azure_ssh_public_key || true)"
  if [ -z "$ssh_public_key_file" ]; then
    echo "Azure deployment requires a local SSH public key. Set AZURE_SSH_PUBLIC_KEY_FILE or create ~/.ssh/id_ed25519.pub." >&2
    exit 1
  fi

  local ssh_public_key
  ssh_public_key="$(cat "$ssh_public_key_file")"
  local registry_name="${AZURE_ACR_NAME:-$(default_azure_registry_name)}"
  local image_repository="${AZURE_IMAGE_REPOSITORY:-overture-control-plane}"
  local image_tag="${OVERTURE_IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"

  az account show >/dev/null
  az group create --name "$AZURE_RESOURCE_GROUP" --location "$location" >/dev/null

  if ! az acr show --resource-group "$AZURE_RESOURCE_GROUP" --name "$registry_name" >/dev/null 2>&1; then
    az acr create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$registry_name" \
      --sku Basic \
      --admin-enabled true >/dev/null
  fi

  az deployment group create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --template-file "$ROOT_DIR/infra/azure/main.bicep" \
    --parameters \
      location="$location" \
      vmName="$vm_name" \
      adminUsername="$admin_username" \
      sshPublicKey="$ssh_public_key" \
      vmSize="$vm_size" \
      appAllowedCidr="$app_allowed_cidr" \
      sshAllowedCidr="$ssh_allowed_cidr" >/dev/null

  log "Building and publishing the Azure image with ACR Tasks..."
  az acr build \
    --registry "$registry_name" \
    --image "${image_repository}:${image_tag}" \
    --platform linux/amd64 \
    "$ROOT_DIR" >/dev/null

  local acr_login_server acr_username acr_password image public_ip app_url health_url
  acr_login_server="$(az acr show --resource-group "$AZURE_RESOURCE_GROUP" --name "$registry_name" --query loginServer -o tsv)"
  acr_username="$(az acr credential show --resource-group "$AZURE_RESOURCE_GROUP" --name "$registry_name" --query username -o tsv)"
  acr_password="$(az acr credential show --resource-group "$AZURE_RESOURCE_GROUP" --name "$registry_name" --query 'passwords[0].value' -o tsv)"
  image="${acr_login_server}/${image_repository}:${image_tag}"
  public_ip="$(az vm list-ip-addresses --resource-group "$AZURE_RESOURCE_GROUP" --name "$vm_name" --query '[0].virtualMachine.network.publicIpAddresses[0].ipAddress' -o tsv)"

  if [ -z "$public_ip" ]; then
    echo "Azure deployment succeeded, but the VM public IP could not be resolved." >&2
    exit 1
  fi

  app_url="http://${public_ip}:3000"
  health_url="${app_url}/api/health"

  log "Waiting for the Azure VM agent to accept remote commands..."
  if ! wait_for_azure_vm_agent "$AZURE_RESOURCE_GROUP" "$vm_name"; then
    echo "The Azure VM was created, but run-command never became ready." >&2
    exit 1
  fi

  local remote_script env_b64 password_b64
  remote_script="$(mktemp)"
  env_b64="$(build_container_env_file "$app_url" | base64_compact)"
  password_b64="$(printf '%s' "$acr_password" | base64_compact)"
  build_remote_cloud_script "$image" "$acr_login_server" "$acr_username" "$password_b64" "$env_b64" >"$remote_script"

  az vm run-command invoke \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$vm_name" \
    --command-id RunShellScript \
    --scripts "$(cat "$remote_script")" >/dev/null

  if ! wait_for_url "$health_url" 420; then
    echo "Azure deployment completed, but ${health_url} never became healthy." >&2
    exit 1
  fi

  print_cloud_summary "Azure" "$app_url" "$health_url"
}

run_aws() {
  require_command aws
  require_command curl
  require_docker_buildx
  require_env OPENAI_API_KEY "Set OPENAI_API_KEY before running the AWS deployment. Cloud deployments use hosted API Codex auth."

  local region="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
  if [ -z "$region" ]; then
    echo "AWS deployment requires AWS_REGION or a configured default region." >&2
    exit 1
  fi

  local stack_name="${AWS_STACK_NAME:-overture-control-plane}"
  local instance_type="${AWS_INSTANCE_TYPE:-t3.xlarge}"
  local app_allowed_cidr="${AWS_APP_ALLOWED_CIDR:-0.0.0.0/0}"
  local repository_name="${AWS_ECR_REPOSITORY:-overture-control-plane}"
  local image_tag="${OVERTURE_IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"

  local account_id registry image instance_id public_ip app_url health_url
  account_id="$(aws sts get-caller-identity --region "$region" --query Account -o text)"
  registry="${account_id}.dkr.ecr.${region}.amazonaws.com"

  if ! aws ecr describe-repositories --region "$region" --repository-names "$repository_name" >/dev/null 2>&1; then
    aws ecr create-repository --region "$region" --repository-name "$repository_name" >/dev/null
  fi

  image="${registry}/${repository_name}:${image_tag}"

  log "Building and publishing the AWS image to ECR..."
  aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry" >/dev/null
  docker buildx build --platform linux/amd64 -t "$image" --push "$ROOT_DIR"

  aws cloudformation deploy \
    --region "$region" \
    --stack-name "$stack_name" \
    --template-file "$ROOT_DIR/infra/aws/template.yaml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
      InstanceType="$instance_type" \
      AppAllowedCidr="$app_allowed_cidr" >/dev/null

  instance_id="$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack_name" --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' -o text)"
  public_ip="$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack_name" --query 'Stacks[0].Outputs[?OutputKey==`PublicIp`].OutputValue' -o text)"

  if [ -z "$instance_id" ] || [ -z "$public_ip" ]; then
    echo "AWS deployment succeeded, but the instance outputs could not be resolved." >&2
    exit 1
  fi

  app_url="http://${public_ip}:3000"
  health_url="${app_url}/api/health"

  log "Waiting for the EC2 instance checks and SSM agent..."
  aws ec2 wait instance-status-ok --region "$region" --instance-ids "$instance_id"
  if ! wait_for_aws_ssm_instance "$region" "$instance_id"; then
    echo "The EC2 instance became reachable, but AWS Systems Manager did not come online." >&2
    exit 1
  fi

  local env_b64 password_b64 remote_script script_b64 params_file command_id command_status
  env_b64="$(build_container_env_file "$app_url" | base64_compact)"
  password_b64="$(aws ecr get-login-password --region "$region" | base64_compact)"
  remote_script="$(mktemp)"
  build_remote_cloud_script "$image" "$registry" "AWS" "$password_b64" "$env_b64" >"$remote_script"
  script_b64="$(base64_compact <"$remote_script")"
  params_file="$(mktemp)"

  cat >"$params_file" <<EOF
{
  "commands": [
    "set -euo pipefail",
    "printf '%s' '${script_b64}' | base64 -d >/tmp/overture-cloud-deploy.sh",
    "chmod +x /tmp/overture-cloud-deploy.sh",
    "/tmp/overture-cloud-deploy.sh"
  ]
}
EOF

  command_id="$(aws ssm send-command \
    --region "$region" \
    --document-name AWS-RunShellScript \
    --instance-ids "$instance_id" \
    --comment "Deploy Overture" \
    --parameters "file://${params_file}" \
    --query 'Command.CommandId' \
    -o text)"

  command_status="$(wait_for_aws_command "$region" "$command_id" "$instance_id")"
  if [ "$command_status" != "Success" ]; then
    aws ssm get-command-invocation \
      --region "$region" \
      --command-id "$command_id" \
      --instance-id "$instance_id" \
      --query '{Status:Status,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
      -o json >&2
    exit 1
  fi

  if ! wait_for_url "$health_url" 420; then
    echo "AWS deployment completed, but ${health_url} never became healthy." >&2
    exit 1
  fi

  print_cloud_summary "AWS" "$app_url" "$health_url"
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
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
