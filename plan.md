# Blueprint for a Resumable AI Software Delivery Platform Wrapped Around Symphony

## Product summary and feasibility boundaries

**1) Executive summary**

You’re building an “AI software delivery OS” that ingests a “deep research spec development plan,” turns it into a structured, dependency-aware project plan, and then executes that plan via autonomous agents until the project is *actually* done—meaning: tests pass, warnings are handled, UI flows are exercised, security issues are remediated (or explicitly waived), and deployments are validated across local + Jetson + Azure + AWS.

The cleanest way to do this *without fighting* Symphony is to treat Symphony as the **execution runtime** (implementation-run orchestrator) and build your platform as the **control plane** Symphony explicitly does *not* try to be. Symphony’s spec is explicit that rich multi-tenant control planes are non-goals, and that ticket-editing business logic belongs in workflow prompts and tools rather than being built into the orchestrator. citeturn25view3turn25view0

So the platform should:

- Own the canonical project plan, gates, artifacts, and “definition of done.”
- Generate and maintain per-project execution contracts (workflow files + workspace policy).
- Feed work items to Symphony in a way that supports strict separation, pause/resume, retries, and “keep cycling until verified.”

The “secret sauce” is not another agent loop. Symphony already has a loop. The product differentiator is **policy-enforced orchestration**: QA/security/deploy gates are not suggestions; they’re closure blockers.

**2) Feasibility assessment**

### Subscription-first execution is feasible, but not as a multi-tenant hosted service “by default.”

Codex supports two sign-in modes: **ChatGPT sign-in for subscription access** and **API key sign-in for usage-based access**. Codex cloud requires ChatGPT sign-in, while the CLI and IDE extension support both. citeturn5view0turn12search13

However, building a hosted product that “runs Codex on behalf of users via their subscriptions” runs into operational and contractual realities:

- Codex CLI caches credentials locally (e.g., `~/.codex/auth.json` or OS credential storage); it’s designed as a user-local agent runtime. citeturn5view0  
- OpenAI’s Services Agreement forbids sharing credentials, and forbids reselling/leasing access to accounts; end user accounts are single-user. citeturn13view0  
- Practically, a multi-tenant SaaS where your servers hold user subscription tokens is both a security nightmare and a compliance liability. (“My startup’s core feature is storing your auth tokens in a box labeled ‘pls don’t hack’” is not a strategy.)

**Best feasible design**: a **local-first execution plane** (or single-tenant self-hosted execution plane) that uses the user’s authenticated Codex runtime, paired with an optional hosted control plane that stores plans/artifacts (still compatible with “bring your own execution”).

### Symphony integration is feasible as a wrapper (no fork), but you must plan for tracker assumptions.

Symphony’s spec says the tracker kind in this spec version is Linear, and it describes a Linear-compatible issue-tracker contract (candidate issue polling, fetch by IDs for reconciliation, etc.). citeturn25view1turn25view2  
Its Elixir implementation is explicitly positioned as prototype/evaluation software, recommending teams implement hardened versions from the spec. citeturn4view0

That’s not a blocker; it’s a design constraint: treat Symphony as *execution runtime*, not the source of truth.

### “Single script deploy” is feasible for local and Azure free-tier-ish hosting

- Azure Cosmos DB has a **lifetime free tier** (first **1000 RU/s** and **25 GB** storage free, opt-in at account creation, with account limits). citeturn11search2turn11search22turn11search10  
- Azure Container Apps has a **free grant** (vCPU-seconds and GiB-seconds, plus request free tiers) suitable for a small control plane. citeturn22search2turn22search14  

So: yes, you can offer a “one script” deploy that provisions an Azure Container Apps-based control plane + Cosmos DB free-tier account, while execution still happens locally unless the user opts into API-key-based hosted execution.

**26) Explicit assumptions**

- Single-user or single-tenant (per customer) by default for “subscription-first” execution; multi-tenant hosted execution uses API keys. citeturn5view0turn13view0  
- The platform can run in “trusted environments” consistent with Symphony’s positioning as a preview intended for trusted setups. citeturn26search0turn4view0  
- The platform can run a local filesystem workspace and spawn processes; Symphony requires local filesystem workspaces and a coding-agent executable that supports app-server mode over stdio. citeturn25view0  
- Jetson deployments assume JetPack-enabled ARM64 devices; JetPack supports Jetson Orin Nano Super and includes MAXN mode. citeturn11search21turn11search5  

**28) Final recommendation**

Build a **control plane** + **local execution plane**:

- Control plane: project/spec ingestion, plan generation, policy injection (QA/security/deploy), state persistence, artifact review UI, gate enforcement.
- Execution plane: per-project Symphony runner instances plus verification/scanning job runners, all operating inside per-project workspace roots with strict sandbox/approval defaults.

Then *optionally* add a hosted execution plane (API key mode) later.

That’s the strongest real-world path that respects subscription-first constraints, avoids forking Symphony, and still gives enterprise-grade governance.

## Key architectural decisions and current-state analysis

**3) Key architectural decisions**

### Decision: wrapper platform + thin orchestration adapter, not a Symphony fork

- Symphony’s spec explicitly excludes rich multi-tenant control planes and prescriptive UIs. citeturn25view3  
- The Elixir implementation is prototype/eval. citeturn4view0  

Forking would turn your product roadmap into “keep up with upstream churn” plus “own an orchestrator.” That’s a self-inflicted hobby.

