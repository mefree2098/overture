"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileClock,
  PlayCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PlanWorkbench } from "@/components/plan-workbench";
import { StatusPill } from "@/components/status-pill";
import type {
  ArtifactRecord,
  GateVerdict,
  ProjectSnapshot,
} from "@/lib/types";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

type ProjectTab = "overview" | "plan" | "runtime" | "evidence";

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

function MetricCard({
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
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
            {label}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{description}</p>
        </div>
        <StatusPill status={status} />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]"
          : "border-[var(--color-border)] bg-white/6 text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
    </button>
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

function IssueList({
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
            {label}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{description}</p>
        </div>
        <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          {issues.length}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {issues.length ? (
          issues.slice(0, 6).map((issue) => (
            <div key={issue.id} className="rounded-[20px] border border-white/8 bg-white/4 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
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
          <p className="text-sm text-[var(--color-muted)]">Nothing in this group right now.</p>
        )}
      </div>
    </div>
  );
}

function NextStepCard({
  title,
  detail,
  tone = "normal",
}: {
  title: string;
  detail: string;
  tone?: "normal" | "warning" | "success";
}) {
  const icon =
    tone === "warning" ? (
      <AlertTriangle className="h-5 w-5 text-[var(--color-warning)]" />
    ) : tone === "success" ? (
      <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
    ) : (
      <PlayCircle className="h-5 w-5 text-[var(--color-accent)]" />
    );

  return (
    <div className="rounded-[28px] border border-white/8 bg-white/4 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-1">{icon}</div>
        <div>
          <p className="text-base font-semibold text-[var(--color-ink)]">{title}</p>
          <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function nextStepForProject({
  symphonyRunning,
  openFindings,
  blockedIssues,
  releaseStatus,
  activeIssues,
}: {
  symphonyRunning: boolean;
  openFindings: number;
  blockedIssues: number;
  releaseStatus: GateVerdict;
  activeIssues: number;
}) {
  if (!symphonyRunning) {
    return {
      title: "Step 1: start the project run",
      detail:
        "Launch Symphony to begin working through the plan. You can review the draft plan first if you want.",
      tone: "normal" as const,
    };
  }

  if (blockedIssues > 0) {
    return {
      title: "A few tickets are blocked",
      detail:
        "Open the Runtime tab to see which tickets are blocked and what Symphony has already reported.",
      tone: "warning" as const,
    };
  }

  if (openFindings > 0) {
    return {
      title: "Review the open findings",
      detail:
        "There are unresolved QA, security, or deployment findings that still need attention before final release.",
      tone: "warning" as const,
    };
  }

  if (releaseStatus === "pass") {
    return {
      title: "Project passed the release gate",
      detail:
        "All mandatory checks have passed. You can review the evidence tab for the final record.",
      tone: "success" as const,
    };
  }

  if (activeIssues > 0) {
    return {
      title: "The project is currently running",
      detail:
        "Overture is tracking active work items. Check the Runtime tab for live execution details or the Overview tab for gate progress.",
      tone: "normal" as const,
    };
  }

  return {
    title: "Plan review is ready",
    detail: "Review the plan tab, then launch the run whenever you are ready.",
    tone: "normal" as const,
  };
}

export function ProjectLiveShell({ initialSnapshot }: { initialSnapshot: ProjectSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activeTab, setActiveTab] = useState<ProjectTab>("overview");
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
  const completedTasks = snapshot.counts.done + snapshot.counts.waived;

  const symphonyState = asRecord(snapshot.symphony?.state);
  const symphonyCounts = asRecord(symphonyState?.counts);
  const symphonySessions = asArray(symphonyState?.running);
  const symphonyRetryQueue = asArray(symphonyState?.retrying);
  const codexTotals = asRecord(symphonyState?.codex_totals);
  const nextStep = nextStepForProject({
    symphonyRunning: Boolean(snapshot.symphony?.running),
    openFindings: openFindings.length,
    blockedIssues: blockedIssues.length,
    releaseStatus: snapshot.gateStatus.releaseStatus,
    activeIssues: activeIssues.length,
  });

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/projects/${snapshot.project.id}/snapshot`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      setSnapshot((await response.json()) as ProjectSnapshot);
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
      target: "Local",
      build: snapshot.gateStatus.deployStatus === "pass" ? "pass" : "pending",
      deploy: snapshot.gateStatus.deployStatus,
      smoke: snapshot.gateStatus.deployStatus === "pass" ? "pass" : "pending",
      perf: "partial" as GateVerdict,
    },
    {
      target: "Jetson",
      build: snapshot.artifacts.some((artifact) => artifact.label.toLowerCase().includes("jetson"))
        ? "pass"
        : "partial",
      deploy: "partial" as GateVerdict,
      smoke: "pending" as GateVerdict,
      perf: "pending" as GateVerdict,
    },
    {
      target: "Azure",
      build: snapshot.artifacts.some((artifact) => artifact.label.toLowerCase().includes("azure"))
        ? "pass"
        : "partial",
      deploy: "partial" as GateVerdict,
      smoke: "pending" as GateVerdict,
      perf: "pending" as GateVerdict,
    },
    {
      target: "AWS",
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
        <div className="grid gap-8 xl:grid-cols-[1.04fr_0.96fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={snapshot.project.health} />
              <StatusPill status={snapshot.gateStatus.releaseStatus} />
              <StatusPill status={snapshot.project.executionMode} />
              <StatusPill status={snapshot.symphony?.running ? "in_progress" : "pending"} />
            </div>

            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--color-accent)]">
                Project overview
              </p>
              <h1 className="text-balance text-5xl font-semibold text-[var(--color-ink)] lg:text-6xl">
                {snapshot.project.name}
              </h1>
              <p className="max-w-3xl text-base leading-8 text-[var(--color-muted)]">
                {snapshot.planVersion?.specIr.summary}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Completed"
                value={`${completedTasks}/${snapshot.workItems.length}`}
                detail="Tasks closed or waived across the plan."
              />
              <MetricCard
                label="Active tickets"
                value={String(activeIssues.length)}
                detail="Tickets currently queued or in progress."
              />
              <MetricCard
                label="Open findings"
                value={String(openFindings.length)}
                detail="Issues that still need follow-up before release."
              />
              <MetricCard
                label="Last update"
                value={formatRelativeTime(snapshot.project.lastActivityAt)}
                detail="Latest activity recorded by Overture."
              />
            </div>
          </div>

          <aside className="space-y-4">
            <div className="panel rounded-[30px] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                    Next step
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-[var(--color-ink)]">
                    {snapshot.symphony?.running ? "Runtime live" : "Ready to launch"}
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    {snapshot.symphony?.running
                      ? "Symphony is attached and Overture is polling it continuously."
                      : "Launch Symphony when you are ready to move from planning into execution."}
                  </p>
                </div>
                <Cpu className="h-6 w-6 text-[var(--color-accent)]" />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={running || deleting}
                  onClick={runExecution}
                  className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {running ? (
                    <Activity className="h-4 w-4 animate-pulse" />
                  ) : (
                    <PlayCircle className="h-4 w-4" />
                  )}
                  {running
                    ? "Starting Symphony..."
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
                <p className="mt-3 text-sm text-[var(--color-danger)]">{deleteError}</p>
              ) : null}
            </div>

            <NextStepCard
              title={nextStep.title}
              detail={nextStep.detail}
              tone={nextStep.tone}
            />

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-xl font-semibold text-[var(--color-ink)]">
                Project settings used for this run
              </h2>
              <div className="mt-4 grid gap-3 text-sm text-[var(--color-muted)] sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Planning model</p>
                  <p className="mt-2">{snapshot.project.plannerModel ?? "Codex default"}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Execution model</p>
                  <p className="mt-2">{snapshot.project.executionModel ?? "Codex default"}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Planning depth</p>
                  <p className="mt-2">{snapshot.project.plannerReasoningEffort}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Parallel agents / turns</p>
                  <p className="mt-2">
                    {snapshot.project.symphonyMaxConcurrentAgents} / {snapshot.project.symphonyMaxTurns}
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="panel rounded-[30px] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <TabButton
            active={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            label="Overview"
          />
          <TabButton
            active={activeTab === "plan"}
            onClick={() => setActiveTab("plan")}
            label="Plan"
          />
          <TabButton
            active={activeTab === "runtime"}
            onClick={() => setActiveTab("runtime")}
            label="Runtime"
          />
          <TabButton
            active={activeTab === "evidence"}
            onClick={() => setActiveTab("evidence")}
            label="Evidence"
          />
        </div>
      </section>

      {activeTab === "overview" ? (
        <section className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <GateCard
              label="QA gate"
              status={snapshot.gateStatus.qaStatus}
              description="Unit, integration, end-to-end, build, and validation evidence."
            />
            <GateCard
              label="Security gate"
              status={snapshot.gateStatus.securityStatus}
              description="Security scans, dependency checks, secrets review, and baseline runtime coverage."
            />
            <GateCard
              label="Deployment gate"
              status={snapshot.gateStatus.deployStatus}
              description="Local deployment proof plus platform deployment planning evidence."
            />
            <GateCard
              label="Release gate"
              status={snapshot.gateStatus.releaseStatus}
              description="Final closure gate that opens only when the other required checks pass."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <IssueList
              label="Queued or active"
              description="Tickets ready to work or already in motion."
              issues={activeIssues}
            />
            <IssueList
              label="Needs review"
              description="Tickets that Symphony has moved to review."
              issues={reviewIssues}
            />
            <IssueList
              label="Blocked"
              description="Tickets waiting on a blocker or unresolved dependency."
              issues={blockedIssues}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="panel rounded-[30px] p-6">
              <div className="flex items-start gap-4">
                <ShieldCheck className="mt-1 h-5 w-5 text-[var(--color-success)]" />
                <div>
                  <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                    Findings summary
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    Overture keeps the open items here so you can quickly see whether release is
                    blocked.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {openFindings.length ? (
                  openFindings.slice(0, 8).map((finding) => (
                    <div
                      key={finding.id}
                      className="rounded-[22px] border border-white/8 bg-white/4 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                            {finding.category} / {finding.severity}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                            {finding.title}
                          </p>
                        </div>
                        <StatusPill status={finding.status} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                        {finding.detail}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]">
                    No open findings right now.
                  </div>
                )}
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <div className="flex items-start gap-4">
                <Boxes className="mt-1 h-5 w-5 text-[var(--color-accent)]" />
                <div>
                  <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                    Project basics
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    The core execution settings and paths captured when this project was created.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Repo source</p>
                  <p className="mt-2 break-all text-sm text-[var(--color-muted)]">
                    {snapshot.project.repoSource}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Current milestone</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {snapshot.currentMilestone ?? "All planned milestones are complete."}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">QA / Security strictness</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {snapshot.project.qaStrictness} / {snapshot.project.securityStrictness}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Created</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {formatDateTime(snapshot.project.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "plan" ? (
        <section className="space-y-4">
          <div className="panel rounded-[30px] p-6">
            <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Plan review</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
              Review the milestone tree, acceptance criteria, dependencies, risks, and injected
              gates before or during execution.
            </p>
          </div>
          <PlanWorkbench
            workItems={snapshot.workItems}
            dependencyEdges={snapshot.dependencyEdges}
            planVersion={snapshot.planVersion}
          />
        </section>
      ) : null}

      {activeTab === "runtime" ? (
        <section className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Running sessions"
              value={String(asNumber(symphonyCounts?.running))}
              detail="Symphony sessions currently executing."
            />
            <MetricCard
              label="Retry queue"
              value={String(asNumber(symphonyCounts?.retrying))}
              detail="Tickets waiting for retry."
            />
            <MetricCard
              label="PID / Port"
              value={
                snapshot.symphony
                  ? `${snapshot.symphony.pid} / ${snapshot.symphony.port}`
                  : "Not started"
              }
              detail="Local Symphony runtime details."
            />
            <MetricCard
              label="Codex turns"
              value={String(asNumber(codexTotals?.turns))}
              detail="Turn count reported by Symphony so far."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                Runtime surfaces
              </h2>
              <div className="mt-5 space-y-3 text-sm text-[var(--color-muted)]">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">State URL</p>
                  <p className="mt-2 break-all">
                    {snapshot.symphony?.stateUrl ?? "Not available until Symphony starts."}
                  </p>
                  {snapshot.symphony?.stateUrl ? (
                    <Link
                      href={snapshot.symphony.stateUrl}
                      target="_blank"
                      className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--color-accent)]"
                    >
                      Open state endpoint
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Workflow file</p>
                  <p className="mt-2 break-all">
                    {snapshot.symphony?.workflowPath ?? "Not available yet."}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Bootstrap log</p>
                  <p className="mt-2 break-all">
                    {snapshot.symphony?.bootstrapLogPath ?? "Not available yet."}
                  </p>
                </div>
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Bootstrap log</h2>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-[rgba(2,8,18,0.78)] p-4">
                <pre className="fine-scrollbar max-h-[360px] overflow-auto whitespace-pre-wrap text-sm leading-7 text-[var(--color-muted)]">
                  {snapshot.symphony?.bootstrapTail.length
                    ? snapshot.symphony.bootstrapTail.join("\n")
                    : "No runtime log yet. Launch Symphony to start capturing bootstrap output."}
                </pre>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                Active Symphony sessions
              </h2>
              <div className="mt-5 space-y-3">
                {symphonySessions.length ? (
                  symphonySessions.map((session, index) => (
                    <div
                      key={`${asString(session.issue_id)}-${index}`}
                      className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]"
                    >
                      <p className="font-semibold text-[var(--color-ink)]">
                        {asString(session.issue_identifier) || asString(session.issue_id) || "Session"}
                      </p>
                      <p className="mt-2">Run id: {asString(session.run_id) || "n/a"}</p>
                      <p>Thread id: {asString(session.thread_id) || "n/a"}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]">
                    No live sessions are reported right now.
                  </div>
                )}
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Retry queue</h2>
              <div className="mt-5 space-y-3">
                {symphonyRetryQueue.length ? (
                  symphonyRetryQueue.map((item, index) => (
                    <div
                      key={`${asString(item.issue_id)}-${index}`}
                      className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]"
                    >
                      <p className="font-semibold text-[var(--color-ink)]">
                        {asString(item.issue_identifier) || asString(item.issue_id) || "Retry item"}
                      </p>
                      <p className="mt-2">
                        Attempts: {asNumber(item.attempts)} / {asNumber(item.max_attempts)}
                      </p>
                      <p>Next retry: {asString(item.next_retry_at) || "n/a"}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]">
                    Nothing is queued for retry.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "evidence" ? (
        <section className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
            <div className="panel rounded-[30px] p-6">
              <div className="flex items-start gap-4">
                <FileClock className="mt-1 h-5 w-5 text-[var(--color-accent)]" />
                <div>
                  <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                    Source plan
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    The file Overture used to create this project.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Filename</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {snapshot.specDocument?.filename ?? "Unknown"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Content hash</p>
                  <p className="mt-2 break-all text-sm text-[var(--color-muted)]">
                    {snapshot.specDocument?.contentHash ?? "Unknown"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 sm:col-span-2">
                  <p className="font-semibold text-[var(--color-ink)]">Summary</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    {snapshot.planVersion?.specIr.summary}
                  </p>
                </div>
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                Deployment proof matrix
              </h2>
              <div className="mt-5 overflow-hidden rounded-[24px] border border-white/8">
                <table className="min-w-full text-left text-sm text-[var(--color-muted)]">
                  <thead className="bg-white/6 text-[var(--color-ink)]">
                    <tr>
                      <th className="px-4 py-3">Target</th>
                      <th className="px-4 py-3">Build</th>
                      <th className="px-4 py-3">Deploy</th>
                      <th className="px-4 py-3">Smoke</th>
                      <th className="px-4 py-3">Perf sanity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deploymentRows.map((row) => (
                      <tr key={row.target} className="border-t border-white/8 bg-white/4">
                        <td className="px-4 py-3 font-semibold text-[var(--color-ink)]">
                          {row.target}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={row.build} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={row.deploy} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={row.smoke} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={row.perf} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="panel rounded-[30px] p-6">
            <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Artifacts</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
              Evidence files generated during planning and execution.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {snapshot.artifacts.length ? (
                snapshot.artifacts.map((artifact) => (
                  <ArtifactPreview key={artifact.id} artifact={artifact} />
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-white/3 p-6 text-sm text-[var(--color-muted)]">
                  No artifacts have been stored yet.
                </div>
              )}
            </div>
          </div>

          <div className="panel rounded-[30px] p-6">
            <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Audit trail</h2>
            <div className="mt-5 space-y-3">
              {snapshot.auditEvents.length ? (
                snapshot.auditEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-[22px] border border-white/8 bg-white/4 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                          {event.actor} / {event.action}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                          {event.detail}
                        </p>
                      </div>
                      <span className="text-sm text-[var(--color-muted)]">
                        {formatDateTime(event.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]">
                  No audit events yet.
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
