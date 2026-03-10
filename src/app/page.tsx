export const dynamic = "force-dynamic";

import Link from "next/link";
import { Sparkles, Wand2 } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { ProjectCreateForm } from "@/components/project-create-form";
import { codexReasoningEffortLabel } from "@/lib/codex-reasoning";
import { getCodexModelOptions } from "@/lib/model-catalog";
import { getAppSettings } from "@/lib/server/app-settings";
import { listProjects } from "@/lib/server/repository";
import { getExecutionModeSupport } from "@/lib/server/runtime-config";

export default function HomePage() {
  const projects = listProjects();
  const appSettings = getAppSettings();
  const executionSupport = getExecutionModeSupport();
  const modelOptions = getCodexModelOptions([
    appSettings.plannerModel,
    appSettings.executionModel,
  ]);
  const projectSummary = {
    projects: projects.length,
    inProgress: projects.filter(
      (project) => project.project.health === "on_track" || project.project.health === "at_risk",
    ).length,
    releaseReady: projects.filter((project) => project.gateStatus.releaseStatus === "pass")
      .length,
  };

  return (
    <main className="space-y-8 pb-10">
      <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="panel halo-ring rounded-[34px] p-6 lg:p-8">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--color-accent)]">
              Start here
            </div>
            <div className="space-y-4">
              <h1 className="holo-text max-w-4xl text-balance text-5xl font-semibold leading-tight text-[var(--color-ink)] lg:text-6xl">
                Start from a finished plan or let Overture build one with you.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-[var(--color-muted)]">
                You do not need to create tickets, coordinate agents, or remember the testing
                steps. Overture can take a finished `plan.md`, or start from rough notes and walk
                you through workshop, research, plan review, execution, launch, and deploy.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[26px] border border-white/8 bg-white/4 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  Guided path
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                  Start from notes, goals, or raw research. Overture opens the Prompt Workshop and
                  creates the plan for you.
                </p>
              </div>
              <div className="rounded-[26px] border border-white/8 bg-white/4 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  Quick path
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                  Already have `plan.md`? Paste it in and Overture skips straight to plan
                  ingestion and execution review.
                </p>
              </div>
              <div className="rounded-[26px] border border-white/8 bg-white/4 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  After approval
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                  Symphony execution, local launch, deployment runs, and the evidence trail all
                  stay in one place.
                </p>
              </div>
            </div>
          </div>
        </div>

        <section className="space-y-4">
          <div className="panel rounded-[30px] p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-[18px] border border-white/10 bg-white/6">
                <Wand2 className="h-5 w-5 text-[var(--color-accent)]" />
              </div>
              <div className="space-y-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  Before you begin
                </p>
                <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                  Overture is ready to plan and run projects
                </h2>
                <p className="text-sm leading-7 text-[var(--color-muted)]">
                  If you want to change the model, run mode, or project defaults, use Settings.
                  Otherwise you can stay on this page and start right away.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Planning model
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {appSettings.plannerModel ?? "Codex default"}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Execution model
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {appSettings.executionModel ?? "Codex default"}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Planning thinking
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {codexReasoningEffortLabel(appSettings.plannerReasoningEffort)}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Agent thinking
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {codexReasoningEffortLabel(appSettings.executionReasoningEffort)}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Research provider
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {appSettings.defaultResearchProvider}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Default run mode
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {appSettings.defaultExecutionMode === "local_chatgpt"
                    ? "Local ChatGPT Codex"
                    : "Hosted API Codex"}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  Account status
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {executionSupport.localChatgptAvailable
                    ? "Your ChatGPT Codex login is ready"
                    : executionSupport.hostedApiAvailable
                      ? "Hosted API mode is ready"
                      : "A Codex login is still needed"}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href="/settings"
                className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition"
              >
                Change settings
                <Sparkles className="h-4 w-4" />
              </Link>
              <span className="text-sm text-[var(--color-muted)]">
                Settings control the research provider, models, thinking levels, and run mode.
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="metric-card rounded-[28px] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Projects
              </p>
              <p className="mt-3 text-3xl font-semibold text-[var(--color-ink)]">
                {projectSummary.projects}
              </p>
            </div>
            <div className="metric-card rounded-[28px] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                In progress
              </p>
              <p className="mt-3 text-3xl font-semibold text-[var(--color-ink)]">
                {projectSummary.inProgress}
              </p>
            </div>
            <div className="metric-card rounded-[28px] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Release ready
              </p>
              <p className="mt-3 text-3xl font-semibold text-[var(--color-ink)]">
                {projectSummary.releaseReady}
              </p>
            </div>
          </div>
        </section>
      </section>

      <ProjectCreateForm
        executionSupport={executionSupport}
        appSettings={appSettings}
        modelOptions={modelOptions}
      />

      <section className="space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
            Your projects
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--color-ink)]">
            Saved project runs
          </h2>
        </div>

        {projects.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.project.id} summary={project} />
            ))}
          </div>
        ) : (
          <div className="panel rounded-[30px] border-dashed p-10 text-center text-[var(--color-muted)]">
            No projects yet. Start by naming a project and pasting a plan below.
          </div>
        )}
      </section>
    </main>
  );
}
