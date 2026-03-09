"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, FolderKanban, Trash2 } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import type { ProjectSummary } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

export function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    const confirmed = window.confirm(
      `Delete "${summary.project.name}" and all of its stored runs, artifacts, tracker state, and runtime files? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${summary.project.id}`, {
          method: "DELETE",
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to delete project.");
        }

        router.refresh();
      } catch (deleteError) {
        setError(
          deleteError instanceof Error ? deleteError.message : "Failed to delete project.",
        );
      } finally {
        setDeleting(false);
      }
    });
  }

  return (
    <article className="panel group flex h-full flex-col justify-between rounded-[30px] p-6 transition duration-500 hover:[transform:perspective(1400px)_translateY(-10px)_rotateX(4deg)_rotateY(-4deg)] hover:border-[var(--color-accent)]">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[var(--color-muted)]">
              <FolderKanban className="h-4 w-4 text-[var(--color-accent)]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.24em]">
                {summary.project.executionMode === "local_chatgpt"
                  ? "ChatGPT-linked Codex"
                  : "API-backed Codex"}
              </span>
            </div>
            <h3 className="holo-text text-3xl font-semibold text-[var(--color-ink)]">
              {summary.project.name}
            </h3>
            <p className="max-w-[24rem] text-sm leading-6 text-[var(--color-muted)]">
              {summary.currentMilestone ?? "Execution fabric is primed and waiting for dispatch."}
            </p>
          </div>
          <Link
            href={`/projects/${summary.project.id}`}
            className="inline-flex items-center justify-center rounded-full border border-white/8 bg-white/4 p-3 text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            aria-label={`Open ${summary.project.name}`}
          >
            <ArrowUpRight className="h-5 w-5" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill status={summary.project.health} />
          <StatusPill status={summary.gateStatus.releaseStatus} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm text-[var(--color-muted)]">
        <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Current milestone
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {summary.currentMilestone ?? "Ready to execute"}
          </p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Failing gates
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {summary.failingGates}
          </p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Completed tasks
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {summary.counts.done + summary.counts.waived}
          </p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-white/4 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">
            Last activity
          </p>
          <p className="mt-2 text-base text-[var(--color-ink)]">
            {formatRelativeTime(summary.project.lastActivityAt)}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={`/projects/${summary.project.id}`}
          className="glass-button inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition"
        >
          Open project
          <ArrowUpRight className="h-4 w-4" />
        </Link>
        <button
          type="button"
          disabled={deleting}
          onClick={handleDelete}
          className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,123,123,0.32)] bg-[rgba(255,92,92,0.08)] px-5 py-3 text-sm font-semibold text-[var(--color-danger)] transition hover:bg-[rgba(255,92,92,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
    </article>
  );
}