**Chosen approach**: keep Symphony unmodified. Build a **Symphony Integration Layer** that:
1) generates workflow contracts per project,  
2) feeds work items via a tracker interface,  
3) collects events/logs/artifacts, and  
4) enforces gates externally.

### Decision: internal PM system is canonical; tracker is an adapter

Your platform needs plan versions, branching/forking, audit trails, resumability, and per-project isolation across logs/artifacts/secrets. Symphony itself aims to support restart recovery without requiring a persistent database and is not a multi-tenant control plane. citeturn25view3  

So: make the platform DB the **source of truth**; treat “tracker issues” as an **execution queue representation**.

### Decision: integrate with Symphony via a “Linear-compatible tracker shim”

Symphony’s Elixir implementation uses a Linear adapter that queries issues by project slug and state names, and supports mutations like `commentCreate` and `issueUpdate` (state changes). citeturn33view0turn34view1  

Instead of requiring a real entity["company","Linear","issue tracker"] account, implement a **local/internal GraphQL endpoint** that speaks the subset of Linear GraphQL Symphony actually uses. Symphony already supports configuring tracker endpoint and project slug semantics in its spec. citeturn25view1turn25view2  

This keeps Symphony stock while meeting your requirement for an internal PM system.

### Decision: hybrid Codex integration (App Server first, CLI as fallback)

Codex App Server is explicitly the deep-integration interface providing auth, conversation history, approvals, and streamed agent events; it’s JSON-RPC over stdio and is how rich clients integrate. citeturn5view1turn14view0turn7view0  
Codex CLI is the local agent surface, supports ChatGPT sign-in, and can attach images. citeturn5view2turn18search1turn18search9

So:
- Use **App Server** as the primary integration in your runner and UI streaming.
- Use CLI `codex` as a fallback or bootstrap (install, login, basic exec), and for “bring your own local agent” setups.

**4) Current-state analysis of Symphony and Codex relevant to this platform**

### Symphony runtime model (what you inherit)

Symphony’s spec describes an orchestrator that:
- polls the tracker on a cadence and dispatches with bounded concurrency,
- keeps a single authoritative orchestrator state (dispatch/retry/reconcile),
- creates deterministic per-issue workspaces and preserves them across runs,
- stops active runs when issue states become ineligible,
- retries with backoff,
- loads runtime behavior from a repo-owned `WORKFLOW.md` contract. citeturn25view0turn3view4  

Workspace invariants are explicit: per-issue workspace under a workspace root, sanitized identifiers, and hard checks that the agent only runs within the per-issue workspace path. citeturn3view4  

That maps perfectly to “project isolation” when you run **one Symphony instance per project**, each configured with its own workspace root and tracker project slug.

The run lifecycle and terminal reasons are specified (preparing workspace → building prompt → launching agent process → streaming → succeeded/failed/timed out/stalled/canceled). citeturn3view1  
This is gold for resumability UX: you can show these phases as a timeline and reliably implement retry logic.

Symphony’s spec also clarifies what it *doesn’t* try to be: no rich web UI or multi-tenant control plane, no mandated sandbox policies, no built-in “how to edit tickets/PRs” logic. citeturn25view3  
That’s your entire product opportunity.

The Elixir implementation:
- polls Linear (or equivalent),
- creates isolated workspace per issue,
- launches Codex in App Server mode,
- streams updates back,
- can optionally run a Phoenix LiveView dashboard + JSON API endpoints (e.g., `/api/v1/state`). citeturn4view0  

### Codex runtime model (what you can rely on)

Auth + subscription alignment:
- Codex supports ChatGPT login and API key login; CLI defaults to ChatGPT login absent a session. citeturn5view0turn5view2  
- Credential caching exists locally; `~/.codex/auth.json` is explicitly called out, along with keyring options. citeturn5view0  

App Server protocol:
- JSON-RPC over stdio; websocket transport exists but is experimental/unsupported (so don’t build core features on it). citeturn7view0  
- Threads can be started/resumed/forked; this is essential for resumability and “branching experiments.” citeturn6view3  
- Server backpressure includes a retryable overload error; clients should exponential backoff. citeturn7view0  
- App Server supports generating JSON schema / TS schema per version, enabling automated compatibility checks in your build/test pipeline. citeturn7view0  

Safety controls:
- Sandboxing and approvals are first-class, with clear combinations (`read-only`, `workspace-write`, `danger-full-access`) and approval policies. citeturn15view0turn15view2  
- Docs warn that sandboxing can fail in containerized environments lacking required kernel features; in that case, isolation should come from the container itself. citeturn15view1  

Local state + per-project separation:
- Codex stores state under `CODEX_HOME` (default `~/.codex`) including auth.json and other artifacts; project configs can live under `.codex/config.toml` and are loaded only when the project is trusted. citeturn20view0turn20view1  

These capabilities are enough to implement “resumable, multi-project” execution in a deterministic way—if you isolate workspaces, config layers, and (optionally) Codex state roots per project.

## Platform architecture blueprint

**5) Recommended product architecture**

### High-level: “control plane + execution plane + verification plane”

- **Control Plane (Platform Core)**  
  Owns projects, plan versions, tasks, dependencies, policies, gates, approvals, audit trails, and UI.

- **Execution Plane (Runner)**  
  Owns per-project running processes, workspace lifecycle, Symphony instance lifecycle, Codex App Server session management, and tool execution.

