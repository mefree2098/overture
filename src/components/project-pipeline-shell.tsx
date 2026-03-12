"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpenText,
  BotMessageSquare,
  ClipboardCheck,
  ExternalLink,
  LoaderCircle,
  Rocket,
  SearchCheck,
  Settings2,
  UploadCloud,
} from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { lifecycleDisplayLabel, researchProviderLabel } from "@/lib/project-pipeline";
import type {
  ArtifactRecord,
  DeploymentTarget,
  LaunchTarget,
  ProjectSnapshot,
  WorkshopSearchMode,
} from "@/lib/types";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

type PipelineView = "workshop" | "research" | "launch" | "deploy";

function StageCard({
  label,
  detail,
  tone,
}: {
  label: string;
  detail: string;
  tone: "done" | "active" | "upcoming";
}) {
  const toneClass =
    tone === "done"
      ? "border-emerald-300/30 bg-emerald-400/10"
      : tone === "active"
        ? "border-sky-300/30 bg-sky-400/10"
        : "border-white/8 bg-white/4";

  return (
    <div className={`rounded-[24px] border p-4 ${toneClass}`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
        {label}
      </p>
      <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">{detail}</p>
    </div>
  );
}

function ArtifactLink({
  artifact,
  description,
}: {
  artifact: ArtifactRecord;
  description: string;
}) {
  return (
    <Link
      href={`/api/artifacts/${artifact.id}`}
      target="_blank"
      className="rounded-[22px] border border-white/8 bg-white/4 p-4 transition hover:border-[var(--color-accent)]"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
        {artifact.kind}
      </p>
      <p className="mt-2 text-base font-semibold text-[var(--color-ink)]">{artifact.label}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{description}</p>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Created {formatRelativeTime(artifact.createdAt)}
      </p>
    </Link>
  );
}

function PipelineNavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]"
          : "border-[var(--color-border)] bg-white/6 text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
    </Link>
  );
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function launchTargetLabel(target: LaunchTarget) {
  switch (target) {
    case "api":
      return "API / service";
    case "docker":
      return "Docker";
    case "ios_simulator":
      return "iOS simulator";
    default:
      return "Web";
  }
}

function deployTargetLabel(target: DeploymentTarget) {
  switch (target) {
    case "raspberry_pi":
      return "Raspberry Pi";
    case "ios_testflight":
      return "iOS TestFlight";
    case "ios_app_store":
      return "iOS App Store";
    default:
      return target.charAt(0).toUpperCase() + target.slice(1);
  }
}

