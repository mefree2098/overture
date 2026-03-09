export const dynamic = "force-dynamic";

import Link from "next/link";
import { Sparkles, Wand2 } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { ProjectCreateForm } from "@/components/project-create-form";
import { getAppSettings } from "@/lib/server/app-settings";
import { listProjects } from "@/lib/server/repository";
import { getExecutionModeSupport } from "@/lib/server/runtime-config";

export default function HomePage() {
  const projects = listProjects();
  const appSettings = getAppSettings();
  const executionSupport = getExecutionModeSupport();
  const operatorSummary = {
    projects: projects.length,
    blocked: projects.filter((project) => project.project.health === "blocked").length,
    openFindings: projects.reduce(
      (total, project) => total + Number(project.gateStatus.summary.openFindings ?? 0),
      0,
    ),
    releaseReady: projects.filter(
      (project) => project.gateStatus.releaseStatus === "pass",
    ).length,
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
                Paste your plan. Overture turns it into a working project run.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-[var(--color-muted)]">
                You do not need to write tickets or manage agents yourself. Overture reads the plan,
                breaks it into clear steps, and launches an automated run with testing, security,
                and deployment checks built in.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[26px] border border-white/8 bg-white/4 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  1. Add your plan
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                  Paste a markdown plan or upload a file. Headings and notes are fine.
                </p>
              </div>
              <div className="rounded-[26px] border border-white/8 bg-white/4 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  2. Review the draft
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                  Overture builds milestones, tickets, risks, and quality gates from the plan.
                </p>
              </div>
              <div className="rounded-[26px] border border-white/8 bg-white/4 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                  3. Start the run
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
                  Launch Symphony and track progress, evidence, and results from one place.
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
                  Ready to create
                </p>
                <h2 className="text-2xl font-semibold text-[var(--color-ink)]">
                  Current platform defaults
                </h2>
                <p className="text-sm leading-7 text-[var(--color-muted)]">
                  New projects will start with these saved settings. You can change them anytime.
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
                  Runtime status
                </p>
                <p className="mt-2 text-base text-[var(--color-ink)]">
                  {executionSupport.localChatgptAvailable
                    ? "ChatGPT auth ready"
                    : executionSupport.hostedApiAvailable
                      ? "API mode ready"
                      : "Needs Codex login"}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <Link
                href="/settings"
                className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition"
              >
                Open settings
                <Sparkles className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="metric-card rounded-[28px] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Projects
              </p>
              <p className="mt-3 text-3xl font-semibold text-[var(--color-ink)]">
                {operatorSummary.projects}
              </p>
            </div>
            <div className="metric-card rounded-[28px] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Open findings
              </p>
              <p className="mt-3 text-3xl font-semibold text-[var(--color-ink)]">
                {operatorSummary.openFindings}
              </p>
            </div>
            <div className="metric-card rounded-[28px] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Release ready
              </p>
              <p className="mt-3 text-3xl font-semibold text-[var(--color-ink)]">
                {operatorSummary.releaseReady}
              </p>
            </div>
          </div>
        </section>
      </section>

      <ProjectCreateForm
        executionSupport={executionSupport}
        appSettings={appSettings}
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