- **Verification Plane (QA/Sec/Deploy jobs)**  
  Owns deterministic, repeatable checks (tests, lint, scans, deploy smoke tests) that gate closure.

This maps to Symphony’s own architectural split: it is a scheduler/runner, but not a multi-tenant management layer. citeturn25view3

### Project separation strategy (hard-line isolation)

For every project `P`:

- Separate workspace root: `workspace_root = <platform_root>/workspaces/P/`
- Separate Symphony instance config: `<platform_root>/projects/P/workflow/WORKFLOW.md`
- Separate run logs + artifacts: `<platform_root>/projects/P/artifacts/`
- Separate secrets scope: `<platform_root>/projects/P/secrets/` (encrypted, never logged)
- Separate execution queue view: `tracker_project_slug = P` (in your tracker shim)

Symphony’s workspace safety invariants (must run inside per-issue workspace under workspace root) become your enforcement mechanism. citeturn3view4

**6) System architecture diagram (textual)**

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                               Control Plane                              │
│                                                                          │
│  Web UI (Next.js)  ──>  API (REST/SSE)  ──>  DB (SQLite/Cosmos/Dynamo)   │
│      │                          │                      │                 │
│      │                          │                      ├─ Plans (versions)
│      │                          │                      ├─ Tasks + DAG
│      │                          │                      ├─ Runs + Artifacts
│      │                          │                      └─ Findings + Gates
│      │                          │
│      └────────────── Project policy, approvals, gate status ────────────┘
│
│   Event bus (in-proc + persisted outbox) + scheduler (tick + webhooks)
│
└───────────────┬──────────────────────────────────────────────────────────┘
                │
                │ control messages (start/stop/resume run, execute job)
                v
┌──────────────────────────────────────────────────────────────────────────┐
│                              Execution Plane                             │
│                                                                          │
│  Runner Daemon (local or single-tenant)                                  │
│   ├─ Project Supervisor (process tree per project)                        │
│   ├─ Symphony Instance Manager (1 per project)                            │
│   │    ├─ WORKFLOW.md generator                                           │
│   │    └─ logs collector + /api/v1/state poller (optional)                │
│   ├─ Tracker Shim (Linear-compatible GraphQL)                             │
│   │    └─ translates DB tasks<->GraphQL issues + mutations                │
│   ├─ Codex App Server Client (stdio JSON-RPC)                             │
│   └─ Artifact + Evidence collector                                        │
│                                                                          │
└───────────────┬──────────────────────────────────────────────────────────┘
                │
                │ executes verification jobs in workspaces / containers
                v
┌──────────────────────────────────────────────────────────────────────────┐
│                             Verification Plane                           │
│                                                                          │
│  QA Jobs: unit/integration/e2e, screenshot+video capture, lint, build     │
│  Sec Jobs: SAST, dependency scan, secrets scan, config scan, DAST         │
│  Deploy Jobs: local + Jetson + Azure + AWS deploy + smoke tests           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**7) Component-by-component design**

### Subsystem: Spec ingestion + planning pipeline

**Goal**: Convert uploaded research plans into a normalized plan graph (epics/milestones/tasks/dependencies) and continuously refine the plan as findings roll in.

**Pipeline phases**
1. **Ingestion**
   - Accept: markdown, PDF, doc, pasted text.
   - Store original as immutable artifact (content hash).
2. **Parsing**
   - Extract sections, headings, requirements language (“must/should”), deployment targets, NFRs.
3. **Structured extraction to SpecIR**
   - Emit JSON with explicit schemas:
     - features
     - user roles/personas
     - data entities
     - integrations
     - constraints
     - risks
     - acceptance criteria
4. **Normalization**
   - Deduplicate requirements.
   - Normalize nouns to “entities” for consistent mapping (e.g., “user account,” “auth user,” “login”).
5. **Decomposition**
   - Convert SpecIR into:
     - epics
     - milestones
     - tasks
     - subtasks
     - dependency graph
6. **Policy injection**
   - Auto-add QA, security, deployment, observability, docs, release readiness workstreams.
   - Mark some additions as “mandatory injected.”
7. **Ambiguity + contradiction detection**
   - Create “Clarification tasks” tagged `needs-decision`.
   - Default to safe/boring decisions when possible (secure defaults, minimal exposures).
8. **Plan review synthesis**
   - Generate the “Plan Review” artifact for the user: what was inferred, what was injected, what is high-risk scope.

**When enhancements are auto-added vs approval-gated**
- **Auto-added always**: QA stack, security loop, deployment planning for 4 targets (hard constraints).  
- **Auto-added by default unless user opts out**: observability baseline, runbooks, feature flags, structured logging.  
- **Proposed for approval**: scope-expanding product features that weren’t in spec, major architecture shifts, paid cloud services beyond free tiers.  
- **Blocked**: anything that requires unsafe permissions (e.g., full network + no sandbox) without explicit operator opt-in. citeturn15view0turn15view2  

### Subsystem: Internal PM system (canonical)

This system is the source of truth. Everything else—tracker issues, Symphony state, Codex threads—is derived.

Core requirements:
- Plan versions (immutable snapshots).
- Execution runs and attempts correlated to tasks.
- Gates that block closure.
- Fork/branch of plans.
- Audit trail.

### Subsystem: Tracker Shim (Linear-compatible GraphQL)

**Purpose**: Make Symphony believe it’s polling Linear, while actually polling your internal DB.

