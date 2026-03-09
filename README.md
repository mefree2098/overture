<p align="center">
  <img src="./icon.png" alt="Overture logo" width="320" />
</p>

# Overture

Overture is a local-first control plane for resumable AI software delivery. It ingests a deep-research implementation plan, turns it into a dependency-aware execution graph, injects mandatory QA, security, deployment, and release gates, and keeps evidence attached until the project is actually closure-ready.

The current implementation is a working Next.js app with a SQLite-backed project model, a Linear-compatible tracker shim, a mock Symphony-style execution runner, verification tooling, and containerized local deployment.

## What Overture does

- Ingests a markdown plan such as [plan.md](./plan.md)
- Extracts milestones, epics, risks, open questions, and acceptance criteria
- Normalizes the result into canonical projects, plan versions, work items, dependencies, findings, artifacts, runs, and audit events
- Injects required QA, security, deployment, and release gates into the execution graph
- Exposes a Linear-compatible GraphQL tracker surface for external agent polling and state sync
- Runs a background execution loop that simulates autonomous delivery and writes immutable evidence artifacts
- Surfaces project health, release readiness, findings, artifacts, deployment evidence, and audit trail in the UI

## Implemented stack

- App framework: Next.js 16 + React 19
- Persistence: SQLite via `better-sqlite3`
- Validation/parsing: `zod`, markdown parsing utilities, structured plan generation
- UI: App Router, custom styling, markdown rendering, operator dashboard views
- Testing: Vitest + Playwright
- Security tooling: Semgrep, Trivy, ZAP baseline
- Deployment: standalone Next.js server, Docker Compose, Azure Bicep, AWS CloudFormation, Jetson notes

## Repository layout

- [src/app](./src/app): routes, pages, and API endpoints
- [src/components](./src/components): UI components for intake, dashboards, artifacts, and shell views
- [src/lib/server](./src/lib/server): database, storage, repository, parsing, tracker shim, and plan generation
- [scripts](./scripts): seeding, runner loop, and security wrappers
- [tests/e2e](./tests/e2e): browser-level product smoke coverage
- [infra](./infra): deployment assets for Azure, AWS, and Jetson
- [plan.md](./plan.md): source blueprint used to seed the example project
- [icon.png](./icon.png): project branding asset used in this README

## Prerequisites

- Node.js 22+
- npm
- Docker Desktop for local container deployment and ZAP scanning

Optional local tools:

- `semgrep`
- `trivy`

If those binaries are not installed locally, the security wrappers fall back to Docker where applicable.

## Environment

Copy [`.env.example`](./.env.example) to `.env` for local development:

```bash
cp .env.example .env
```

Supported variables:

- `CONTROL_PLANE_TRACKER_TOKEN`: demo token for the control-plane tracker surface
- `SYMPHONY_TRACKER_TOKEN`: demo token for Symphony-style polling clients
- `NEXT_PUBLIC_DEFAULT_REPO`: default repo path shown in the intake form
- `PORT`: app port for local or container runtime
- `OVERTURE_ROOT`: optional override for the runtime data root

## Quick start

Install dependencies:

```bash
npm install
```

Start the app in development:

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

### Seed the example project from `plan.md`

Create the canonical seeded project:

```bash
npm run seed
```

This prints a project ID. To execute the generated work graph:

```bash
npm run runner -- <project-id>
```

You can also create projects directly from the UI by pasting or uploading markdown.

## Main scripts

- `npm run dev`: run the Next.js dev server
- `npm run build`: create the production build and standalone static bundle
- `npm run start`: run the standalone production server
- `npm run seed`: seed the current root `plan.md` into the database
- `npm run runner -- <project-id>`: execute queued work items for a project
- `npm run lint`: run ESLint
- `npm run test`: run unit tests
- `npm run e2e`: run Playwright against an isolated `.overture-e2e` runtime
- `npm run qa`: run lint, unit tests, and production build
- `npm run security`: run Semgrep and Trivy
- `npm run security:zap`: run ZAP baseline against a live app URL
- `npm run deploy:local`: build and start the Docker Compose deployment

## Verification workflow

Recommended local verification sequence:

```bash
npm run qa
npm run e2e
npm run security
ZAP_TARGET_URL=http://127.0.0.1:3000 npm run security:zap
```

Dependency audit:

```bash
npm audit --audit-level=high
```

## Local deployment

Bring up the containerized app:

```bash
npm run deploy:local
```

This builds the production image and starts the app on [http://127.0.0.1:3000](http://127.0.0.1:3000).

Health check:

```bash
curl http://127.0.0.1:3000/api/health
```

Docker Compose uses a named volume for `/app/.overture`, so runtime state persists across container restarts.

## Seeding and executing inside Docker

If you want the containerized instance to contain the example `plan.md` project:

```bash
docker compose exec -T overture npm run seed
docker compose exec -T overture node --import tsx scripts/runner.ts <project-id>
```

## Security posture

The app currently includes:

- strict response headers configured in [next.config.ts](./next.config.ts)
- non-root container runtime in [Dockerfile](./Dockerfile)
- Docker health check
- Trivy-scanned Docker and AWS deployment assets
- ZAP baseline policy in [scripts/security/zap-rules.conf](./scripts/security/zap-rules.conf) for documented false-positive suppression
- immutable artifact storage rooted under the runtime data directory with path-boundary checks

## Runtime data

Overture stores local runtime state outside source code under:

- `.overture/`: primary app data for local/dev/prod runs
- `.overture/data/overture.db`: canonical SQLite database
- `.overture/artifacts/`: immutable generated evidence
- `.overture/projects/`: generated project documents
- `.overture/workspaces/`: runner workspaces
- `.overture-e2e/`: isolated Playwright runtime

These directories are ignored by Git and excluded from Docker build context.

## Deployment assets

- [Dockerfile](./Dockerfile): production container image
- [docker-compose.yml](./docker-compose.yml): local container orchestration
- [deploy.sh](./deploy.sh): local and Azure deployment helper
- [infra/azure/main.bicep](./infra/azure/main.bicep): Azure baseline
- [infra/aws/template.yaml](./infra/aws/template.yaml): AWS baseline
- [infra/jetson/README.md](./infra/jetson/README.md): Jetson deployment notes

## API surface

Key routes:

- `/api/health`: health probe
- `/api/projects`: create projects from spec content
- `/api/projects/:projectId/snapshot`: fetch the full project snapshot
- `/api/projects/:projectId/execute`: trigger execution of queued work
- `/api/artifacts/:artifactId`: stream stored artifacts
- `/api/tracker/graphql`: Linear-compatible tracker shim

## Notes

- The execution loop is currently a mock Symphony-style runner that writes deterministic evidence artifacts rather than invoking a real agent provider.
- The tracker endpoint is intentionally compatible with the orchestration shape needed for polling and state reconciliation.
- The shipped local deployment is production-built and runs the standalone Next.js server, not the dev server.
