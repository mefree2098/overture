# Jetson deployment notes

Overture can be packaged for Jetson as an `arm64` container, and the image now installs the Codex CLI plus the Symphony runtime dependencies automatically. Treat Jetson as an operator deployment target, not just a static UI host.

## Baseline

- Target architecture: `linux/arm64`
- Recommended NVIDIA stack: JetPack 6.1 or newer
- Runtime model: standalone Next.js app plus local `.overture` state, real Codex-backed planning, default `hosted_api` authentication via `OPENAI_API_KEY`, and vendored Symphony execution

## Required runtime prerequisites

- Docker with `buildx`
- Node 22 compatibility in the base image
- `OPENAI_API_KEY` so the container can use hosted Codex auth on first start
- Writable persistent storage for `/app/.overture`

## Suggested deployment flow

1. Build an ARM64 image: `docker buildx build --platform linux/arm64 -t overture:jetson .`
2. Copy `.env` to the device and set at least `PORT`, `OVERTURE_BIND_HOST=0.0.0.0`, and `OPENAI_API_KEY`.
3. Mount persistent state into `/app/.overture`.
4. Start the app: `docker run --rm -p 3000:3000 --env-file .env -v $(pwd)/.overture:/app/.overture overture:jetson`
5. Verify `GET /api/health`.
6. Open `/settings` if you want to change planner or execution model defaults.
7. Seed or create a project, then launch Symphony with `npm run runner -- <project-id>`.

## What remains manual on real hardware

- Thermal and performance sanity under the intended power profile
- Any GPU-accelerated workloads you add around the current control-plane stack
- Storage and I/O resilience for long-running project histories

## Operational notes

- Project deletion is supported from the UI and `DELETE /api/projects/:projectId`; it removes SQLite records and project runtime folders.
- Docker bind mounting `.overture` keeps Jetson runtime data visible to host-side troubleshooting and backup workflows.