**Why this works**: Symphony spec and Elixir implementation both assume a Linear GraphQL endpoint and the “project slug” filter. citeturn25view1turn34view1

**Implement the subset of schema used by Symphony queries/mutations**, specifically:
- `issues(filter: { project: { slugId: { eq } }, state: { name: { in } } }, first, after) { nodes {...} pageInfo{...} }` citeturn34view1turn25view1  
- `issues(filter: { id: { in } }, first) { nodes {...}}` citeturn34view1  
- `commentCreate(input: { issueId, body }) { success }` citeturn33view0  
- `issueUpdate(id, input: { stateId }) { success }` plus state lookup `issue(id){ team{ states(filter:{name:{eq}}) } } }` citeturn33view0  

**Auth strategy**
- Symphony uses an API key in `Authorization` header per spec. citeturn25view1  
- Define two API keys:
  - `SYMPHONY_TRACKER_TOKEN` (least-privilege; cannot set terminal “Done”)
  - `CONTROL_PLANE_TRACKER_TOKEN` (full privilege; can close tasks)
- Enforce mutation policy server-side (GraphQL resolver checks):
  - Allow `commentCreate` always.
  - Allow `issueUpdate` only to non-terminal states for SYMPHONY token.
  - Allow terminal states only for CONTROL PLANE token.

This prevents “agent thinks it’s done” from equaling “system is done.”

### Subsystem: Symphony Instance Manager

Run one instance per project for isolation and simplicity:

- Each instance:
  - Has its own `WORKFLOW.md`
  - Has its own `workspace.root` directory
  - Polls your tracker shim using the project slug
  - Writes logs to a project-specific log root
- Optional: enable Symphony’s own small dashboard and `/api/v1/state` endpoints and ingest state for UI. citeturn4view0  

Pausing/resuming:
- **Pause**: set all project tasks to a non-active state (so `fetch_candidate_issues` returns none), or stop the Symphony process.
- **Resume**: start process again; Symphony supports restart recovery without requiring a DB. citeturn25view3  

### Subsystem: Codex Integration Layer

Use Codex App Server for rich task streaming and thread persistence:

- App Server is JSON-RPC over stdio; websocket is experimental/unsupported, so tunnel stdio yourself if you need remote UI streaming. citeturn7view0turn5view1  
- Use thread primitives:
  - `thread/start` when beginning a new run
  - `thread/resume` when retrying a run attempt or continuing a paused project
  - `thread/fork` when “branching” plan execution experiments citeturn6view3  

For version compatibility:
- Run `codex app-server generate-json-schema` in CI to generate a schema bundle pinned to the installed Codex version; enforce typed clients. citeturn7view0  

### Subsystem: Artifact + evidence store

Every task closure must have machine-verifiable evidence:
- test logs
- lint output
- screenshots (before/after) + recorded video runs
- scan results
- deployment smoke results

This is how you stop the platform from becoming “trust me bro, the agent did it.”

**8) Data model / schema design**

A pragmatic canonical model (document-oriented, works in SQLite JSON, Cosmos, Dynamo). The key trick is: **event-sourced runs + immutable plan versions**.

**Canonical entities (mandatory)**
- `Tenant` (optional if single-user local)
- `User`
- `Project`
- `SpecDocument` (immutable, content-hash addressed)
- `PlanVersion` (immutable snapshot)
- `WorkItem` (task/subtask; mutable status)
- `DependencyEdge` (WorkItem → WorkItem)
- `Run` (attempt on a WorkItem; immutable)
- `Artifact` (immutable)
- `Finding` (QA/Sec/Deploy)
- `GateStatus` (derived but stored for quick reads)
- `PolicyProfile` (QA/security/deploy defaults per project)

**Derived views**
- Project dashboard rollups
- “Critical path” path computations
- Risk scoring

**Key fields to include**
- `WorkItem.type`: `spec`, `design`, `implement`, `qa`, `security`, `deploy`, `docs`, `release`, `triage`
- `WorkItem.status`: `queued`, `in_progress`, `blocked`, `awaiting_review`, `verifying`, `failed`, `done`, `waived`
- `Run.status`: match Symphony run attempt lifecycle + terminal reasons for UX alignment. citeturn3view1  
- `Run.symphony.workspace_path`: deterministic per issue identifier. citeturn3view4  
- `Run.codex.thread_id`: App Server thread id for resume/fork. citeturn6view3  
- `Finding.severity`: `critical`, `high`, `medium`, `low`, `info`
- `Finding.status`: `open`, `fix_in_progress`, `fixed_pending_recheck`, `accepted_risk`, `resolved`

**9) Project management model**

**Canonical source of truth**: internal PM DB.

Symphony is an execution engine; it is not your PM system (by spec). citeturn25view3

**Statuses + gates**
- WorkItems can be moved to `done` only by the Gate Engine when:
  - QA gate = PASS
  - Security gate = PASS or accepted with waiver
  - Deployment matrix meets policy (at minimum local smoke verified; others per requirements)

**Branching/forking model**
- `PlanVersion` is immutable.
- Fork = create new `PlanVersion` referencing parent, optionally copying WorkItems but resetting statuses.
- In execution, Codex threads can be forked via App Server to explore approaches without losing history. citeturn6view3  

**Audit trail**
- Every transition emits an append-only `AuditEvent`:
  - actor: user/system/agent
  - what changed
  - previous + next state
  - timestamp
  - linked artifacts if applicable

**10) Symphony integration strategy**

