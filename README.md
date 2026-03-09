<p align="center">
  <img src="./icon.png" alt="Overture logo" width="320" />
</p>

# Overture

Overture is a local-first AI delivery control plane. It takes a deep-research markdown blueprint, runs a real Codex planning pass to turn that document into milestones, epics, and execution tickets, mirrors that graph through a Linear-compatible tracker surface, and launches Symphony as the autonomous execution runtime.

The current app is a working Next.js control plane with SQLite persistence, real LLM-backed plan ingestion, vendored Symphony orchestration, artifact storage, gate tracking, runtime observability, and project deletion.

## What the platform does

- Ingests deep-research markdown plans
- Uses Codex to produce a structured execution model
- Generates milestones, epics, dependency edges, findings, runs, artifacts, and audit events
- Injects mandatory QA, security, deployment, observability, documentation, and release gates
- Exposes a Linear-compatible tracker GraphQL surface for Symphony polling
- Launches Symphony against a per-project workflow contract
- Tracks gate readiness, runtime state, artifacts, findings, and audit history in the UI
- Supports hard deletion of failed or stale projects from the dashboard and project page

## Runtime model

There are two supported execution modes:

- `local_chatgpt`: uses the local Codex runtime already authenticated on the machine running Overture
- `hosted_api`: uses Codex with `OPENAI_API_KEY`

The automated local container deployment now includes the Codex CLI, `git`, the Elixir runtime required by Symphony, and startup auth bootstrapping. On container startup, Overture copies the host machine's ChatGPT-backed Codex auth into the container's persisted `CODEX_HOME` under the platform runtime root so live planning and execution work without an extra login step.

## Stack

- Next.js 16 + React 19
- SQLite via `better-sqlite3`
- Zod for validation
- Custom control-plane UI on the App Router
- Vitest for unit coverage
- Playwright for end-to-end verification
- Semgrep, Trivy, and ZAP wrappers for security checks
- Vendored Symphony runtime under `vendor/symphony`

## Repository layout

- `src/app`: routes, pages, and API endpoints
- `src/components`: intake, dashboard, runtime, and review UI
- `src/lib/server`: persistence, planner, tracker shim, Symphony manager, storage, and repository logic
- `scripts`: seeding, runner entrypoint, and security wrappers
- `tests/e2e`: browser-level product tests
- `infra`: Azure, AWS, and Jetson deployment assets and notes
- `vendor/symphony`: vendored Symphony runtime used for execution
- `plan.md`: sample source blueprint

## Prerequisites

- Node.js 22+
- npm
- Docker Desktop for local container deployment and ZAP
- A working Codex runtime for live planning and execution

Optional local binaries:

- `semgrep`
- `trivy`
- `mix` if you want to override the bundled Symphony build tool path

## Environment

Start from the shipped example:

```bash
cp .env.example .env
```

Common variables:

- `CONTROL_PLANE_TRACKER_TOKEN`: token accepted by the tracker shim
- `SYMPHONY_TRACKER_TOKEN`: token used by Symphony against the tracker shim
- `NEXT_PUBLIC_DEFAULT_REPO`: default repo source shown in intake
- `OPENAI_API_KEY`: required for `hosted_api` and cloud-style deployments
- `PORT`: app port
- `OVERTURE_BIND_HOST`: bind host for `npm run start`
- `OVERTURE_ROOT`: optional runtime data root override; defaults to `<repo>/.overture`
- `CODEX_HOME`: optional Codex auth/state home; Docker defaults this under `.overture`
- `OVERTURE_CODEX_BIN`: optional Codex CLI override
- `OVERTURE_MIX_BIN`: optional `mix` override for Symphony builds
- `OVERTURE_SYMPHONY_BIN`: optional Symphony binary override
- `OVERTURE_SYMPHONY_PORT_BASE`: base port used for per-project Symphony runtimes
- `OVERTURE_ORIGIN`: override origin used by the runner script

## Native quick start

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

For a production-style native launch:

```bash
npm run build
npm run start
```

This remains the simplest path for real project creation and execution when you want to use local ChatGPT-backed Codex auth.

## Create and execute a project

You can paste or upload a blueprint in the UI, or seed the sample `plan.md` from the command line:

```bash
npm run seed
```

That prints a project id. To launch Symphony for that project:

```bash
npm run runner -- <project-id>
```

