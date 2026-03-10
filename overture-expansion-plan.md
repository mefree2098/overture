# Overture Expansion Plan
## Prompt Workshop + Deep Research + Launch + Deploy

### Executive recommendation

Build this as a **guided multi-stage pipeline** layered on top of Overture’s existing architecture, not as a rewrite.

Recommended lifecycle:

1. Prompt Workshop
2. Deep Research Run
3. Plan Review + Plan Ingestion
4. Symphony Execution
5. Launch Locally to Test
6. Deploy

### Core architectural decisions

1. **Keep deep research separate from ticket parsing in v1.**
   - Step 2 should produce `research-prompt.md`, `research-report.md`, and canonical `plan.md`.
   - Then feed `plan.md` into Overture’s existing planning pipeline.
   - Optionally emit `tickets.seed.json`, but treat it as advisory only.

2. **Use Codex App Server for the Prompt Workshop.**
   - This gives resumable threads, follow-up questions, approvals, forks, and a proper product-grade embedded agent surface.

3. **Use native OpenAI search first.**
   - Default to Codex native search behavior.
   - Add OpenAI Responses `web_search` as the hosted-mode fallback.
   - Support Tavily and Brave as optional MCP/provider fallbacks, not primary dependencies.

4. **Preserve the current “paste a finished plan” path.**
   - Existing users should still be able to skip directly to plan ingestion/execution.

5. **Treat launch and deploy as policy-gated stages with artifacts.**
   - Every launch/deploy attempt should produce logs, evidence, and a verdict.

---

## Product flow

### Step 1 — Prompt Workshop
Purpose: turn “brain vomit” into a strong deep-research prompt.

User experience:
- Chat interface inside Overture
- AI asks clarifying questions
- Side panel assembles the evolving deep-research prompt in real time
- Optional attachments: notes, markdown, PDFs, screenshots
- Optional repo context: local repo path or GitHub repo metadata
- Search mode selector: cached / live / provider fallback
- “Ready for Research” action locks a versioned prompt artifact

Outputs:
- `research-prompt.md`
- `workshop-summary.md`
- `open-questions.json`
- saved workshop thread metadata

### Step 2 — Deep Research Run
Purpose: turn the workshop prompt into a grounded implementation plan.

Behavior:
- Run a research job using native Codex search first
- Pull repo context where relevant
- Synthesize findings into:
  - `research-report.md`
  - `plan.md`
  - optional `architecture-decisions.md`
  - optional `citations.json`
- Surface unresolved decisions as explicit clarification items

Outputs:
- `research-report.md`
- `plan.md`
- `citations.json`
- `research-summary.json`

### Step 3 — Plan Review + Plan Ingestion
Purpose: let the user review the plan before Overture decomposes it.

Behavior:
- Render `plan.md` in a review screen
- Show inferred scope, injected work, risks, unresolved questions
- Allow user edits / regenerate / fork
- On approval, run the existing Overture planner and generate milestones, epics, work items, dependencies, gates

Outputs:
- immutable approved `plan.md`
- plan version record
- work item graph

### Step 4 — Symphony Execution
Purpose: run the approved plan through the current Overture + Symphony runtime.

Behavior:
- Reuse current project execution architecture
- Preserve current QA/security/deploy gates
- Continue using current project runtime, artifacts, tracker shim, and workspaces

### Step 5 — Launch Locally to Test
Purpose: let the user actually run the built project from Overture.

Behavior:
- Detect launch profile from repo/workspace
- Offer one-click launch buttons for supported targets
- Capture launch logs, screenshots, status, and manual smoke checklist completion

Supported launch profiles in v1:
- Web app (`npm run dev`, `npm run start`, `pnpm dev`, etc.)
- API/service (`docker compose up`, local server commands)
- Static site preview
- iOS Xcode app (`xcodebuild` + simulator profile)

Outputs:
- `launch-report.md`
- `launch.log`
- screenshots/video/artifacts where available

### Step 6 — Deploy
Purpose: push validated projects to supported targets.

Initial deploy targets:
- local container release
- Azure
- Jetson Orin Nano / Orin Nano Super
- Raspberry Pi
- iOS TestFlight upload
- iOS App Store submission prep

Outputs:
- `deployment-report.md`
- deployment logs
- release metadata
- smoke results

---

## Why deep research should stay separate from ticket parsing in v1

Do **not** make deep research the system of record for tickets in the first implementation.

Reasons:
- Overture already has a working plan-ingestion + decomposition flow
- Keeping `plan.md` as the boundary limits blast radius
- Research and decomposition are different concerns
- This preserves the current quick-start path
- It makes rollback much easier if the new research stage misbehaves

Recommended compromise:
- Research may emit optional `tickets.seed.json`
- Overture may compare that against its own decomposition for QA
- But the canonical execution graph should still be created by Overture’s current planner path until the research stage proves reliable