**What Symphony owns**
- Dispatch loop, bounded concurrency, retries/backoff, reconciliation polling. citeturn25view0turn3view1  
- Workspace lifecycle + safety invariants. citeturn3view4  
- Running Codex app-server inside the workspace per run. citeturn4view0turn25view0  

**What the wrapper owns**
- The plan, tasks, dependencies, gates, closure rules.
- The tracker shim (work queue representation).
- Verification/scanning jobs and closure enforcement.
- UI/UX, artifacts, audit.

**Multiple projects**
- Run one Symphony instance per project.
- Give each instance:
  - unique `tracker.project_slug` (your project ID)
  - unique `workspace.root`
  - unique logs root

**Pause/resume**
- Stop Symphony process, or empty candidate issues by state.
- Resume by restarting; Symphony targets restart recovery without needing a DB. citeturn25view3  

**Retry/continuation**
- Let Symphony handle retries and preserve workspaces across attempts, as explicitly noted in spec. citeturn3view4turn25view0  

**11) Codex integration strategy**

### Comparison: CLI vs App Server vs hybrid

**Codex CLI**
- Strong for local-first setup and user authentication, and it’s designed to run locally. citeturn5view2  
- Supports image inputs via `--image/-i`. citeturn18search1turn18search9  
- Good fallback if App Server integration fails or if you want to “shell out” for simple interactions.

**Codex App Server**
- Designed for embedding in products: auth, conversation history, approvals, streamed agent events. citeturn5view1turn14view0turn7view0  
- Threads can be resumed/forked; essential for resumability UX. citeturn6view3  
- Supports text and image items including local image paths. citeturn18search5  

**Hybrid (chosen)**
- App Server for the product experience (stateful threads, resumability, streaming).
- CLI as fallback/bootstrap: install/login, emergency workflows, and local ops.

### Authentication flow

Default: **Sign in with ChatGPT** for subscription access. citeturn5view0turn5view2  
Codex opens a browser window and returns a token; it caches credentials locally and refreshes tokens for active sessions. citeturn5view0  

Enterprise/managed environments:
- Prefer OS keyring storage (`cli_auth_credentials_store`), avoid plaintext auth.json when possible. citeturn5view0  

Hosted execution fallback:
- Use API key auth for programmatic/CI workflows (Codex docs explicitly recommend API keys for programmatic CLI workflows and caution against exposing execution in untrusted/public environments). citeturn5view0  

### Session/thread lifecycle strategy for project continuity

Per WorkItem run:
- Create or resume a Codex thread associated with the workspace + branch.
- Store `threadId` in your `Run` record.
- For retries, use `thread/resume` unless you deliberately fork for experimentation. citeturn6view3  

Per project:
- Keep project-level “Planner” and “Architecture” threads separate from per-task execution threads to limit context pollution.
- Use `CODEX_HOME` or `.codex/config.toml` layering to enforce per-project config defaults and reduce cross-project bleed. citeturn20view0turn20view1  

### Safety: approvals and sandbox policy as defaults

Set defaults to:
- Sandbox: `workspace-write`
- Approval: `untrusted` or `on-request` depending on mode  
Use “never” only for narrow, deterministic verification jobs in pre-hardened sandboxes. citeturn15view0turn15view2  

**12) Agent architecture**

Do not let “multi-agent” become “multi-merge-conflict.”

Define roles as **task types mapped to prompts + tool allowances**, enforced by policy profiles.

Recommended roles:
- **Planner / Decomposition Agent**: reads SpecIR + repo, produces plan deltas, never writes code.
- **Implementation Agent**: modifies code + tests, produces diffs.
- **QA Agent**: generates tests, runs test suites, triages failures, but cannot mark tasks done.
- **Security Agent**: runs scans (SAST, dependency, secrets), opens findings, proposes fixes, re-runs scans.
- **UI/UX Review Agent**: consumes screenshots/videos, verifies flows, produces structured feedback.
- **Deployment Agent**: authors Dockerfiles/IaC, runs deploy smoke tests, captures results.
- **Docs/Runbook Agent**: writes runbooks, “how to operate”, rollback steps.
- **Release Readiness Agent**: final gatekeeper; checks evidence completeness.

Codex can spawn sub-agents when multi-agent mode is enabled and configured; it supports defining agent roles with separate configs and instructions. citeturn24view0  
However, enforce a platform-level rule: **only one role may hold the “write lock” on a workspace at a time**.

Handoff rules:
- “Implementation” completes → triggers Verification Plane jobs.
- Any failed job → creates Findings → creates remediation tasks → queues new execution runs.

Stopping conditions (closure):
- Not “agent says done,” but “Gate Engine says pass.”

**17) Persistence / resumability design**

Resumability is not a vibe; it’s a data model.

Persist:
- PlanVersion snapshots
- WorkItem statuses + dependency graph
- Run history (attemptedAt, workspace path, threadId, Symphony attempt status)
- Artifacts + evidence hashes
- Findings and their remediation links
- Full audit log

Recovery behavior:
- If Runner crashes: on restart, query Symphony states (optional API) and update Runs; if unavailable, mark Runs “unknown” and reconcile from workspace state + latest tracker states.
- If Symphony crashes: restart it; it supports restart recovery without needing a DB by design. citeturn25view3  
- If Codex App Server session drops: resume the thread. citeturn6view3  

**18) Observability / logging / audit design**