The project page shows live Symphony runtime state, bootstrap logs, retry queues, tracker slices, artifacts, findings, and gate status.

## Delete a project

Project deletion is available in two places:

- The project dashboard cards on the home page
- The `Delete project` control on an individual project page

Deletion is a hard delete. It stops any active Symphony runtime for the project, removes the project row from SQLite, and deletes its runtime folders under `.overture/projects`, `.overture/artifacts`, and `.overture/workspaces`.

Equivalent API:

```text
DELETE /api/projects/:projectId
```

## Scripts

- `npm run dev`: Next.js development server
- `npm run build`: production build
- `npm run start`: standalone production server bound via `OVERTURE_BIND_HOST` and `PORT`
- `npm run seed`: ingest the repo `plan.md`
- `npm run runner -- <project-id>`: launch or reattach Symphony for a project
- `npm run lint`: ESLint
- `npm run test`: Vitest
- `npm run e2e`: Playwright against an isolated `.overture-e2e` runtime
- `npm run qa`: lint, unit tests, and production build
- `npm run security`: Semgrep and Trivy
- `npm run security:zap`: ZAP baseline against a running app
- `npm run deploy:local`: Docker Compose local deployment helper

## Verification flow

Recommended local verification:

```bash
npm run qa
npm run e2e
npm run security
ZAP_TARGET_URL=http://127.0.0.1:3000 npm run security:zap
npm audit --audit-level=high
```

## Docker deployment

Bring up the containerized control plane:

```bash
npm run deploy:local
```

This requires a usable ChatGPT Codex login on the host machine. `deploy.sh local` exports that host auth directory into the container automatically.

The local Docker setup now:

- Builds the production image
- Installs the Codex CLI automatically
- Installs `git` and the Elixir runtime needed by Symphony
- Includes the vendored Symphony runtime
- Binds `.overture` from the host into `/app/.overture`
- Persists Codex auth under `/app/.overture/codex-home`
- Copies host ChatGPT Codex auth into the container automatically
- Exposes the app at [http://127.0.0.1:3000](http://127.0.0.1:3000)

Health check:

```bash
curl http://127.0.0.1:3000/api/health
```

If the host machine is not already logged into Codex, `deploy.sh local` now fails before startup and the container entrypoint also fails fast. A successful container boot means the required runtime dependencies and ChatGPT-backed Codex auth bootstrap path are present.

## Runtime data

Default runtime directories:

- `.overture/data/overture.db`: canonical SQLite database
- `.overture/artifacts`: immutable evidence files
- `.overture/codex-home`: persisted Codex CLI auth and local Codex state for containerized runs
- `.overture/projects`: per-project workflow contracts and Symphony runtime files
- `.overture/workspaces`: per-project cloned workspaces used by Symphony
- `.overture-e2e`: isolated Playwright runtime root

`OVERTURE_ROOT` changes where `.overture` is created, but source resolution still points at the actual app repository root.

## Deployment assets

- `Dockerfile`: local production image
- `docker-compose.yml`: local container orchestration with a shared `.overture` bind mount
- `deploy.sh`: helper for local, Jetson, Azure, and AWS deployment entrypoints
- `infra/jetson/README.md`: Jetson deployment notes
- `infra/azure/main.bicep`: Azure baseline container-hosting asset with `OPENAI_API_KEY` secret injection
- `infra/aws/template.yaml`: AWS planning baseline; this is not yet a live Symphony hosting stack

## API surface

- `GET /api/health`: health probe
- `GET /api/projects`: list project summaries
- `POST /api/projects`: create a project from spec content
- `DELETE /api/projects/:projectId`: hard-delete a project
- `GET /api/projects/:projectId/snapshot`: fetch the full project snapshot
- `POST /api/projects/:projectId/execute`: launch or refresh Symphony for the project
- `GET /api/artifacts/:artifactId`: stream a stored artifact
- `POST /api/tracker/graphql`: Linear-compatible tracker shim

## Security notes

- Artifact reads are boundary-checked before file access
- Security scans exclude vendored third-party runtime code from first-party policy failures
- The app ships response headers via `next.config.ts`
- The Docker image runs as a non-root user

## Current deployment reality

- Native host execution and Docker deployment are both wired for real operation
- Docker local deployment now installs and boots the required Codex and Symphony runtime dependencies automatically
- Azure and AWS assets remain deployment baselines, not finished hosted production stacks