---

## Data model changes

Add these new entities:

### Project lifecycle
- `projectLifecycleStage`
  - `draft`
  - `workshop_active`
  - `research_ready`
  - `research_running`
  - `research_complete`
  - `plan_review`
  - `plan_ingested`
  - `execution_ready`
  - `executing`
  - `launch_ready`
  - `launch_running`
  - `launch_complete`
  - `deploy_ready`
  - `deploy_running`
  - `deployed`
  - `failed`

### Workshop
- `WorkshopThread`
- `WorkshopMessage`
- `WorkshopArtifact`
- `PromptVersion`

### Research
- `ResearchRun`
- `ResearchSource`
- `ResearchArtifact`
- `ResearchDecision`
- `ResearchQuestion`

### Launch
- `LaunchProfile`
- `LaunchRun`
- `LaunchArtifact`

### Deploy
- `DeployProfile`
- `DeployRun`
- `DeployArtifact`
- `DeployCredentialRef`

### New enums
- `ResearchProvider = codex_native | openai_responses | tavily_mcp | brave_mcp`
- `LaunchTarget = web | api | docker | ios_simulator`
- `DeploymentTarget = local | jetson | raspberry_pi | azure | aws | ios_testflight | ios_app_store`

---

## Backend implementation plan

### 1. Prompt Workshop subsystem
Create:
- `src/lib/server/codex-app-server-client.ts`
- `src/lib/server/prompt-workshop-service.ts`
- `src/lib/server/workshop-repository.ts`

Responsibilities:
- start/resume/fork workshop threads
- send messages
- stream events
- persist prompt drafts and derived summaries
- attach project metadata and artifacts

### 2. Research subsystem
Create:
- `src/lib/server/research-provider.ts`
- `src/lib/server/research-runner.ts`
- `src/lib/server/research-prompt-builder.ts`
- `src/lib/server/research-artifacts.ts`

Responsibilities:
- choose provider
- run deep research jobs
- collect sources/citations
- write `research-report.md` and `plan.md`
- expose structured summary for UI

### 3. Provider adapters
Create:
- `src/lib/server/research-providers/codex-native.ts`
- `src/lib/server/research-providers/openai-responses.ts`
- `src/lib/server/research-providers/tavily-mcp.ts`
- `src/lib/server/research-providers/brave-mcp.ts`

Rules:
- `codex_native` is default when local ChatGPT-authenticated Codex is available
- `openai_responses` is default fallback for hosted/API mode
- Tavily and Brave are optional
- all providers normalize into the same internal result shape

### 4. Plan ingestion bridge
Modify existing project creation flow so it supports:
- `createProjectDraft()`
- `approveResearchPlan()`
- `ingestApprovedPlan()`

Do not remove the existing `createProjectFromSpec()` path.

### 5. Launch subsystem
Create:
- `src/lib/server/launch-runner.ts`
- `src/lib/server/launch-profile-detector.ts`
- `src/lib/server/launch-profiles/web.ts`
- `src/lib/server/launch-profiles/docker.ts`
- `src/lib/server/launch-profiles/ios-simulator.ts`

Responsibilities:
- infer launch method
- run approved commands
- capture output and artifacts
- update launch verdicts

### 6. Deploy subsystem
Create:
- `src/lib/server/deploy-runner.ts`
- `src/lib/server/deploy-profiles/local.ts`
- `src/lib/server/deploy-profiles/azure.ts`
- `src/lib/server/deploy-profiles/jetson.ts`
- `src/lib/server/deploy-profiles/raspberry-pi.ts`
- `src/lib/server/deploy-profiles/ios-testflight.ts`
- `src/lib/server/deploy-profiles/ios-app-store.ts`

Responsibilities:
- target-specific packaging and deployment
- smoke verification
- release artifact generation
- approval gates for risky deploys

---

## Frontend implementation plan

### New primary wizard
Replace the single intake-first experience with a dual-path home screen:

**Path A — Guided flow**
1. Workshop
2. Research
3. Review plan
4. Build
5. Launch
6. Deploy

**Path B — Quick path**
- “I already have a plan”
- paste/upload `plan.md`
- continue using the current intake flow

### New pages/components
Create:
- `src/app/projects/[projectId]/workshop/page.tsx`
- `src/app/projects/[projectId]/research/page.tsx`
- `src/app/projects/[projectId]/launch/page.tsx`
- `src/app/projects/[projectId]/deploy/page.tsx`

Components:
- `PromptWorkshopPanel`
- `PromptDraftPreview`
- `ResearchRunTimeline`
- `ResearchArtifactViewer`
- `LaunchProfileCard`
- `DeployProfileCard`
- `ApprovalGateBanner`