Use:
- Structured logs everywhere.
- Correlated IDs: `project_id`, `work_item_id`, `run_id`, `thread_id`, `workspace_path`.
- OpenTelemetry for traces/metrics/logs; the collector model supports collecting telemetry and exporting to backends, with transform/scrub support. citeturn17search3turn17search7  

In practice:
- Control plane emits audit events on every state transition.
- Runner streams:
  - Symphony logs
  - Codex App Server event stream summaries (item started/delta/completed)
- Verification Plane emits: test run metrics, scan counts, deploy health checks.

**19) Failure modes and recovery design**

Codex failures:
- App Server emits a `codexErrorInfo` enum for common failure classes (context window exceeded, usage limit exceeded, auth, sandbox error, upstream HTTP). citeturn7view1  
- Implement automatic action mapping:
  - `UsageLimitExceeded`: pause executions, show “rate limit cooldown,” allow resume.
  - `ContextWindowExceeded`: auto-compact or fork thread with summarized context.
  - `SandboxError`: downgrade to read-only; require operator intervention.

App Server overload:
- Backpressure can return `-32001` “Server overloaded; retry later,” requiring exponential backoff. citeturn7view0  

Containerization caveat:
- Codex sandboxing may not work inside Docker depending on host/kernel; if so, container isolation must be your sandbox, and you may need `danger-full-access` inside the container. citeturn15view1turn15view3  

Symphony failures:
- Track run attempt lifecycle phases and terminal reasons for correct retry UX. citeturn3view1  

## Hard guardrails for QA, security, and deployment

**13) QA framework**

Policy: every project must include QA workstreams even if spec omits them. This is a **hard orchestration policy** in your planner injector.

### Always-on QA stack (minimum)

- Unit tests (language-idiomatic frameworks)
- Integration tests (DB/API boundaries)
- End-to-end tests (UI flows where applicable)
- Regression suite (tagged tests)
- Lint + static analysis
- Build validation (no warnings unless explicitly waived)
- Runtime error elimination (no unhandled exceptions in smoke flows)
- Visual validation:
  - screenshot capture
  - screenshot diffing where baseline exists
- Navigation testing (explicit flow scripts)
- Device/browser/responsive checks where relevant
- Post-deploy smoke tests for each deployment target

### How the platform proves “UI was reviewed”

1. Playwright runs the navigation spec and captures screenshots. Playwright explicitly supports screenshot capture (including full-page) and snapshot-based visual comparisons. citeturn16search0turn16search8turn16search4  
2. Store screenshots/videos as artifacts (immutable).
3. Send screenshots to a UI/UX review agent:
   - Codex supports attaching images on CLI (`--image`) and in App Server as input items (including local image paths). citeturn18search1turn18search5turn18search9  
4. The UI/UX review agent outputs a structured verdict:
   - “Pass/Fail”
   - list of broken flows
   - list of visual issues
   - required fixes
5. Gate engine blocks closure until:
   - Playwright suite passes
   - review verdict is “Pass,” or “Fail with accepted exceptions” that the user explicitly waives.

Flaky test handling:
- If failure reproduces <50% across 3 reruns, classify as flaky, open a “stabilize test” task, and block release readiness closure until resolved (but you may allow feature closure with explicit policy).

**14) Security framework**

Policy: security agent + security loop is mandatory.

### Mandatory stages

1. **Threat model notes** (lightweight, but explicit)
   - entry points, data stores, trust boundaries
   - auth/authz model
   - abuse cases and mitigations
2. **Automated scanning**
   - SAST: Semgrep is explicitly a SAST tool and supports CI scanning. citeturn16search6turn16search10  
   - Dependency + vulnerabilities + misconfig + secrets: Trivy can scan filesystem projects for vulnerabilities, misconfigurations, secrets, licenses. citeturn16search7turn16search11  
3. **DAST (baseline)**
   - OWASP ZAP baseline scan runs spider + passive scan and avoids active attacks; designed to run quickly. citeturn16search1turn16search9  
4. **Config + infra review**
   - Dockerfile, IaC defaults, least privilege, ingress exposures.
5. **Remediation loop**
   - Findings become tasks.
   - Scan reruns required after fixes.

### Severity policy (closure rules)

- **Critical/High**: block closure (must fix or explicit waiver with reason + owner + expiration date).
- **Medium**: fix before release readiness; may allow feature completion if isolated.
- **Low/Info**: backlog acceptable, but recorded.

Exception handling:
- Waiver requires:
  - explicit risk statement
  - compensating control
  - revisit date

**15) Deployment framework**

Policy: every project must add deployment planning + validation for:
- local
- Jetson Orin Nano Super
- Azure
- AWS

### Local deployment baseline
- Dockerfile + docker compose
- `.env.example` + secret injection rules
- Smoke tests executed locally as part of gate

### Jetson Orin Nano Super deployment baseline
Constraints:
- ARM64 environment
- JetPack required; JetPack 6.1 supports Jetson Orin Nano Super and MAXN mode. citeturn11search21turn11search0  
- JetPack install/firmware prerequisites exist; JetPack 6.x requires proper firmware and setup per NVIDIA docs. citeturn11search5turn11search1  

Packaging strategy:
- Container images built for `linux/arm64`
- Hardware-dependent verification is split:
  - **Automatable without device**: build ARM64 image, run unit tests in ARM64 container emulation if available.
  - **Hardware-required**: GPU acceleration/perf checks, camera/I/O validation.

