"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Boxes,
  Bot,
  CloudUpload,
  FileClock,
  ShieldCheck,
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
    <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            {label}
          </p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{description}</p>
        </div>
        <StatusPill status={status} />
      </div>
    </div>
  );
}

function ArtifactPreview({ artifact }: { artifact: ArtifactRecord }) {
  const href = `/api/artifacts/${artifact.id}`;
  return (
    <Link
      href={href}
      target="_blank"
      className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4 transition hover:border-[var(--color-accent)]"
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

export function ProjectLiveShell({ initialSnapshot }: { initialSnapshot: ProjectSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [running, setRunning] = useState(false);
  const latestRuns = snapshot.runs.slice(0, 12);
  const openFindings = snapshot.findings.filter(
    (finding) => !["resolved", "accepted_risk"].includes(finding.status),
  );

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
      } finally {
        setRunning(false);
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
      <section className="panel rounded-[32px] p-6 lg:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={snapshot.project.health} />
              <StatusPill status={snapshot.gateStatus.releaseStatus} />
              <StatusPill status={snapshot.project.executionMode} />
            </div>
            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Project status
              </p>
              <h1 className="max-w-4xl text-balance text-5xl font-semibold text-[var(--color-ink)]">
                {snapshot.project.name}
              </h1>
              <p className="max-w-3xl text-lg text-[var(--color-muted)]">
                {snapshot.planVersion?.specIr.summary}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Current milestone
                </p>
                <p className="mt-3 text-lg font-semibold text-[var(--color-ink)]">
                  {snapshot.currentMilestone ?? "Release readiness"}
                </p>
              </div>
              <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Tasks closed
                </p>
                <p className="mt-3 text-lg font-semibold text-[var(--color-ink)]">
                  {snapshot.counts.done + snapshot.counts.waived} / {snapshot.workItems.length}
                </p>
              </div>
              <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Open findings
                </p>
                <p className="mt-3 text-lg font-semibold text-[var(--color-ink)]">
                  {openFindings.length}
                </p>
              </div>
              <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Last activity
                </p>
                <p className="mt-3 text-lg font-semibold text-[var(--color-ink)]">
                  {formatRelativeTime(snapshot.project.lastActivityAt)}
                </p>
              </div>
            </div>
          </div>

          <aside className="panel-grid rounded-[28px] border border-[var(--color-border)] bg-[rgba(255,252,245,0.78)] p-5">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    Controls
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    Start or resume the execution loop against the canonical plan.
                  </p>
                </div>
                <Bot className="h-5 w-5 text-[var(--color-accent)]" />
              </div>
              <button
                type="button"
                disabled={running}
                onClick={runExecution}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--color-panel-strong)] px-5 py-3 text-sm font-semibold text-[var(--color-surface)] transition hover:bg-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Activity className="h-4 w-4" />
                {running ? "Dispatching runner..." : "Run execution loop"}
              </button>
              <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Tracker shim
                </p>
                <p className="mt-3 text-sm text-[var(--color-muted)]">
                  {snapshot.trackerIssues.length} work items are mirrored as Linear-compatible
                  tracker issues for Symphony polling and state reconciliation.
                </p>
              </div>
              <div className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Repo source
                </p>
                <p className="mt-3 text-sm break-all text-[var(--color-ink)]">
                  {snapshot.project.repoSource}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <div className="panel rounded-[28px] p-5">
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
        <div className="panel rounded-[28px] p-5">
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
        <div className="panel rounded-[28px] p-5">
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
        <div className="panel rounded-[28px] p-5">
          <div className="flex items-center gap-3">
            <Boxes className="h-5 w-5 text-[var(--color-accent)]" />
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

      <section className="space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            Plan review screen
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--color-ink)]">
            Dependency-aware plan graph
          </h2>
        </div>
        <PlanWorkbench
          workItems={snapshot.workItems}
          dependencyEdges={snapshot.dependencyEdges}
          planVersion={snapshot.planVersion}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel rounded-[28px] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Execution monitoring
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
                Recent runs and tracker state
              </h2>
            </div>
            <FileClock className="h-5 w-5 text-[var(--color-accent)]" />
          </div>
          <div className="mt-5 space-y-3">
            {latestRuns.length ? (
              latestRuns.map((run) => {
                const workItem = snapshot.workItems.find(
                  (candidate) => candidate.id === run.workItemId,
                );
                return (
                  <div
                    key={run.id}
                    className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                          {workItem?.key ?? "Run"}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                          {workItem?.title ?? run.summary}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusPill status={run.phase} />
                        <StatusPill status={run.status} />
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-[var(--color-muted)]">{run.summary}</p>
                    <p className="mt-3 text-xs text-[var(--color-muted)]">
                      Started {formatDateTime(run.startedAt)}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[24px] border border-dashed border-[var(--color-border)] bg-white/60 p-6 text-sm text-[var(--color-muted)]">
                No execution runs yet. Start the runner to simulate Symphony task execution and
                populate the timeline.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel rounded-[28px] p-5">
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
                description="Final closure blocker that only opens when all mandatory checks pass."
              />
            </div>
          </div>

          <div className="panel rounded-[28px] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Findings
            </p>
            <div className="mt-4 space-y-3">
              {openFindings.length ? (
                openFindings.slice(0, 8).map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">
                        {finding.title}
                      </p>
                      <StatusPill status={finding.severity} />
                    </div>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">{finding.detail}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-[var(--color-border)] bg-white/60 p-6 text-sm text-[var(--color-muted)]">
                  No open findings. Remaining gate work is mostly evidence generation and task
                  completion.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel rounded-[28px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Deployment matrix
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
              Local, Jetson, Azure, and AWS proof grid
            </h2>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-3 text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                <th className="px-4">Target</th>
                <th className="px-4">Build</th>
                <th className="px-4">Deploy</th>
                <th className="px-4">Smoke</th>
                <th className="px-4">Perf sanity</th>
              </tr>
            </thead>
            <tbody>
              {deploymentRows.map((row) => (
                <tr key={row.target} className="rounded-[24px] bg-white/80">
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
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="panel rounded-[28px] p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            Spec intake
          </p>
          <div className="mt-4 rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4">
            <p className="font-semibold text-[var(--color-ink)]">
              {snapshot.specDocument?.filename ?? "Source plan"}
            </p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Hash: {snapshot.specDocument?.contentHash.slice(0, 16)}...
            </p>
            {snapshot.specDocument ? (
              <div className="mt-4 max-h-[360px] overflow-auto">
                <MarkdownRenderer content={snapshot.specDocument.content.slice(0, 4000)} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel rounded-[28px] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Artifact inspection
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {snapshot.artifacts.slice(0, 6).map((artifact) => (
                <ArtifactPreview key={artifact.id} artifact={artifact} />
              ))}
            </div>
          </div>

          <div className="panel rounded-[28px] p-5" id="operator-view">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Audit trail
            </p>
            <div className="mt-4 space-y-3">
              {snapshot.auditEvents.slice(0, 10).map((event) => (
                <div
                  key={event.id}
                  className="rounded-[24px] border border-[var(--color-border)] bg-white/80 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                        {event.action}
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-ink)]">{event.detail}</p>
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
