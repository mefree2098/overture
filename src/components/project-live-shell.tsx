"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileClock,
  PlayCircle,
  Rocket,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PlanWorkbench } from "@/components/plan-workbench";
import { StatusPill } from "@/components/status-pill";
import { codexReasoningEffortLabel } from "@/lib/codex-reasoning";
import type {
  ArtifactRecord,
  GateVerdict,
  ProjectSnapshot,
} from "@/lib/types";
import { formatDateTime, formatRelativeTime, stripAnsi } from "@/lib/utils";

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

function totalTokens(value: unknown) {
  const tokens = asRecord(value);
  return asNumber(tokens?.total_tokens);
}

function isWaitingForSlot(item: Record<string, unknown>) {
  return asString(item.error) === "no available orchestrator slots";
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

function JourneyStep({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: "done" | "active" | "upcoming" | "warning";
}) {
  const toneClass =
    state === "done"
      ? "border-emerald-300/30 bg-emerald-400/10"
      : state === "active"
        ? "border-sky-300/30 bg-sky-400/10"
        : state === "warning"
          ? "border-amber-300/30 bg-amber-400/10"
          : "border-white/8 bg-white/4";
  const icon =
    state === "done" ? (
      <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
    ) : state === "active" ? (
      <Rocket className="h-4 w-4 text-[var(--color-accent)]" />
    ) : state === "warning" ? (
      <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
    ) : (
      <CircleDashed className="h-4 w-4 text-[var(--color-muted)]" />
    );

  return (
    <div className={`rounded-[24px] border p-4 ${toneClass}`}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-semibold text-[var(--color-ink)]">{label}</p>
      </div>
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
  symphonyStopped,
  openFindings,
  blockedIssues,
  waitingForSlots,
  retryProblems,
  maxAgents,
  releaseStatus,
  activeIssues,
}: {
  symphonyRunning: boolean;
  symphonyStopped: boolean;
  openFindings: number;
  blockedIssues: number;
  waitingForSlots: number;
  retryProblems: number;
  maxAgents: number;
  releaseStatus: GateVerdict;
  activeIssues: number;
}) {
  if (symphonyStopped) {
    return {
      title: "The automated run stopped",
      detail:
        "Open the Live run tab to review the last runtime log, then restart the run when you are ready.",
      tone: "warning" as const,
    };
  }

  if (!symphonyRunning) {
    return {
      title: "Start the automated run when you are ready",
      detail:
        "Nothing happens automatically until you press the start button. You can review the plan first if you want.",
      tone: "normal" as const,
    };
  }

  if (waitingForSlots > 0 && retryProblems === 0) {
    return {
      title: "More work is queued behind the current workers",
      detail: `${waitingForSlots} ticket${waitingForSlots === 1 ? " is" : "s are"} waiting for a free Symphony worker. This is normal because this project is limited to ${maxAgents} parallel agent${maxAgents === 1 ? "" : "s"}.`,
      tone: "normal" as const,
    };
  }

  if (retryProblems > 0) {
    return {
      title: "Some tickets need attention",
      detail:
        "Open the Live run tab to see which tickets are retrying and the exact error Symphony reported.",
      tone: "warning" as const,
    };
  }

  if (blockedIssues > 0) {
    return {
      title: "A few tickets are blocked",
      detail:
        "Some later tickets are waiting on earlier dependencies. This is normal in a large plan unless the queue stops moving.",
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
      title: "The automated run is underway",
      detail:
        "Overture is tracking active work items. Check the Live run tab for progress or the Overview tab for release checks.",
      tone: "normal" as const,
    };
  }

  return {
    title: "The plan is ready for review",
    detail: "Review the Tasks & plan tab, then start the automated run whenever you are ready.",
    tone: "normal" as const,
  };
}

export function ProjectLiveShell({ initialSnapshot }: { initialSnapshot: ProjectSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activeTab, setActiveTab] = useState<ProjectTab>("overview");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(initialSnapshot.project.name);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
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
  const waitingForSlotQueue = symphonyRetryQueue.filter(isWaitingForSlot);
  const retryProblemQueue = symphonyRetryQueue.filter((item) => !isWaitingForSlot(item));
  const sanitizedBootstrapLog = snapshot.symphony?.bootstrapTail
    ? snapshot.symphony.bootstrapTail.map(stripAnsi).filter(Boolean)
    : [];
  const latestSymphonyFailure = snapshot.auditEvents.find(
    (event) => event.action === "symphony.start_failed",
  );
  const latestSymphonyStart = snapshot.auditEvents.find(
    (event) => event.action === "symphony.started",
  );
  const hasPreviousRun = Boolean(snapshot.symphony);
  const stoppedRuntime = hasPreviousRun && !snapshot.symphony?.running;
  const lastStartFailed =
    latestSymphonyFailure &&
    (!latestSymphonyStart ||
      new Date(latestSymphonyFailure.createdAt).getTime() >
        new Date(latestSymphonyStart.createdAt).getTime())
      ? latestSymphonyFailure
      : null;
  const symphonyDashboardUrl = snapshot.symphony?.stateUrl
    ? snapshot.symphony.stateUrl.replace(/\/api\/v1\/state$/, "/")
    : null;
  const nextStep = nextStepForProject({
    symphonyRunning: Boolean(snapshot.symphony?.running),
    symphonyStopped: stoppedRuntime,
    openFindings: openFindings.length,
    blockedIssues: blockedIssues.length,
    waitingForSlots: waitingForSlotQueue.length,
    retryProblems: retryProblemQueue.length,
    maxAgents: snapshot.project.symphonyMaxConcurrentAgents,
    releaseStatus: snapshot.gateStatus.releaseStatus,
    activeIssues: activeIssues.length,
  });

  useEffect(() => {
    setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

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

  useEffect(() => {
    setNameDraft(snapshot.project.name);
  }, [snapshot.project.name]);

  useEffect(() => {
    if (snapshot.symphony?.running) {
      setRunError(null);
    }
  }, [snapshot.symphony?.running]);

  function runExecution() {
    setRunning(true);
    setRunError(null);
    setActiveTab("runtime");

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/execute`, {
          method: "POST",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to start the automated run.");
        }

        const refresh = await fetch(`/api/projects/${snapshot.project.id}/snapshot`, {
          cache: "no-store",
        });

        if (refresh.ok) {
          setSnapshot((await refresh.json()) as ProjectSnapshot);
        }
      } catch (error) {
        setRunError(
          error instanceof Error ? error.message : "Failed to start the automated run.",
        );
      } finally {
        setRunning(false);
      }
    });
  }

  function renameProject() {
    const trimmedName = nameDraft.trim();

    if (!trimmedName || trimmedName === snapshot.project.name) {
      setRenameError(trimmedName ? null : "Project name is required.");
      return;
    }

    setRenameSaving(true);
    setRenameError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
          }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to rename project.");
        }

        const refresh = await fetch(`/api/projects/${snapshot.project.id}/snapshot`, {
          cache: "no-store",
        });

        if (refresh.ok) {
          setSnapshot((await refresh.json()) as ProjectSnapshot);
        }

        router.refresh();
      } catch (error) {
        setRenameError(
          error instanceof Error ? error.message : "Failed to rename project.",
        );
      } finally {
        setRenameSaving(false);
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
  const planStepState = "done" as const;
  const runStepState =
    snapshot.gateStatus.releaseStatus === "pass"
      ? ("done" as const)
      : retryProblemQueue.length
        ? ("warning" as const)
        : snapshot.symphony?.running
          ? ("active" as const)
          : stoppedRuntime
            ? ("warning" as const)
          : ("upcoming" as const);
  const checksStepState =
    snapshot.gateStatus.releaseStatus === "pass"
      ? ("done" as const)
      : openFindings.length || snapshot.gateStatus.qaStatus === "fail" || snapshot.gateStatus.securityStatus === "fail"
        ? ("warning" as const)
        : snapshot.symphony?.running || completedTasks > 0
          ? ("active" as const)
          : ("upcoming" as const);
  const runStatusLabel = snapshot.symphony?.running
    ? retryProblemQueue.length
      ? "Needs attention"
      : "Running now"
    : stoppedRuntime
      ? "Stopped"
      : "Not started";
  const runStatusDetail = snapshot.symphony?.running
    ? retryProblemQueue.length
      ? "Some tickets are retrying after an error."
      : "Overture is polling the live Symphony run."
    : stoppedRuntime
      ? "The last Symphony run stopped. Open Live run to review the last runtime details and restart it."
      : "Review the plan and start the run when you are ready.";

  return (
    <div className="space-y-6">
      <section className="panel halo-ring rounded-[36px] p-6 lg:p-8">
        <div className="grid gap-8 xl:grid-cols-[1.04fr_0.96fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3">
              <div className="rounded-full border border-white/8 bg-white/4 px-4 py-2 text-sm text-[var(--color-muted)]">
                <span className="font-semibold text-[var(--color-ink)]">Project health:</span>{" "}
                {snapshot.project.health === "on_track"
                  ? "On track"
                  : snapshot.project.health === "at_risk"
                    ? "Needs review"
                    : "Blocked"}
              </div>
              <div className="rounded-full border border-white/8 bg-white/4 px-4 py-2 text-sm text-[var(--color-muted)]">
                <span className="font-semibold text-[var(--color-ink)]">Automated run:</span>{" "}
                {runStatusLabel}
              </div>
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

            <div className="grid gap-4 md:grid-cols-3">
              <JourneyStep
                label="1. Plan created"
                detail="The written plan has already been organized into milestones and tasks."
                state={planStepState}
              />
              <JourneyStep
                label="2. Automated run"
                detail={runStatusDetail}
                state={runStepState}
              />
              <JourneyStep
                label="3. Final checks"
                detail={
                  snapshot.gateStatus.releaseStatus === "pass"
                    ? "All required checks have passed."
                    : "QA, security, and deployment checks stay here until the project is ready."
                }
                state={checksStepState}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Plan items finished"
                value={`${completedTasks}/${snapshot.workItems.length}`}
                detail="Tasks already closed or waived across the project."
              />
              <MetricCard
                label="Working now"
                value={String(activeIssues.length)}
                detail="Tickets currently queued or actively being worked."
              />
              <MetricCard
                label="Needs attention"
                value={String(openFindings.length)}
                detail="Open findings that still need follow-up before release."
              />
              <MetricCard
                label="Last update"
                value={formatRelativeTime(snapshot.project.lastActivityAt)}
                detail="Most recent activity recorded for this project."
              />
            </div>
          </div>

          <aside className="space-y-4">
            <div className="panel rounded-[30px] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                    Main action
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-[var(--color-ink)]">
                    {snapshot.symphony?.running
                      ? "Automated run is live"
                      : stoppedRuntime
                        ? "Automated run stopped"
                        : "Ready to start"}
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    {snapshot.symphony?.running
                      ? "Overture is checking the Symphony run every few seconds and updating this page automatically."
                      : stoppedRuntime
                        ? "The last run already started once and then stopped. Review the runtime details below, then restart the run when you are ready."
                        : "Nothing will start until you press the button below. You can review the plan first if you want."}
                  </p>
                </div>
                <Rocket className="h-6 w-6 text-[var(--color-accent)]" />
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
                    ? "Starting automated run..."
                    : snapshot.symphony?.running
                      ? "Refresh live run"
                      : stoppedRuntime
                        ? "Restart automated run"
                        : "Start automated run"}
                </button>
              </div>
              {runError ? <p className="mt-3 text-sm text-[var(--color-danger)]">{runError}</p> : null}
              {!runError && stoppedRuntime && lastStartFailed ? (
                <p className="mt-3 text-sm text-[var(--color-danger)]">
                  Last start issue: {lastStartFailed.detail}
                </p>
              ) : null}
              {deleteError ? (
                <p className="mt-3 text-sm text-[var(--color-danger)]">{deleteError}</p>
              ) : null}
            </div>

            <NextStepCard
              title={nextStep.title}
              detail={nextStep.detail}
              tone={nextStep.tone}
            />

            <details className="panel rounded-[30px] p-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold text-[var(--color-ink)]">
                Project settings and options
                <Settings2 className="h-5 w-5 text-[var(--color-muted)]" />
              </summary>
              <div className="mt-4 grid gap-3 text-sm text-[var(--color-muted)] sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 sm:col-span-2">
                  <p className="font-semibold text-[var(--color-ink)]">Project name</p>
                  <p className="mt-2">
                    Give this project the name you want to see on the dashboard and project page.
                  </p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <input
                      aria-label="Rename project"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      className="glass-input flex-1 rounded-[18px] px-4 py-3"
                    />
                    <button
                      type="button"
                      disabled={renameSaving || !nameDraft.trim() || nameDraft.trim() === snapshot.project.name}
                      onClick={renameProject}
                      className="glass-button inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {renameSaving ? "Saving..." : "Save name"}
                    </button>
                  </div>
                  {renameError ? (
                    <p className="mt-3 text-sm text-[var(--color-danger)]">{renameError}</p>
                  ) : null}
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Planning model</p>
                  <p className="mt-2">{snapshot.project.plannerModel ?? "Codex default"}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Execution model</p>
                  <p className="mt-2">{snapshot.project.executionModel ?? "Codex default"}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Planning thinking</p>
                  <p className="mt-2">
                    {codexReasoningEffortLabel(snapshot.project.plannerReasoningEffort)}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Agent thinking</p>
                  <p className="mt-2">
                    {codexReasoningEffortLabel(snapshot.project.executionReasoningEffort)}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Parallel workers / turns</p>
                  <p className="mt-2">
                    {snapshot.project.symphonyMaxConcurrentAgents} / {snapshot.project.symphonyMaxTurns}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 sm:col-span-2">
                  <p className="font-semibold text-[var(--color-ink)]">Run mode</p>
                  <p className="mt-2">
                    {snapshot.project.executionMode === "local_chatgpt"
                      ? "Local ChatGPT Codex"
                      : "Hosted API Codex"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 text-sm font-semibold text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
                >
                  <Settings2 className="h-4 w-4" />
                  Open settings
                </Link>
                <button
                  type="button"
                  disabled={running || deleting}
                  onClick={deleteCurrentProject}
                  className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,123,123,0.32)] bg-[rgba(255,92,92,0.08)] px-4 py-2 text-sm font-semibold text-[var(--color-danger)] transition hover:bg-[rgba(255,92,92,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Deleting..." : "Delete project"}
                </button>
              </div>
            </details>
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
            label="Tasks & plan"
          />
          <TabButton
            active={activeTab === "runtime"}
            onClick={() => setActiveTab("runtime")}
            label="Live run"
          />
          <TabButton
            active={activeTab === "evidence"}
            onClick={() => setActiveTab("evidence")}
            label="Results"
          />
        </div>
      </section>

      {activeTab === "overview" ? (
        <section className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <GateCard
              label="QA checks"
              status={snapshot.gateStatus.qaStatus}
              description="Build, validation, test, and quality proof for the project."
            />
            <GateCard
              label="Security checks"
              status={snapshot.gateStatus.securityStatus}
              description="Security scans, dependency review, and runtime safety checks."
            />
            <GateCard
              label="Deployment checks"
              status={snapshot.gateStatus.deployStatus}
              description="Deployment proof for local launch and supported platform plans."
            />
            <GateCard
              label="Ready to release"
              status={snapshot.gateStatus.releaseStatus}
              description="Final status after the required quality, security, and deployment checks."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <IssueList
              label="Ready now"
              description="Tickets that are ready to work or already in motion."
              issues={activeIssues}
            />
            <IssueList
              label="Ready for review"
              description="Tickets that Symphony believes are ready for a review pass."
              issues={reviewIssues}
            />
            <IssueList
              label="Waiting on earlier work"
              description="These tickets cannot start yet because earlier work still needs to finish."
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
                    If anything is still blocking the project, it will show up here.
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
                    The key details Overture saved when this project was created.
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
            <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Tasks and plan</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
              Review the milestone tree, task dependencies, acceptance criteria, and release checks
              before or during the run.
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
          <div className="panel rounded-[30px] p-6">
            <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
              What you are seeing
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
              {waitingForSlotQueue.length
                ? `${symphonySessions.length} ticket${symphonySessions.length === 1 ? " is" : "s are"} running now, and ${waitingForSlotQueue.length} more ${waitingForSlotQueue.length === 1 ? "is" : "are"} waiting for a free worker. That waiting state is normal because this project is limited to ${snapshot.project.symphonyMaxConcurrentAgents} parallel agent${snapshot.project.symphonyMaxConcurrentAgents === 1 ? "" : "s"}.`
                : retryProblemQueue.length
                  ? `${retryProblemQueue.length} ticket${retryProblemQueue.length === 1 ? " is" : "s are"} retrying after an execution problem. Check the queue details below for the exact error.`
                  : snapshot.symphony?.running
                    ? "Symphony is actively working through the queued tickets."
                    : stoppedRuntime
                      ? "The last Symphony run stopped. Review the last startup log and runtime details below before restarting it."
                      : "The automated run has not started yet. Press Start automated run when you are ready."}
            </p>
          </div>

          {stoppedRuntime ? (
            <div className="panel rounded-[30px] border border-amber-300/20 bg-amber-400/8 p-6">
              <div className="flex items-start gap-4">
                <AlertTriangle className="mt-1 h-5 w-5 text-[var(--color-warning)]" />
                <div>
                  <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                    Last run stopped
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    Overture still has the previous runtime record, but Symphony is no longer
                    responding on it.
                  </p>
                  {latestSymphonyFailure ? (
                    <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                      Last recorded start failure: {latestSymphonyFailure.detail}
                    </p>
                  ) : null}
                  {sanitizedBootstrapLog.length ? (
                    <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                      Latest runtime log: {sanitizedBootstrapLog[0]}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Running now"
              value={String(asNumber(symphonyCounts?.running))}
              detail="Tickets Symphony is actively working on."
            />
            <MetricCard
              label="Waiting to start"
              value={String(waitingForSlotQueue.length)}
              detail="Tickets queued behind the current worker limit."
            />
            <MetricCard
              label="Needs another attempt"
              value={String(retryProblemQueue.length)}
              detail="Tickets retrying after an execution error."
            />
            <MetricCard
              label="Parallel workers"
              value={String(snapshot.project.symphonyMaxConcurrentAgents)}
              detail="Maximum tickets Symphony can work on at once."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="panel rounded-[30px] p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                  Working right now
                </h2>
                <div className="rounded-full border border-white/8 bg-white/4 px-3 py-1 text-sm text-[var(--color-muted)]">
                  Tokens used: {totalTokens(codexTotals).toLocaleString()}
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {symphonySessions.length ? (
                  symphonySessions.map((session, index) => (
                    <div
                      key={`${asString(session.issue_id)}-${index}`}
                      className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-[var(--color-ink)]">
                          {asString(session.issue_identifier) || asString(session.issue_id) || "Session"}
                        </p>
                        <StatusPill status={asString(session.state) || "in_progress"} />
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <p>Started: {asString(session.started_at) ? formatRelativeTime(asString(session.started_at)) : "n/a"}</p>
                        <p>Turns: {asNumber(session.turn_count)}</p>
                        <p>Tokens: {totalTokens(session.tokens).toLocaleString()}</p>
                        <p>Last update: {asString(session.last_event_at) ? formatRelativeTime(asString(session.last_event_at)) : "n/a"}</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                        {asString(session.last_message) || asString(session.last_event) || "Working..."}
                      </p>
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
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Queue and attention</h2>
              <div className="mt-5 space-y-3">
                {waitingForSlotQueue.length ? (
                  <div className="space-y-3">
                    <div className="rounded-[22px] border border-sky-300/20 bg-sky-400/8 p-4">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">
                        Waiting for a free worker
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                        These tickets are queued normally. They will begin when one of the current
                        workers finishes.
                      </p>
                    </div>
                    {waitingForSlotQueue.map((item, index) => (
                      <div
                        key={`${asString(item.issue_id)}-${index}`}
                        className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-ink)]">
                            {asString(item.issue_identifier) || asString(item.issue_id) || "Queue item"}
                          </p>
                          <StatusPill status="pending" />
                        </div>
                        <p className="mt-2">Next retry: {asString(item.due_at) ? formatRelativeTime(asString(item.due_at)) : "n/a"}</p>
                        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                          Waiting for a free Symphony worker.
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]">
                    Nothing is currently waiting for a worker.
                  </div>
                )}

                {retryProblemQueue.length ? (
                  <div className="space-y-3">
                    <div className="rounded-[22px] border border-amber-300/20 bg-amber-400/8 p-4">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">
                        Tickets retrying after an error
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                        These need attention because Symphony reported a real execution problem.
                      </p>
                    </div>
                    {retryProblemQueue.map((item, index) => (
                      <div
                        key={`${asString(item.issue_id)}-${index}`}
                        className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-ink)]">
                            {asString(item.issue_identifier) || asString(item.issue_id) || "Queue item"}
                          </p>
                          <StatusPill status="failed" />
                        </div>
                        <p className="mt-2">Attempt: {asNumber(item.attempt)}</p>
                        <p>
                          Next retry: {asString(item.due_at) ? formatRelativeTime(asString(item.due_at)) : "n/a"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                          {asString(item.error) || "No error message provided."}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-white/8 bg-white/4 p-4 text-sm text-[var(--color-muted)]">
                    No tickets are currently retrying after an error.
                  </div>
                )}
              </div>
            </div>
          </div>

          <details className="panel rounded-[30px] p-6">
            <summary className="cursor-pointer text-lg font-semibold text-[var(--color-ink)]">
              Advanced technical details
            </summary>
            <div className="mt-5 grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="space-y-3 text-sm text-[var(--color-muted)]">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">PID / Port</p>
                  <p className="mt-2">
                    {snapshot.symphony
                      ? `${snapshot.symphony.pid} / ${snapshot.symphony.port}${snapshot.symphony.running ? "" : " (stopped)"}`
                      : "Not started"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">State URL</p>
                  <p className="mt-2 break-all">
                    {snapshot.symphony?.stateUrl ?? "Not available until Symphony starts."}
                  </p>
                  {snapshot.symphony?.stateUrl ? (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link
                        href={snapshot.symphony.stateUrl}
                        target="_blank"
                        className="inline-flex items-center gap-2 text-sm text-[var(--color-accent)]"
                      >
                        Open state endpoint
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                      {symphonyDashboardUrl ? (
                        <Link
                          href={symphonyDashboardUrl}
                          target="_blank"
                          className="inline-flex items-center gap-2 text-sm text-[var(--color-accent)]"
                        >
                          Open Symphony dashboard
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      ) : null}
                    </div>
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

              <div className="rounded-[24px] border border-white/8 bg-[rgba(2,8,18,0.78)] p-4">
                <p className="text-sm font-semibold text-[var(--color-ink)]">Raw terminal log</p>
                <pre className="fine-scrollbar mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap text-sm leading-7 text-[var(--color-muted)]">
                  {sanitizedBootstrapLog.length
                    ? sanitizedBootstrapLog.join("\n")
                    : "No runtime log yet. Start the automated run to begin capturing bootstrap output."}
                </pre>
              </div>
            </div>
          </details>
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