### Azure deployment baseline (for user projects)
- Container-based deployment onto Container Apps or equivalent.
- Secrets stored in Key Vault or Container Apps secrets; Container Apps supports referencing secrets in env vars via `secretref:`. citeturn21search2turn21search11  
- Observability via OpenTelemetry exporter.

### AWS deployment baseline (for user projects)
- Serverless default: Lambda + API Gateway (where suited), with DynamoDB for state.
- Lambda free tier includes 1M requests and 400,000 GB-seconds per month. citeturn17search2turn17search10  
- DynamoDB includes an always-free tier with storage and capacity unit allowances (details vary by mode). citeturn17search8turn17search0  

Deployment verification matrix (mandatory artifact)
For each target: “automated / partially automated / manual required,” plus what evidence is attached.

## UI/UX architecture

**16) UI/UX architecture**

The UI has one job: make a terrifyingly complex system feel understandable without lying.

Information architecture (left nav):
- Projects
- Runs
- Artifacts
- Policies
- Admin/Operators (optional)

Key screens (explicit)

### Project list
- Cards with:
  - status (On Track / At Risk / Blocked)
  - last activity timestamp
  - “gates failing” count
  - current milestone

Empty state:
- “Create a project → Upload spec → Generate plan” with a single primary CTA.

### Create project flow
Step 1: Basics  
- name, repo source (local path or git URL), primary tech stack guesses

Step 2: Execution mode  
- Local execution (ChatGPT sign-in) default
- Hosted execution (API key) flagged as advanced

Step 3: Policy profile  
- QA strictness slider (but not optional)
- Security strictness slider (but not optional)
- Deployment targets selection (cannot deselect, only scope verification depth)

### Spec intake screen
- Upload area + paste area
- Live parsing preview (outline)
- “Generate plan” starts planning pipeline
- After plan generation: show “what we inferred / what we injected / what needs decisions”

### Plan review screen
Three-pane layout:
- Left: epic/milestone tree
- Center: selected item details (acceptance criteria, tests, security requirements, deploy requirements)
- Right: “Risks & ambiguities” panel with explicit unresolved decisions

Controls:
- Approve plan version
- Fork plan version
- Edit task descriptions and acceptance criteria
- “Start execution”

### Execution monitoring screen
- Timeline of runs with Symphony phases (preparing workspace → building prompt → streaming → succeeded/failed/timed out) for a selected WorkItem. citeturn3view1  
- Per-agent transcript summary (not raw dumps by default; progressive disclosure)
- Live logs stream
- “Pause project” and “Pause task”
- “Retry task” with reason selector (infra failure vs code failure)

### QA gate screen
- Test matrix: unit/integration/e2e/lint/build
- Last run results + diff from previous
- Flaky test indicator and rerun history
- Screenshot gallery with “AI review verdict” summaries

### Security gate screen
- Findings table with severity, status, linked commits
- One-click “Generate remediation tasks”
- Waiver workflow UI (requires typed justification)

### Deployment matrix screen
Grid:
- rows: local / Jetson / Azure / AWS
- columns: build, deploy, smoke, perf sanity
- each cell indicates: pass/fail/partial/manual
- artifacts linked per cell (logs, screenshots)

### Artifact inspection
- Code diffs (embedded)
- Log viewer with filters
- Screenshot viewer
- Video viewer (for e2e runs)
- “Summarize artifact” action (agent generates a human-readable summary)

### Resume / extend flow
- “Resume last plan version”
- “Fork plan version and extend”
- “Import new spec and diff against current plan”

### Operator/admin visibility
- “All projects” dashboard
- Resource consumption
- Error spikes (Codex errors, backpressure, Symphony failures)
- Audit log search

Visual design direction
- Calm, high-contrast, dense-but-readable
- Progressive disclosure everywhere: show status first, drill into proof.
- Component system: a small set of primitives (StatusPill, GateCard, EvidencePanel, TimelineRunRow) used consistently.

## Delivery plan, deployment mechanics, and backlog

**20) MVP scope**

MVP must prove:
- multi-project isolation
- spec → plan conversion
- execution of tasks via Symphony (with internal tracker shim)
- hard closure gates for QA + security + local deployment
- pause/resume + audit trail
- artifact viewing for logs + test output + screenshots

MVP explicitly can defer:
- full hosted execution
- deep Jetson hardware validation automation (still generate plan + packaging)
- full Azure/AWS auto-deploy for user projects (still generate IaC + partial verification)

**21) Phase 2 / Phase 3 roadmap**

Phase 2:
- Azure deploy verification automation for user projects
- AWS deploy verification automation for user projects
- Visual regression baselining workflow
- Multi-agent role specialization (Codex roles) with controlled workspace locking citeturn24view0  
- Policy packs + template libraries

Phase 3:
- Hosted execution plane (API key mode) with tenant isolation
- Cost/time estimation per epic + forecasting
- Run replay UI
- “Compare two implementation strategies” mode via plan forks + thread forks citeturn6view3  

**22) Implementation plan broken into milestones**

Milestone A: Platform skeleton
- Control plane API + UI scaffolding
- DB schema + audit log

Milestone B: Spec ingestion → PlanVersion
- SpecIR extractor
- Task graph generator
- Policy injection engine (QA/security/deploy always-on)

Milestone C: Symphony integration
- Tracker Shim GraphQL
- Symphony Instance Manager (per-project process supervisor)
- Workspace root isolation + log streaming
- Minimal run state reconciliation

