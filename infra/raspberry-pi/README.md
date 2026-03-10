# Raspberry Pi deployment notes

Overture can be packaged for Raspberry Pi as a `linux/arm64` container release. Treat this as an operator deployment target with the same local-first Codex and Symphony assumptions as Jetson, but tuned for smaller hardware.

## Baseline

- Target architecture: `linux/arm64`
- Recommended hardware: Raspberry Pi 5 with 8 GB RAM
- Recommended OS: 64-bit Raspberry Pi OS Bookworm or newer
- Runtime model: standalone Next.js app, persisted `.overture` runtime state, ChatGPT-authenticated Codex CLI, and vendored Symphony execution

## Required runtime prerequisites

- Docker with `buildx`
- SSH access from the build machine to the Pi
- A usable Codex auth directory on the device, typically `~/.codex/auth.json`
- Writable persistent storage for `/app/.overture`
- A device-side `.env` file for the container launch

## Suggested deployment flow

1. On the build machine, set `OVERTURE_REMOTE_HOST` to the Pi SSH target.
2. Optionally set:
   - `OVERTURE_REMOTE_PORT`
   - `OVERTURE_REMOTE_RUNTIME_DIR`
   - `OVERTURE_REMOTE_ENV_FILE`
   - `OVERTURE_REMOTE_CODEX_DIR`
3. Run:

```bash
OVERTURE_REMOTE_HOST=pi@raspberrypi.local bash deploy.sh raspberry_pi
```

This builds an ARM64 image, transfers it to the device over SSH, loads it into Docker, and starts the container with persistent `.overture` state and mounted Codex auth.

## What remains manual on real hardware

- Hardware sizing and thermal sanity for long-running agent workloads
- Network/firewall setup if the Pi must be reachable from other devices
- Backup strategy for `.overture` state and container logs

## Operational notes

- The Pi target uses the same local-first ChatGPT Codex auth model as the local Docker deployment.
- If you intentionally need hosted API mode on the device, add `OPENAI_API_KEY` to the device `.env` file.
- Launch and deploy runs from the Overture UI will record logs and artifacts, but remote-device credentials still need to exist before those runs can succeed.
