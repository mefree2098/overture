"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  Boxes,
  CloudUpload,
  Cpu,
  FileClock,
  Radar,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { PlanWorkbench } from "@/components/plan-workbench";
import { StatusPill } from "@/components/status-pill";
import type {
  ArtifactRecord,
  GateVerdict,
  ProjectSnapshot,
} from "@/lib/types";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object") as Record<string, unknown>[]
    : [];
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function GateCard({
  label,
  status,
  description,
}: {
  label: string;
  status: GateVerdict;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            {label}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{description}</p>
        </div>
        <StatusPill status={status} />
      </div>
    </div>
  );
}

function RuntimeMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric-card rounded-[26px] p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-[var(--color-ink)]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{detail}</p>
    </div>
  );
}

function ArtifactPreview({ artifact }: { artifact: ArtifactRecord }) {
  const href = `/api/artifacts/${artifact.id}`;

  return (
    <Link
      href={href}
      target="_blank"
      className="rounded-[24px] border border-white/8 bg-white/4 p-4 transition hover:border-[var(--color-accent)] hover:bg-white/6"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
        {artifact.kind}
      </p>
      <p className="mt-2 text-base font-semibold text-[var(--color-ink)]">{artifact.label}</p>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Created {formatRelativeTime(artifact.createdAt)}
      </p>
      {artifact.mimeType.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={href}
          alt={artifact.label}
          className="mt-4 h-40 w-full rounded-2xl object-cover"
        />
      ) : null}
    </Link>
  );
}

