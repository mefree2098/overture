# Azure deployment

The `azure` target in [deploy.sh](/Users/mattfreestone/Documents/Overture/deploy.sh) provisions a single Ubuntu VM, publishes the container image to Azure Container Registry, and starts Overture with persistent runtime state under `/opt/overture/runtime`.

## Required environment

- `AZURE_RESOURCE_GROUP`
- `OPENAI_API_KEY`

## Optional environment

- `AZURE_LOCATION` default `eastus`
- `AZURE_VM_NAME` default `overture-control-plane`
- `AZURE_VM_ADMIN_USERNAME` default `overture`
- `AZURE_VM_SIZE` default `Standard_D4s_v5`
- `AZURE_APP_ALLOWED_CIDR` default `0.0.0.0/0`
- `AZURE_SSH_ALLOWED_CIDR` default closed
- `AZURE_SSH_PUBLIC_KEY_FILE` default `~/.ssh/id_ed25519.pub` or `~/.ssh/id_rsa.pub`
- `AZURE_ACR_NAME` auto-generated from the subscription + VM name
- `AZURE_IMAGE_REPOSITORY` default `overture-control-plane`
- `OVERTURE_IMAGE_TAG` default current UTC timestamp

## One-command flow

```bash
AZURE_RESOURCE_GROUP=my-overture-rg OPENAI_API_KEY=sk-live-... bash deploy.sh azure
```

What the script does:

1. Creates or updates the resource group.
2. Creates or reuses an Azure Container Registry.
3. Provisions the VM, VNet, NSG, NIC, and public IP from [main.bicep](/Users/mattfreestone/Documents/Overture/infra/azure/main.bicep).
4. Builds the container image in ACR with `az acr build`.
5. Uses `az vm run-command invoke` to pull the image and run Overture on the VM.
6. Waits for `GET /api/health` before exiting.

## Runtime notes

- The cloud deployment forces `OVERTURE_DEFAULT_EXECUTION_MODE=hosted_api`.
- The container still uses SQLite and `.overture` state, so this is intentionally a single-instance deployment.
- Port `3000` is exposed directly. Add a reverse proxy or managed TLS layer if you need HTTPS.
