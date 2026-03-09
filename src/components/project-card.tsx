import Link from "next/link";
import { ArrowUpRight, FolderKanban } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import type { ProjectSummary } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

export function ProjectCard({ summary }: { summary: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${summary.project.id}`}
      className="panel group flex h-full flex-col justify-between rounded-[28px] border p-5 transition duration-200 hover:-translate-y-1 hover:border-[var(--color-accent)]"
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[var(--color-muted)]">
              <FolderKanban className="h-4 w-4" />
              <span className="font-mono text-[11px] uppercase tracking-[0.24em]">
                {summary.project.executionMode === "local_chatgpt"
                  ? "Local ChatGPT"
                  : "Hosted API"}
              </span>
            </div>
            <h3 className="text-2xl font-semibold text-[var(--color-ink)]">
              {summary.project.name}
            </h3>
          </div>
          <ArrowUpRight className="h-5 w-5 text-[var(--color-muted)] transition group-hover:text-[var(--color-accent)]" />
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={summary.project.health} />
          <StatusPill status={summary.gateStatus.releaseStatus} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm text-[var(--color-muted)]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Current milestone
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {summary.currentMilestone ?? "Ready to execute"}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Failing gates
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {summary.failingGates}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Completed tasks
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {summary.counts.done + summary.counts.waived}
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Last activity
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {formatRelativeTime(summary.project.lastActivityAt)}
          </p>
        </div>
      </div>
    </Link>
  );
}