export function ProjectPipelineShell({
  initialSnapshot,
  view,
  initialPlanMarkdown,
  initialResearchReport,
}: {
  initialSnapshot: ProjectSnapshot;
  view: PipelineView;
  initialPlanMarkdown: string;
  initialResearchReport: string;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [workshopMessage, setWorkshopMessage] = useState("");
  const [workshopSearchMode, setWorkshopSearchMode] = useState<WorkshopSearchMode>(
    snapshot.workshopThread?.searchMode ?? "cached",
  );
  const [workshopBusy, setWorkshopBusy] = useState(false);
  const [workshopError, setWorkshopError] = useState<string | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [planMarkdown, setPlanMarkdown] = useState(initialPlanMarkdown);
  const [planDirty, setPlanDirty] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [researchReport, setResearchReport] = useState(initialResearchReport);
  const [launchBusyId, setLaunchBusyId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [deployBusyId, setDeployBusyId] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const latestResearchRun = snapshot.researchRuns[0] ?? null;
  const promptArtifact = snapshot.artifacts.find((artifact) => artifact.kind === "research-prompt");
  const planArtifact = snapshot.artifacts.find((artifact) => artifact.kind === "research-plan");
  const reportArtifact = snapshot.artifacts.find((artifact) => artifact.kind === "research-report");
  const openQuestionsArtifact = snapshot.artifacts.find(
    (artifact) => artifact.kind === "open-questions",
  );
  const workshopOpenQuestions = asArray(snapshot.workshopThread?.metadata.openQuestions).map(
    (item) => String(item),
  );
  const stageLabel = lifecycleDisplayLabel(snapshot.project.lifecycleStage);
  const stageSummary =
    view === "workshop"
      ? "Shape the canonical research prompt before any plan is generated."
      : view === "research"
        ? "Run research, inspect the report, and approve the generated plan."
        : view === "launch"
          ? "Open the built project locally and capture launch evidence."
          : "Push a validated project to a supported target with logs and approval gates.";

  const workshopDone = Boolean(promptArtifact);
  const researchDone = Boolean(planArtifact);
  const planDone = Boolean(snapshot.planVersion);
  const executionReady = snapshot.project.lifecycleStage === "execution_ready" || Boolean(snapshot.planVersion);
  const launchDone = snapshot.launchRuns.some((run) => run.status === "completed");
  const deployDone = snapshot.deployRuns.some((run) => run.status === "completed");

  useEffect(() => {
    setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/projects/${initialSnapshot.project.id}/snapshot`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      setSnapshot((await response.json()) as ProjectSnapshot);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [initialSnapshot.project.id]);

  useEffect(() => {
    if (!planDirty) {
      setPlanMarkdown(initialPlanMarkdown);
    }
  }, [initialPlanMarkdown, planDirty]);

  useEffect(() => {
    setResearchReport(initialResearchReport);
  }, [initialResearchReport]);

  useEffect(() => {
    if (!planArtifact || planDirty) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/artifacts/${planArtifact.id}`);

      if (!response.ok) {
        return;
      }

      setPlanMarkdown(await response.text());
    });
  }, [planArtifact, planDirty]);

  useEffect(() => {
    if (!reportArtifact) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/artifacts/${reportArtifact.id}`);

      if (!response.ok) {
        return;
      }

      setResearchReport(await response.text());
    });
  }, [reportArtifact]);

  async function refreshSnapshot() {
    const response = await fetch(`/api/projects/${snapshot.project.id}/snapshot`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return;
    }

    setSnapshot((await response.json()) as ProjectSnapshot);
    router.refresh();
  }

  function sendWorkshopMessage() {
    setWorkshopBusy(true);
    setWorkshopError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/workshop`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: workshopMessage,
            searchMode: workshopSearchMode,
            repoContext: snapshot.project.repoSource,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to send the workshop message.");
        }

        setWorkshopMessage("");
        await refreshSnapshot();
      } catch (error) {
        setWorkshopError(
          error instanceof Error ? error.message : "Unable to send the workshop message.",
        );
      } finally {
        setWorkshopBusy(false);
      }
    });
  }

  function finalizeWorkshop() {
    setWorkshopBusy(true);
    setWorkshopError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/workshop`, {
          method: "PATCH",
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to lock the workshop prompt.");
        }

        await refreshSnapshot();
        router.push(`/projects/${snapshot.project.id}/research`);
      } catch (error) {
        setWorkshopError(
          error instanceof Error ? error.message : "Unable to lock the workshop prompt.",
        );
      } finally {
        setWorkshopBusy(false);
      }
    });
  }

  function forkWorkshop() {
    setWorkshopBusy(true);
    setWorkshopError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/workshop/fork`, {
          method: "POST",
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to fork the workshop thread.");
        }

        await refreshSnapshot();
      } catch (error) {
        setWorkshopError(
          error instanceof Error ? error.message : "Unable to fork the workshop thread.",
        );
      } finally {
        setWorkshopBusy(false);
      }
    });
  }

  function runResearch() {
    setResearchBusy(true);
    setResearchError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/research`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            searchMode: snapshot.workshopThread?.searchMode ?? "live",
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to run deep research.");
        }

        await refreshSnapshot();
      } catch (error) {
        setResearchError(
          error instanceof Error ? error.message : "Unable to run deep research.",
        );
      } finally {
        setResearchBusy(false);
      }
    });
  }

  function approvePlan() {
    setPlanBusy(true);
    setPlanError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/plan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            planText: planMarkdown,
            specFilename: "plan.md",
            planLabel: "Approved research plan",
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to approve and ingest the plan.");
        }

        setPlanDirty(false);
        await refreshSnapshot();
        router.push(`/projects/${snapshot.project.id}`);
      } catch (error) {
        setPlanError(
          error instanceof Error
            ? error.message
            : "Unable to approve and ingest the plan.",
        );
      } finally {
        setPlanBusy(false);
      }
    });
  }

  function runLaunch(launchProfileId: string) {
    setLaunchBusyId(launchProfileId);
    setLaunchError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/launch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            launchProfileId,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to run the launch profile.");
        }

        await refreshSnapshot();
      } catch (error) {
        setLaunchError(
          error instanceof Error ? error.message : "Unable to run the launch profile.",
        );
      } finally {
        setLaunchBusyId(null);
      }
    });
  }

  function runDeploy(deployProfileId: string, approvalRequired: boolean) {
    if (approvalRequired) {
      const confirmed = window.confirm(
        "This deployment target requires operator approval. Continue with the deployment run?",
      );

      if (!confirmed) {
        return;
      }
    }

    setDeployBusyId(deployProfileId);
    setDeployError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${snapshot.project.id}/deploy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            deployProfileId,
            confirmed: approvalRequired,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to run the deployment profile.");
        }

        await refreshSnapshot();
      } catch (error) {
        setDeployError(
          error instanceof Error ? error.message : "Unable to run the deployment profile.",
        );
      } finally {
        setDeployBusyId(null);
      }
    });
  }

  const stageCards = useMemo(
    (): Array<{ label: string; detail: string; tone: "done" | "active" | "upcoming" }> => [
      {
        label: "1. Workshop",
        detail: "Refine the prompt from raw notes and questions.",
        tone: workshopDone ? "done" : view === "workshop" ? "active" : "upcoming",
      },
      {
        label: "2. Research",
        detail: "Run deep research and generate report + plan artifacts.",
        tone: researchDone ? "done" : view === "research" ? "active" : "upcoming",
      },
      {
        label: "3. Plan review",
        detail: "Edit or approve the generated plan before ingestion.",
        tone:
          planDone
            ? "done"
            : snapshot.project.lifecycleStage === "plan_review" || view === "research"
              ? "active"
              : "upcoming",
      },
      {
        label: "4. Build",
        detail: "Hand the approved plan to Symphony and track the run.",
        tone: executionReady ? "done" : "upcoming",
      },
      {
        label: "5. Launch",
        detail: "Open the built project locally and capture evidence.",
        tone: launchDone ? "done" : view === "launch" ? "active" : "upcoming",
      },
      {
        label: "6. Deploy",
        detail: "Run a deployment target with logs and approval gates.",
        tone: deployDone ? "done" : view === "deploy" ? "active" : "upcoming",
      },
    ],
    [
      deployDone,
      executionReady,
      launchDone,
      planDone,
      researchDone,
      snapshot.project.lifecycleStage,
      view,
      workshopDone,
    ],
  );

  return (
    <div className="space-y-6">
      <section className="panel halo-ring rounded-[36px] p-6 lg:p-8">
        <div className="grid gap-8 xl:grid-cols-[1.04fr_0.96fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3">
              <div className="rounded-full border border-white/8 bg-white/4 px-4 py-2 text-sm text-[var(--color-muted)]">
                <span className="font-semibold text-[var(--color-ink)]">Lifecycle:</span>{" "}
                {stageLabel}
              </div>
              <div className="rounded-full border border-white/8 bg-white/4 px-4 py-2 text-sm text-[var(--color-muted)]">
                <span className="font-semibold text-[var(--color-ink)]">Research:</span>{" "}
                {researchProviderLabel(snapshot.project.researchProvider)}
              </div>
            </div>

            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--color-accent)]">
                Guided project flow
              </p>
              <h1 className="text-balance text-5xl font-semibold text-[var(--color-ink)] lg:text-6xl">
                {snapshot.project.name}
              </h1>
              <p className="max-w-3xl text-base leading-8 text-[var(--color-muted)]">
                {stageSummary}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {stageCards.map((card) => (
                <StageCard
                  key={card.label}
                  label={card.label}
                  detail={card.detail}
                  tone={card.tone}
                />
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="panel rounded-[30px] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                Project settings
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Planning model</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {snapshot.project.plannerModel ?? "Codex default"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Execution model</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {snapshot.project.executionModel ?? "Codex default"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Repo source</p>
                  <p className="mt-2 break-all text-sm text-[var(--color-muted)]">
                    {snapshot.project.repoSource}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Created</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {formatDateTime(snapshot.project.createdAt)}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={`/projects/${snapshot.project.id}`}
                  className="glass-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                >
                  Open build view
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 text-sm font-semibold text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
                >
                  <Settings2 className="h-4 w-4" />
                  Global settings
                </Link>
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                Latest activity
              </p>
              <div className="mt-4 space-y-3">
                {snapshot.auditEvents.slice(0, 5).map((event) => (
                  <div
                    key={event.id}
                    className="rounded-[22px] border border-white/8 bg-white/4 p-4"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                      {event.actor} / {event.action}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                      {event.detail}
                    </p>
                    <p className="mt-2 text-xs text-[var(--color-muted)]">
                      {formatRelativeTime(event.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="panel rounded-[30px] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <PipelineNavLink
            href={`/projects/${snapshot.project.id}/workshop`}
            label="Workshop"
            active={view === "workshop"}
          />
          <PipelineNavLink
            href={`/projects/${snapshot.project.id}/research`}
            label="Research"
            active={view === "research"}
          />
          <PipelineNavLink
            href={`/projects/${snapshot.project.id}`}
            label="Build"
            active={false}
          />
          <PipelineNavLink
            href={`/projects/${snapshot.project.id}/launch`}
            label="Launch"
            active={view === "launch"}
          />
          <PipelineNavLink
            href={`/projects/${snapshot.project.id}/deploy`}
            label="Deploy"
            active={view === "deploy"}
          />
        </div>
      </section>

      {view === "workshop" ? (
        <section className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
          <div className="panel rounded-[30px] p-6">
            <div className="flex items-start gap-4">
              <BotMessageSquare className="mt-1 h-5 w-5 text-[var(--color-accent)]" />
              <div>
                <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                  Prompt Workshop
                </h2>
                <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                  Keep talking in plain language. Overture will save the thread, refine the
                  canonical prompt draft, and tell you when it is ready for research.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {snapshot.workshopMessages.length ? (
                snapshot.workshopMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-[22px] border p-4 ${
                      message.role === "assistant"
                        ? "border-sky-300/20 bg-sky-400/8"
                        : "border-white/8 bg-white/4"
                    }`}
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                      {message.role}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--color-ink)]">
                      {message.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-white/3 p-6 text-sm text-[var(--color-muted)]">
                  No workshop turns yet. Send the first message to start building the research
                  prompt.
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-4">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  Search mode
                </span>
                <select
                  value={workshopSearchMode}
                  onChange={(event) =>
                    setWorkshopSearchMode(event.target.value as WorkshopSearchMode)
                  }
                  className="glass-input w-full rounded-[22px] px-4 py-3"
                >
                  <option value="cached">Cached search</option>
                  <option value="live">Live search</option>
                </select>
              </label>
              <textarea
                value={workshopMessage}
                onChange={(event) => setWorkshopMessage(event.target.value)}
                placeholder="Tell Overture what should be researched, what matters most, and anything you are unsure about."
                className="glass-input fine-scrollbar min-h-[220px] w-full rounded-[28px] px-4 py-4 text-sm leading-7"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={sendWorkshopMessage}
                  disabled={workshopBusy || !workshopMessage.trim()}
                  className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {workshopBusy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  Send to workshop
                </button>
                <button
                  type="button"
                  onClick={forkWorkshop}
                  disabled={workshopBusy || !snapshot.workshopThread}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-5 py-3 text-sm font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <BotMessageSquare className="h-4 w-4" />
                  Fork workshop
                </button>
                <button
                  type="button"
                  onClick={finalizeWorkshop}
                  disabled={workshopBusy || !snapshot.workshopThread?.promptDraft}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-5 py-3 text-sm font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Lock prompt for research
                </button>
              </div>
              {workshopError ? (
                <p className="text-sm text-[var(--color-danger)]">{workshopError}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Prompt draft</h2>
              <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                This is the canonical prompt Overture will lock and hand into the research stage.
              </p>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-[rgba(2,8,18,0.78)] p-4">
                <pre className="fine-scrollbar max-h-[420px] overflow-auto whitespace-pre-wrap text-sm leading-7 text-[var(--color-muted)]">
                  {snapshot.workshopThread?.promptDraft ||
                    "No prompt draft yet. Send the first workshop message to start composing it."}
                </pre>
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Workshop summary</h2>
              <p className="mt-4 text-sm leading-7 text-[var(--color-muted)]">
                {snapshot.workshopThread?.summary ||
                  "Overture will summarize the current prompt direction here."}
              </p>
              <div className="mt-5 space-y-3">
                {workshopOpenQuestions.length ? (
                  workshopOpenQuestions.map((question) => (
                    <div
                      key={question}
                      className="rounded-[20px] border border-white/8 bg-white/4 px-4 py-3 text-sm text-[var(--color-muted)]"
                    >
                      {question}
                    </div>
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-white/10 bg-white/3 px-4 py-5 text-sm text-[var(--color-muted)]">
                    No open questions are recorded yet.
                  </div>
                )}
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {promptArtifact ? (
                  <ArtifactLink
                    artifact={promptArtifact}
                    description="The locked research prompt artifact."
                  />
                ) : null}
                {openQuestionsArtifact ? (
                  <ArtifactLink
                    artifact={openQuestionsArtifact}
                    description="Questions that still need clarification."
                  />
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {view === "research" ? (
        <section className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
            <div className="panel rounded-[30px] p-6">
              <div className="flex items-start gap-4">
                <SearchCheck className="mt-1 h-5 w-5 text-[var(--color-accent)]" />
                <div>
                  <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                    Deep Research
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    Run research from the locked prompt, inspect the report, then approve the
                    generated `plan.md` when it is ready.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Provider</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {researchProviderLabel(snapshot.project.researchProvider)}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <p className="font-semibold text-[var(--color-ink)]">Latest status</p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">
                    {latestResearchRun?.status ?? "Not started"}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runResearch}
                  disabled={researchBusy || !snapshot.workshopThread?.promptDraft}
                  className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {researchBusy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  {latestResearchRun ? "Run research again" : "Start deep research"}
                </button>
                <Link
                  href={`/projects/${snapshot.project.id}/workshop`}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-5 py-3 text-sm font-semibold text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
                >
                  Reopen workshop
                </Link>
              </div>
              {researchError ? (
                <p className="mt-3 text-sm text-[var(--color-danger)]">{researchError}</p>
              ) : null}

              <div className="mt-5 space-y-3">
                {snapshot.researchRuns.length ? (
                  snapshot.researchRuns.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-[22px] border border-white/8 bg-white/4 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                            {run.provider}
                          </p>
                          <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                            {run.summary}
                          </p>
                        </div>
                        <StatusPill status={run.status} />
                      </div>
                      <p className="mt-2 text-xs text-[var(--color-muted)]">
                        Started {formatDateTime(run.startedAt)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-white/3 p-6 text-sm text-[var(--color-muted)]">
                    No research runs yet.
                  </div>
                )}
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Research report</h2>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-[rgba(2,8,18,0.78)] p-5">
                {researchReport ? (
                  <article className="prose prose-invert max-w-none text-sm leading-7">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{researchReport}</ReactMarkdown>
                  </article>
                ) : (
                  <p className="text-sm leading-7 text-[var(--color-muted)]">
                    The latest research report will appear here after a run completes.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
            <div className="panel rounded-[30px] p-6">
              <div className="flex items-start gap-4">
                <BookOpenText className="mt-1 h-5 w-5 text-[var(--color-accent)]" />
                <div>
                  <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Plan review</h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
                    Make edits if needed, then approve this `plan.md` to hand it into Overture’s
                    existing planner and execution graph.
                  </p>
                </div>
              </div>
              <textarea
                value={planMarkdown}
                onChange={(event) => {
                  setPlanMarkdown(event.target.value);
                  setPlanDirty(true);
                }}
                placeholder="The generated plan.md will appear here after research completes."
                className="glass-input fine-scrollbar mt-5 min-h-[360px] w-full rounded-[28px] px-4 py-4 text-sm leading-7"
              />
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={approvePlan}
                  disabled={planBusy || !planMarkdown.trim()}
                  className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {planBusy ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="h-4 w-4" />
                  )}
                  Approve and ingest plan
                </button>
                {snapshot.planVersion ? (
                  <Link
                    href={`/projects/${snapshot.project.id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/6 px-5 py-3 text-sm font-semibold text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
                  >
                    Open build page
                  </Link>
                ) : null}
              </div>
              {planError ? <p className="mt-3 text-sm text-[var(--color-danger)]">{planError}</p> : null}
            </div>

            <div className="space-y-6">
              <div className="panel rounded-[30px] p-6">
                <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                  Research artifacts
                </h2>
                <div className="mt-5 grid gap-3">
                  {promptArtifact ? (
                    <ArtifactLink
                      artifact={promptArtifact}
                      description="The locked prompt handed into research."
                    />
                  ) : null}
                  {reportArtifact ? (
                    <ArtifactLink
                      artifact={reportArtifact}
                      description="The full deep research report."
                    />
                  ) : null}
                  {planArtifact ? (
                    <ArtifactLink
                      artifact={planArtifact}
                      description="The generated plan ready for approval."
                    />
                  ) : null}
                </div>
              </div>

              <div className="panel rounded-[30px] p-6">
                <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                  Next step
                </h2>
                <p className="mt-4 text-sm leading-7 text-[var(--color-muted)]">
                  {snapshot.planVersion
                    ? "The approved plan is already ingested. Continue to the build view to start or monitor Symphony."
                    : "Approve the plan once it looks right. Overture will preserve the current quick path by handing that plan straight into the existing planner."}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {view === "launch" ? (
        <section className="space-y-6">
          <div className="panel rounded-[30px] p-6">
            <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Launch profiles</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
              Run the built project locally from Overture and capture a launch report and logs.
            </p>
            {launchError ? <p className="mt-3 text-sm text-[var(--color-danger)]">{launchError}</p> : null}
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {snapshot.launchProfiles.length ? (
                snapshot.launchProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="rounded-[24px] border border-white/8 bg-white/4 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
                          {launchTargetLabel(profile.target)}
                        </p>
                        <p className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
                          {profile.label}
                        </p>
                      </div>
                      {profile.healthcheckUrl ? (
                        <Link
                          href={profile.healthcheckUrl}
                          target="_blank"
                          className="text-[var(--color-muted)] transition hover:text-[var(--color-accent)]"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                      Command: <span className="font-mono">{profile.command}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => runLaunch(profile.id)}
                      disabled={launchBusyId === profile.id}
                      className="glass-button mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {launchBusyId === profile.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Rocket className="h-4 w-4" />
                      )}
                      Launch this profile
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-white/3 p-6 text-sm text-[var(--color-muted)]">
                  No launch profiles were detected for this project.
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Recent launches</h2>
              <div className="mt-5 space-y-3">
                {snapshot.launchRuns.length ? (
                  snapshot.launchRuns.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-[22px] border border-white/8 bg-white/4 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-ink)]">
                            {run.summary}
                          </p>
                          <p className="mt-2 text-xs text-[var(--color-muted)]">
                            Started {formatDateTime(run.startedAt)}
                          </p>
                        </div>
                        <StatusPill status={run.status} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-white/3 p-6 text-sm text-[var(--color-muted)]">
                    No launch runs yet.
                  </div>
                )}
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Launch evidence</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {snapshot.artifacts
                  .filter((artifact) => artifact.kind === "launch-report" || artifact.kind === "launch-log")
                  .map((artifact) => (
                    <ArtifactLink
                      key={artifact.id}
                      artifact={artifact}
                      description="Evidence captured from a launch run."
                    />
                  ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {view === "deploy" ? (
        <section className="space-y-6">
          <div className="panel rounded-[30px] p-6">
            <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Deployment profiles</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">
              Deployment targets extend the existing subsystem. Sensitive targets stay behind an
              approval prompt and always write logs plus a deployment report.
            </p>
            {deployError ? <p className="mt-3 text-sm text-[var(--color-danger)]">{deployError}</p> : null}
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {snapshot.deployProfiles.length ? (
                snapshot.deployProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="rounded-[24px] border border-white/8 bg-white/4 p-5"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
                      {deployTargetLabel(profile.target)}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
                      {profile.label}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                      Command: <span className="font-mono">{profile.command}</span>
                    </p>
                    <p className="mt-2 text-xs text-[var(--color-muted)]">
                      {profile.approvalRequired
                        ? "Operator approval required before execution."
                        : "No extra approval is required for this target."}
                    </p>
                    <button
                      type="button"
                      onClick={() => runDeploy(profile.id, profile.approvalRequired)}
                      disabled={deployBusyId === profile.id}
                      className="glass-button mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deployBusyId === profile.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <UploadCloud className="h-4 w-4" />
                      )}
                      Run deployment
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-white/3 p-6 text-sm text-[var(--color-muted)]">
                  No deployment profiles were detected for this project.
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                Deployment runs
              </h2>
              <div className="mt-5 space-y-3">
                {snapshot.deployRuns.length ? (
                  snapshot.deployRuns.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-[22px] border border-white/8 bg-white/4 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-ink)]">
                            {run.summary}
                          </p>
                          <p className="mt-2 text-xs text-[var(--color-muted)]">
                            Started {formatDateTime(run.startedAt)}
                          </p>
                        </div>
                        <StatusPill status={run.status} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-white/3 p-6 text-sm text-[var(--color-muted)]">
                    No deployment runs yet.
                  </div>
                )}
              </div>
            </div>

            <div className="panel rounded-[30px] p-6">
              <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                Deployment artifacts
              </h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {snapshot.artifacts
                  .filter(
                    (artifact) =>
                      artifact.kind === "deployment-report" ||
                      artifact.kind === "deployment-log",
                  )
                  .map((artifact) => (
                    <ArtifactLink
                      key={artifact.id}
                      artifact={artifact}
                      description="Evidence captured from a deployment run."
                    />
                  ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
