# Jetson Orin Nano Super packaging plan

This repository ships a local-first control plane, so Jetson support focuses on packaging and operator guidance rather than hardware-bound GPU validation.

## Baseline

- Target architecture: `linux/arm64`
- Recommended NVIDIA stack: JetPack 6.1 or newer for Orin Nano Super
- Build container images with `docker buildx build --platform linux/arm64`

## What can be validated without hardware

- ARM64 image build success
- Node dependency install
- Unit and lint passes under emulation

## What remains manual on real hardware

- GPU acceleration or CUDA-linked workloads
- Camera / GPIO / device I/O
- Performance sanity under MAXN or production power profile

## Suggested deployment flow

1. Build and push an ARM64 image.
2. Copy `.env` with project-specific secrets to the device.
3. Run `docker compose up -d`.
4. Hit `/api/health` and record the result as deployment evidence.