Milestone D: Verification plane
- Standard test runner orchestration
- Playwright screenshots + video capture citeturn16search0turn16search8  
- Security scanning runners (Semgrep + Trivy + ZAP baseline) citeturn16search6turn16search7turn16search1  
- Gate Engine rules (block closure until pass)

Milestone E: Deployment mechanics
- Local deploy pipeline + smoke tests
- Jetson packaging plan generation (ARM64 images, instructions referencing JetPack) citeturn11search21turn11search5  
- Azure and AWS plan generation + partial validation

Milestone F: “One script” platform deployment
- Local: bootstrap script
- Azure: bootstrap provisioning + deploy (Container Apps + Cosmos free tier)

**23) Detailed backlog / epics / tasks**

Epic: Core PM + persistence
- Implement Project/PlanVersion/WorkItem/Run/Artifact/Finding schemas
- Implement dependency DAG and critical-path computation
- Append-only audit events

Epic: Spec → Plan
- Build SpecIR schema + extractor
- Build normalization + ambiguity detection
- Build policy injection packs for QA/security/deploy
- Build plan diff + fork

Epic: Symphony wrapper integration
- Tracker Shim GraphQL (Linear subset)
- State mapping: WorkItem ↔ issue
- Symphony process manager (start/stop/pause/resume)
- Log ingestion + state reconciliation

Epic: QA automation
- Deterministic test runner interface
- Playwright harness (flows + screenshot capture + video)
- Evidence ingestion + UI

Epic: Security automation
- Semgrep runner + parser
- Trivy runner + parser
- ZAP baseline runner + parser
- Finding prioritization + remediation task generation

Epic: Deployment automation (generated-by-default)
- Local deployment generator (Dockerfile/compose) + smoke tests
- Jetson deploy plan generator (ARM64 build + JetPack instructions) citeturn11search21  
- Azure deploy plan generator
- AWS deploy plan generator

Epic: UX polish
- Project dashboard
- Gate dashboards
- Artifact viewers
- Resume/extend/fork flows
- Operator overview

**24) Recommended tech stack**

Control plane:
- TypeScript + Node.js API (Fastify/Nest)
- Next.js (React) UI
- SSE for streaming + optional WebSocket for local runner coordination

Persistence:
- Local: SQLite (single-file, easiest)
- Azure: Cosmos DB NoSQL (free tier 1000 RU/s at account level; design for shared database throughput) citeturn11search2turn11search10  
- AWS: DynamoDB (optional), or keep it local-first and treat AWS deploy as single-tenant.

Artifact store:
- Local filesystem by default
- Azure Blob / AWS S3 in later phases (not required for MVP)

Execution:
- Runner daemon (Node or Go) that spawns Symphony + verification jobs
- Container-first runners for deterministic builds where possible

**Seamless “single script” deployment of the platform (local + Azure)**

### Local `./deploy.sh local`
- Prereqs:
  - Docker installed (or provide native mode later)
  - Codex CLI installed and user logged in via ChatGPT sign-in citeturn5view2turn5view0  
- Steps:
  1. Clone this platform repo
  2. Clone Symphony repo into `vendor/symphony` (or update it)
  3. Build platform containers
  4. Start:
     - Control plane
     - Runner
     - Tracker Shim
     - Symphony per project (on demand)

### Azure `./deploy.sh azure`
Provision:
- Azure Container Apps (consumption, leverages free grant) citeturn22search2turn22search14  
- Cosmos DB free tier enabled at account creation (1000 RU/s + 25 GB) citeturn11search2turn11search22  

Important constraint:
- Cosmos free tier is one account per Azure subscription and must be opted in at creation. citeturn11search22turn11search10  

Execution consideration:
- In Azure mode, default to “control plane hosted, execution local.” Hosted execution via ChatGPT login is not a safe default for multi-user, and API-key hosted execution should be explicit opt-in. citeturn13view0turn5view0  

**25) Key risks and mitigations**

Risk: Hosted subscription-first execution violates account rules / security expectations  
Mitigation: local-first runner; hosted execution requires API keys and tenant isolation. citeturn13view0turn5view0  

Risk: Agents prematurely mark tasks done  
Mitigation: server-side policy in tracker shim; only control plane token can set terminal states.

Risk: Cross-project contamination (files, prompts, config)  
Mitigation: per-project workspace roots enforced by Symphony invariants; per-project config layers; store per-run thread IDs; avoid shared writable roots. citeturn3view4turn20view1  

Risk: Sandbox weaknesses in container environments  
Mitigation: rely on container isolation when kernel sandbox is unavailable; follow Codex guidance. citeturn15view1  

Risk: Jetson verification requires real hardware  
Mitigation: explicitly mark which validations are hardware-dependent; run what can be automated (ARM64 build/test) and require operator confirmation for the rest. citeturn11search21turn11search5  

**27) Open questions that must be resolved before implementation**

- Where should the “runner daemon” live in your product packaging: standalone binary, dockerized, or embedded desktop app?
- Do you want the platform to manage git repos internally (worktrees/branches), or require the user to provide an existing repo path?
- What’s the minimum acceptable automated verification on Jetson for MVP (likely “build + container start + basic smoke” only)?
- Which languages/frameworks are in-scope for first QA/security baseline packs (Node/TS + Python is usually the pragmatic start)?
- Do you want to ingest Symphony’s internal state via its optional JSON API, or treat Symphony as black-box logs only? citeturn4view0