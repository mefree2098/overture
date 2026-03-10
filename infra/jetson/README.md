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

1. On the build machine, set `OVERTURE_REMOTE_HOST` to the Jetson SSH target.
2. Optionally set:
   - `OVERTURE_REMOTE_PORT`
   - `OVERTURE_REMOTE_RUNTIME_DIR`
   - `OVERTURE_REMOTE_ENV_FILE`
   - `OVERTURE_REMOTE_CODEX_DIR`
3. Run:

```bash
OVERTURE_REMOTE_HOST=jetson@my-device.local bash deploy.sh jetson
```
4. Verify `GET /api/health` on the device.
5. Open `/settings` if you want to change planner or execution model defaults, the research provider, or the planning / agent thinking levels.
6. Create a project through the guided pipeline or the quick-path plan intake, then launch Symphony from the UI.

## What remains manual on real hardware

- Thermal and performance sanity under the intended power profile
- Any GPU-accelerated workloads you add around the current control-plane stack
- Storage and I/O resilience for long-running project histories

## Operational notes

- Project deletion is supported from the UI and `DELETE /api/projects/:projectId`; it removes SQLite records and project runtime folders.
- The deploy helper transfers the image over SSH and runs the container with persistent `.overture` state on the device.
- If you intentionally want `hosted_api` mode on Jetson, you can still extend the environment with `OPENAI_API_KEY`, but that is no longer the documented default path.