function IssueCluster({
  label,
  description,
  issues,
}: {
  label: string;
  description: string;
  issues: ProjectSnapshot["trackerIssues"];
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            {label}
          </p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{description}</p>
        </div>
        <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
          {issues.length}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {issues.length ? (
          issues.slice(0, 6).map((issue) => (
            <div key={issue.id} className="rounded-[20px] border border-white/8 bg-white/4 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                    {issue.identifier}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                    {issue.title}
                  </p>
                </div>
                <StatusPill status={issue.stateName} />
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-[var(--color-muted)]">No issues in this slice.</p>
        )}
      </div>
    </div>
  );
}

export function ProjectLiveShell({ initialSnapshot }: { initialSnapshot: ProjectSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const openFindings = snapshot.findings.filter(
    (finding) => !["resolved", "accepted_risk"].includes(finding.status),
  );
  const activeIssues = snapshot.trackerIssues.filter((issue) =>
    ["Todo", "In Progress"].includes(issue.stateName),
  );
  const reviewIssues = snapshot.trackerIssues.filter((issue) => issue.stateName === "Review");
  const blockedIssues = snapshot.trackerIssues.filter((issue) => issue.stateName === "Blocked");

  const symphonyState = asRecord(snapshot.symphony?.state);
  const symphonyCounts = asRecord(symphonyState?.counts);
  const symphonySessions = asArray(symphonyState?.running);
  const symphonyRetryQueue = asArray(symphonyState?.retrying);
  const codexTotals = asRecord(symphonyState?.codex_totals);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/projects/${snapshot.project.id}/snapshot`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as ProjectSnapshot;
      setSnapshot(data);
    }, 4000);

    return () => {
      window.clearInterval(interval);
    };
  }, [snapshot.project.id]);

  function runExecution() {
    setRunning(true);

    startTransition(async () => {
      try {
        await fetch(`/api/projects/${snapshot.project.id}/execute`, {
          method: "POST",
        });

        const refresh = await fetch(`/api/projects/${snapshot.project.id}/snapshot`, {
          cache: "no-store",
        });

        if (refresh.ok) {
          setSnapshot((await refresh.json()) as ProjectSnapshot);
        }
      } finally {
        setRunning(false);
      }
    });
  }

  function deleteCurrentProject() {
    const confirmed = window.confirm(
      `Delete "${snapshot.project.name}" and all stored runs, artifacts, tracker data, and Symphony runtime files? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}`, {
          method: "DELETE",
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to delete project.");
        }

        router.push("/");
        router.refresh();
      } catch (error) {
        setDeleteError(
          error instanceof Error ? error.message : "Failed to delete project.",
        );
      } finally {
        setDeleting(false);
      }
    });
  }

  const deploymentRows = [
    {
      target: "local",
      build: snapshot.gateStatus.deployStatus === "pass" ? "pass" : "pending",
      deploy: snapshot.gateStatus.deployStatus,
      smoke: snapshot.gateStatus.deployStatus === "pass" ? "pass" : "pending",
      perf: "partial" as GateVerdict,
    },
    {
      target: "jetson",
      build: snapshot.artifacts.some((artifact) => artifact.label.toLowerCase().includes("jetson"))
        ? "pass"
        : "partial",
      deploy: "partial" as GateVerdict,
      smoke: "pending" as GateVerdict,
      perf: "pending" as GateVerdict,
    },
    {
      target: "azure",
      build: snapshot.artifacts.some((artifact) => artifact.label.toLowerCase().includes("azure"))
        ? "pass"
        : "partial",
      deploy: "partial" as GateVerdict,
      smoke: "pending" as GateVerdict,
      perf: "pending" as GateVerdict,
    },
    {
      target: "aws",
      build: snapshot.artifacts.some((artifact) => artifact.label.toLowerCase().includes("aws"))
        ? "pass"
        : "partial",
      deploy: "partial" as GateVerdict,
      smoke: "pending" as GateVerdict,
      perf: "pending" as GateVerdict,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="panel halo-ring rounded-[36px] p-6 lg:p-8">
        <div className="grid gap-8 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={snapshot.project.health} />
              <StatusPill status={snapshot.gateStatus.releaseStatus} />
              <StatusPill status={snapshot.project.executionMode} />
              <StatusPill status={snapshot.symphony?.running ? "in_progress" : "pending"} />
            </div>

            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-muted)]">
                Project cockpit
              </p>
              <h1 className="holo-text max-w-4xl text-balance text-5xl font-semibold text-[var(--color-ink)] lg:text-6xl">
                {snapshot.project.name}
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-[var(--color-muted)]">
                {snapshot.planVersion?.specIr.summary}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <RuntimeMetric
                label="Current milestone"
                value={snapshot.currentMilestone ?? "Release"}
                detail="Primary execution bundle currently leading the graph."
              />
              <RuntimeMetric
                label="Tasks closed"
                value={`${snapshot.counts.done + snapshot.counts.waived}/${snapshot.workItems.length}`}
                detail="Closed or waived items across the canonical plan."
              />
              <RuntimeMetric
                label="Active queue"
                value={String(activeIssues.length)}
                detail="Todo or in-flight tracker issues visible to Symphony."
              />
              <RuntimeMetric
                label="Last activity"
                value={formatRelativeTime(snapshot.project.lastActivityAt)}
                detail="Latest control-plane update touching the project."
              />
            </div>
          </div>

          <aside className="panel-grid rounded-[30px] border border-[var(--color-border)] bg-[rgba(5,16,31,0.56)] p-5">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
                    Symphony core
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-[var(--color-ink)]">
                    {snapshot.symphony?.running ? "Runtime live" : "Runtime dormant"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                    Launch or refresh the real Symphony runtime wired to the project tracker bridge.
                  </p>
                </div>
                <Cpu className="h-6 w-6 text-[var(--color-accent)]" />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={running || deleting}
                  onClick={runExecution}
                  className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Activity className="h-4 w-4" />
                  {running
                    ? "Launching Symphony..."
                    : snapshot.symphony?.running
                      ? "Refresh Symphony"
                      : "Launch Symphony"}
                </button>
                <button
                  type="button"
                  disabled={running || deleting}
                  onClick={deleteCurrentProject}
                  className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,123,123,0.32)] bg-[rgba(255,92,92,0.08)] px-5 py-3 text-sm font-semibold text-[var(--color-danger)] transition hover:bg-[rgba(255,92,92,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Deleting project..." : "Delete project"}
                </button>
              </div>
              {deleteError ? (
                <p className="text-sm text-[var(--color-danger)]">{deleteError}</p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    Sessions
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                    {asNumber(symphonyCounts?.running)}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    Retry queue
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                    {asNumber(symphonyCounts?.retrying)}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    PID / Port
                  </p>
                  <p className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {snapshot.symphony ? `${snapshot.symphony.pid} / ${snapshot.symphony.port}` : "n/a"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    Token total
                  </p>
                  <p className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {asNumber(codexTotals?.total_tokens).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    Runtime surfaces
                  </p>
                  {snapshot.symphony?.stateUrl ? (
                    <Link
                      href={snapshot.symphony.stateUrl}
                      target="_blank"
                      className="text-xs text-[var(--color-accent)]"
                    >
                      Open JSON
                    </Link>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
                  <p>{snapshot.project.repoSource}</p>
                  <p>{snapshot.symphony?.workflowPath ?? "WORKFLOW.md not generated yet."}</p>
                </div>
              </div>

              <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                <div className="flex items-center gap-2">
                  <TerminalSquare className="h-4 w-4 text-[var(--color-accent)]" />
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    Bootstrap tail
                  </p>
                </div>
                <div className="fine-scrollbar mt-3 max-h-[180px] overflow-auto rounded-[18px] bg-[rgba(3,7,16,0.72)] p-3 font-mono text-xs leading-6 text-[var(--color-muted)]">
                  {snapshot.symphony?.bootstrapTail.length ? (
                    snapshot.symphony.bootstrapTail.map((line, index) => (
                      <p key={`${index}-${line}`}>{line}</p>
                    ))
                  ) : (
                    <p>No Symphony bootstrap log captured yet.</p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <div className="metric-card rounded-[30px] p-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-[var(--color-success)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                QA
              </p>
              <p className="text-lg font-semibold text-[var(--color-ink)]">
                {snapshot.gateStatus.qaStatus.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
        <div className="metric-card rounded-[30px] p-5">
          <div className="flex items-center gap-3">
            <TriangleAlert className="h-5 w-5 text-[var(--color-warning)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Security
              </p>
              <p className="text-lg font-semibold text-[var(--color-ink)]">
                {snapshot.gateStatus.securityStatus.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
        <div className="metric-card rounded-[30px] p-5">
          <div className="flex items-center gap-3">
            <CloudUpload className="h-5 w-5 text-[var(--color-info)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Deployment
              </p>
              <p className="text-lg font-semibold text-[var(--color-ink)]">
                {snapshot.gateStatus.deployStatus.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
        <div className="metric-card rounded-[30px] p-5">
          <div className="flex items-center gap-3">
            <Boxes className="h-5 w-5 text-[var(--color-magenta)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Artifacts
              </p>
              <p className="text-lg font-semibold text-[var(--color-ink)]">
                {snapshot.artifacts.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="panel rounded-[30px] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Tracker constellation
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                Live issue distribution
              </h2>
            </div>
            <Radar className="h-5 w-5 text-[var(--color-accent)]" />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <IssueCluster
              label="Active"
              description="Todo and in-progress issues visible to Symphony."
              issues={activeIssues}
            />
            <IssueCluster
              label="Review"
              description="Issues completed by Codex and waiting for Overture close-out."
              issues={reviewIssues}
            />
            <IssueCluster
              label="Blocked"
              description="Blocked issues, either due to dependencies or runtime constraints."
              issues={blockedIssues}
            />
          </div>
        </div>

        <div className="panel rounded-[30px] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Symphony sessions
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                Active runtime threads
              </h2>
            </div>
            <Bot className="h-5 w-5 text-[var(--color-accent)]" />
          </div>

          <div className="mt-5 space-y-3">
            {symphonySessions.length ? (
              symphonySessions.map((entry, index) => (
                <div
                  key={`${asString(entry.issue_identifier)}-${index}`}
                  className="rounded-[24px] border border-white/8 bg-white/4 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                        {asString(entry.issue_identifier) || "Issue"}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                        {asString(entry.state) || "In Progress"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill status="in_progress" />
                      <span className="rounded-full border border-white/8 bg-white/4 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                        {asNumber(entry.turn_count)} turns
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                    {asString(entry.last_message) || "Awaiting the latest Codex event."}
                  </p>
                  <p className="mt-3 text-xs text-[var(--color-muted)]">
                    Tokens: {asNumber(asRecord(entry.tokens)?.total_tokens).toLocaleString()}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-[var(--color-border)] bg-white/4 p-6 text-sm text-[var(--color-muted)]">
                No active Symphony sessions yet. Launch the runtime to start processing tracker
                issues.
              </div>
            )}

            <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
              <div className="flex items-center gap-2">
                <FileClock className="h-4 w-4 text-[var(--color-magenta)]" />
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Retry queue
                </p>
              </div>
              <div className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
                {symphonyRetryQueue.length ? (
                  symphonyRetryQueue.map((entry, index) => (
                    <div
                      key={`${asString(entry.issue_identifier)}-${index}`}
                      className="rounded-[18px] border border-white/8 bg-white/4 p-3"
                    >
                      <p className="font-semibold text-[var(--color-ink)]">
                        {asString(entry.issue_identifier)}
                      </p>
                      <p className="mt-1">{asString(entry.error) || "Backoff pending"}</p>
                    </div>
                  ))
                ) : (
                  <p>No issues are currently backing off.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            Plan lattice
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--color-ink)]">
            Dependency-aware delivery graph
          </h2>
        </div>
        <PlanWorkbench
          workItems={snapshot.workItems}
          dependencyEdges={snapshot.dependencyEdges}
          planVersion={snapshot.planVersion}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.98fr_1.02fr]">
        <div className="space-y-4">
          <div className="panel rounded-[30px] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Gate dashboards
            </p>
            <div className="mt-4 grid gap-3">
              <GateCard
                label="QA gate"
                status={snapshot.gateStatus.qaStatus}
                description="Unit, integration, e2e, lint, build, runtime, and screenshot evidence."
              />
              <GateCard
                label="Security gate"
                status={snapshot.gateStatus.securityStatus}
                description="Threat notes, SAST, dependency scan, secrets scan, and DAST baseline."
              />
              <GateCard
                label="Deployment gate"
                status={snapshot.gateStatus.deployStatus}
                description="Local smoke validation plus Jetson, Azure, and AWS planning evidence."
              />
              <GateCard
                label="Release gate"
                status={snapshot.gateStatus.releaseStatus}
                description="Final closure blocker that only opens when the mandatory gates pass."
              />
            </div>
          </div>

          <div className="panel rounded-[30px] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Findings
            </p>
            <div className="mt-4 space-y-3">
              {openFindings.length ? (
                openFindings.slice(0, 8).map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-[24px] border border-white/8 bg-white/4 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">
                        {finding.title}
                      </p>
                      <StatusPill status={finding.severity} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                      {finding.detail}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-[var(--color-border)] bg-white/4 p-6 text-sm text-[var(--color-muted)]">
                  No open findings. Remaining work is execution and evidence accumulation.
                </div>
              )}
            </div>
          </div>

          <div className="panel rounded-[30px] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Deployment matrix
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                  Target proof grid
                </h2>
              </div>
              <CloudUpload className="h-5 w-5 text-[var(--color-info)]" />
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-3 text-left">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    <th className="px-4">Target</th>
                    <th className="px-4">Build</th>
                    <th className="px-4">Deploy</th>
                    <th className="px-4">Smoke</th>
                    <th className="px-4">Perf</th>
                  </tr>
                </thead>
                <tbody>
                  {deploymentRows.map((row) => (
                    <tr key={row.target} className="rounded-[24px] bg-white/4">
                      <td className="rounded-l-[20px] px-4 py-4 font-semibold text-[var(--color-ink)]">
                        {row.target}
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill status={row.build} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill status={row.deploy} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill status={row.smoke} />
                      </td>
                      <td className="rounded-r-[20px] px-4 py-4">
                        <StatusPill status={row.perf} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel rounded-[30px] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Artifact vault
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                  Evidence and outputs
                </h2>
              </div>
              <Sparkles className="h-5 w-5 text-[var(--color-magenta)]" />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {snapshot.artifacts.slice(0, 6).map((artifact) => (
                <ArtifactPreview key={artifact.id} artifact={artifact} />
              ))}
            </div>
          </div>

          <div className="panel rounded-[30px] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Spec intake
            </p>
            <div className="mt-4 rounded-[24px] border border-white/8 bg-white/4 p-4">
              <p className="font-semibold text-[var(--color-ink)]">
                {snapshot.specDocument?.filename ?? "Source plan"}
              </p>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Hash: {snapshot.specDocument?.contentHash.slice(0, 16)}...
              </p>
              {snapshot.specDocument ? (
                <div className="fine-scrollbar mt-4 max-h-[360px] overflow-auto">
                  <MarkdownRenderer content={snapshot.specDocument.content.slice(0, 5000)} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel rounded-[30px] p-5" id="operator-view">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Audit trail
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                  Control-plane events
                </h2>
              </div>
              <Activity className="h-5 w-5 text-[var(--color-accent)]" />
            </div>
            <div className="mt-4 space-y-3">
              {snapshot.auditEvents.slice(0, 10).map((event) => (
                <div
                  key={event.id}
                  className="rounded-[24px] border border-white/8 bg-white/4 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                        {event.action}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-[var(--color-ink)]">
                        {event.detail}
                      </p>
                    </div>
                    <StatusPill status={event.actor} />
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    {formatDateTime(event.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
