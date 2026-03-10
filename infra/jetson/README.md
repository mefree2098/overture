# Jetson deployment notes

Overture can be packaged for Jetson as an `arm64` container, and the image now installs the Codex CLI plus the Symphony runtime dependencies automatically. Treat Jetson as an operator deployment target, not just a static UI host.

## Baseline

- Target architecture: `linux/arm64`
- Recommended NVIDIA stack: JetPack 6.1 or newer
- Runtime model: standalone Next.js app plus local `.overture` state, real Codex-backed planning, ChatGPT-authenticated Codex CLI, and vendored Symphony execution

## Required runtime prerequisites

- Docker with `buildx`
- Node 22 compatibility in the base image
- A usable Codex auth directory on the device, typically `~/.codex/auth.json`
- Writable persistent storage for `/app/.overture`

## Suggested deployment flow

1. Build an ARM64 image: `docker buildx build --platform linux/arm64 -t overture:jetson .`
2. Copy `.env` to the device and set at least `PORT` and `OVERTURE_BIND_HOST=0.0.0.0`.
3. Mount persistent state into `/app/.overture` and mount the device auth directory into `/codex-host`.
4. Start the app:

```bash
docker run --rm -p 3000:3000 \
  --env-file .env \
  -v "$(pwd)/.overture:/app/.overture" \
  -v "$HOME/.codex:/codex-host:ro" \
  overture:jetson
```
5. Verify `GET /api/health`.
6. Open `/settings` if you want to change planner or execution model defaults, or the planning / agent thinking levels.
7. Seed or create a project, then launch Symphony with `npm run runner -- <project-id>`.

## What remains manual on real hardware

- Thermal and performance sanity under the intended power profile
- Any GPU-accelerated workloads you add around the current control-plane stack
- Storage and I/O resilience for long-running project histories

## Operational notes

- Project deletion is supported from the UI and `DELETE /api/projects/:projectId`; it removes SQLite records and project runtime folders.
- Docker bind mounting `.overture` keeps Jetson runtime data visible to host-side troubleshooting and backup workflows.
- If you intentionally want `hosted_api` mode on Jetson, you can still extend the environment with `OPENAI_API_KEY`, but that is no longer the documented default path.
