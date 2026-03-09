export const dynamic = "force-dynamic";

import { FolderSearch, Shield, Sparkles, Workflow } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { ProjectCreateForm } from "@/components/project-create-form";
import { listProjects } from "@/lib/server/repository";
import { getExecutionModeSupport } from "@/lib/server/runtime-config";

export default function HomePage() {
  const projects = listProjects();
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
      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="panel halo-ring rounded-[34px] p-6 lg:p-8">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--color-accent)]">
                Overture Runtime
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Deep Research In
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                LLM Plan Out
              </span>
            </div>
            <div className="space-y-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-[var(--color-muted)]">
                Mission Control
              </p>
              <h1 className="holo-text max-w-4xl text-balance text-5xl font-semibold leading-tight text-[var(--color-ink)] lg:text-6xl">
                Turn research blueprints into a live Symphony execution lattice.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-[var(--color-muted)]">
                Overture uses a real Codex-backed planner to decompose narrative product plans into
                milestone graphs, mirrors them through a Linear-compatible tracker surface, and
                launches Symphony as the autonomous execution runtime.
              </p>
            </div>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="metric-card rounded-[30px] p-5">
            <div className="flex items-center gap-3">
              <Workflow className="h-5 w-5 text-[var(--color-accent)]" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Projects
                </p>
                <p className="text-3xl font-semibold text-[var(--color-ink)]">
                  {operatorSummary.projects}
                </p>
              </div>
            </div>
          </div>
          <div className="metric-card rounded-[30px] p-5">
            <div className="flex items-center gap-3">
              <FolderSearch className="h-5 w-5 text-[var(--color-warning)]" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Blocked projects
                </p>
                <p className="text-3xl font-semibold text-[var(--color-ink)]">
                  {operatorSummary.blocked}
                </p>
              </div>
            </div>
          </div>
          <div className="metric-card rounded-[30px] p-5">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-[var(--color-success)]" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Open findings
                </p>
                <p className="text-3xl font-semibold text-[var(--color-ink)]">
                  {operatorSummary.openFindings}
                </p>
              </div>
            </div>
          </div>
          <div className="metric-card rounded-[30px] p-5">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-[var(--color-info)]" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  Release ready
                </p>
                <p className="text-3xl font-semibold text-[var(--color-ink)]">
                  {operatorSummary.releaseReady}
                </p>
              </div>
            </div>
          </div>
        </section>
      </section>

      <ProjectCreateForm executionSupport={executionSupport} />

      <section className="space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
            Project Constellation
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--color-ink)]">
            Live control-plane workspaces
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
            No projects yet. Upload a blueprint and compile the first execution lattice.
          </div>
        )}
      </section>
    </main>
  );
}