### UX rules
- persist partial work everywhere
- every long-running action is resumable
- every stage produces visible artifacts
- allow fork/regenerate of workshop and research runs
- show exactly what the AI inferred vs what the user explicitly provided

---

## Search strategy

### Default behavior
1. `codex_native`
2. `openai_responses`
3. `tavily_mcp`
4. `brave_mcp`

### Native OpenAI search behavior
- Default to cached/native search behavior for safety and speed
- Let the user opt into live search when they want fresher external information
- Preserve citations/sources in the research output

### Why this order
- least external dependency surface
- best alignment with Codex-first product vision
- lowest integration complexity for Overture
- still gives an escape hatch if native search is unavailable

---

## Local launch design

### Launch profiles

#### Web profile
Detection:
- `package.json` with `dev` / `start`
- Next/Vite/React presence

Actions:
- install deps if needed
- start app on managed port
- wait for health response
- open local URL metadata
- capture screenshot(s)

#### Docker profile
Detection:
- `docker-compose.yml` / `compose.yaml`

Actions:
- `docker compose up -d`
- wait for configured health check
- capture container status and logs

#### iOS simulator profile
Detection:
- `.xcodeproj` or `.xcworkspace`

Actions:
- resolve scheme/workspace/project
- build for simulator with `xcodebuild`
- boot target simulator if needed
- install app to simulator
- launch app
- capture result bundle + screenshots + logs

Important:
- keep this operator-approved
- prefer deterministic simulator profiles stored in project settings

---

## Deploy design

### Azure
- build container
- push image
- deploy to configured Azure target
- run smoke endpoint validation

### Jetson
- build/pull arm64 container
- sync runtime files
- restart service
- run health/smoke checks

### Raspberry Pi
- treat similarly to Jetson but with its own architecture/profile
- likely container-first unless the project explicitly requires native runtime

### iOS TestFlight
- archive app
- export/upload build
- associate with correct app/bundle/version
- surface processing state
- allow optional tester group assignment in later milestone

### iOS App Store
- do not make “full public release” a one-click unattended action in v1
- automate archive/upload/submission prep
- require a final operator approval gate for submission/release

---

## API routes to add

- `POST /api/projects` → create draft or quick-path project
- `POST /api/projects/:projectId/workshop/thread`
- `POST /api/projects/:projectId/workshop/messages`
- `POST /api/projects/:projectId/workshop/fork`
- `POST /api/projects/:projectId/research/run`
- `POST /api/projects/:projectId/research/approve`
- `POST /api/projects/:projectId/plan/ingest`
- `POST /api/projects/:projectId/launch/run`
- `POST /api/projects/:projectId/deploy/run`
- `GET /api/projects/:projectId/artifacts`

---

## Milestone plan for Codex

### Milestone 1 — Foundations and schema migration
Deliverables:
- DB schema updates for workshop/research/launch/deploy
- lifecycle state machine
- artifact model extensions
- backward-compatible migration for existing projects

### Milestone 2 — Prompt Workshop
Deliverables:
- Codex App Server integration
- workshop thread UI
- prompt draft builder
- prompt versioning
- resume/fork support

### Milestone 3 — Deep Research
Deliverables:
- research runner
- provider abstraction
- native Codex search support
- hosted OpenAI fallback
- optional Tavily + Brave support
- plan/report artifact generation

### Milestone 4 — Plan review and ingestion bridge
Deliverables:
- plan review page
- approve/fork/regenerate controls
- ingestion from approved `plan.md`
- preserve existing quick path

### Milestone 5 — Launch locally
Deliverables:
- profile detector
- web/docker/iOS launch profiles
- artifact capture
- launch verdicts

### Milestone 6 — Deploy
Deliverables:
- extend existing deployment target model
- Azure/Jetson hardening
- Raspberry Pi target
- iOS TestFlight/App Store prep
- deployment artifacts and approval gates

### Milestone 7 — QA, security, and polish
Deliverables:
- unit coverage
- Playwright coverage for guided flow
- regression tests for legacy quick path
- failure recovery and resumability
- docs updates

---

## Definition of done

The feature is done when:
- A user can create a project without supplying a finished plan
- The workshop can iteratively produce a strong deep-research prompt
- Deep research can produce a reviewable `plan.md`
- Overture can ingest the approved `plan.md` into its existing execution graph
- The project can be launched locally from the UI
- A deployment profile can be executed from the UI with artifacts and verdicts
- Existing “paste plan and run” behavior still works

---

## Constraints for the implementing agent

- Do not remove the existing intake flow
- Do not collapse research and decomposition into one opaque step in v1
- Use native OpenAI/Codex search first
- Add Tavily and Brave only as optional fallbacks
- Preserve local-first execution assumptions
- Keep all long-running steps resumable
- Store artifacts for every stage
- Produce full code changes with tests and migrations
