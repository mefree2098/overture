export const dynamic = "force-dynamic";

import { FolderSearch, Shield, Sparkles, Workflow } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { ProjectCreateForm } from "@/components/project-create-form";
import { listProjects } from "@/lib/server/repository";

export default function HomePage() {
  const projects = listProjects();
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
    <main className="space-y-6 pb-8">
      <ProjectCreateForm />

      <section className="grid gap-4 lg:grid-cols-4">
        <div className="panel rounded-[28px] p-5">
          <div className="flex items-center gap-3">
            <Workflow className="h-5 w-5 text-[var(--color-accent)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Projects
              </p>
              <p className="text-2xl font-semibold text-[var(--color-ink)]">
                {operatorSummary.projects}
              </p>
            </div>
          </div>
        </div>
        <div className="panel rounded-[28px] p-5">
          <div className="flex items-center gap-3">
            <FolderSearch className="h-5 w-5 text-[var(--color-warning)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Blocked projects
              </p>
              <p className="text-2xl font-semibold text-[var(--color-ink)]">
                {operatorSummary.blocked}
              </p>
            </div>
          </div>
        </div>
        <div className="panel rounded-[28px] p-5">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-[var(--color-success)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Open findings
              </p>
              <p className="text-2xl font-semibold text-[var(--color-ink)]">
                {operatorSummary.openFindings}
              </p>
            </div>
          </div>
        </div>
        <div className="panel rounded-[28px] p-5">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[var(--color-info)]" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                Release ready
              </p>
              <p className="text-2xl font-semibold text-[var(--color-ink)]">
                {operatorSummary.releaseReady}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            Projects
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--color-ink)]">
            Active control-plane workspaces
          </h2>
        </div>

        {projects.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.project.id} summary={project} />
            ))}
          </div>
        ) : (
          <div className="panel rounded-[28px] border-dashed p-8 text-center text-[var(--color-muted)]">
            No projects yet. Upload a blueprint and generate the first plan version.
          </div>
        )}
      </section>
    </main>
  );
}
