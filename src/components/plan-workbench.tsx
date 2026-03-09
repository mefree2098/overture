"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, GitBranchPlus } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import type {
  DependencyEdgeRecord,
  PlanVersionRecord,
  WorkItemRecord,
} from "@/lib/types";

function childIdsFor(
  dependencyEdges: DependencyEdgeRecord[],
  workItemId: string,
  direction: "incoming" | "outgoing",
) {
  return dependencyEdges
    .filter((edge) =>
      direction === "incoming"
        ? edge.toWorkItemId === workItemId
        : edge.fromWorkItemId === workItemId,
    )
    .map((edge) => (direction === "incoming" ? edge.fromWorkItemId : edge.toWorkItemId));
}

export function PlanWorkbench({
  workItems,
  dependencyEdges,
  planVersion,
}: {
  workItems: WorkItemRecord[];
  dependencyEdges: DependencyEdgeRecord[];
  planVersion: PlanVersionRecord | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(workItems[0]?.id ?? null);
  const selectedItem = workItems.find((workItem) => workItem.id === selectedId) ?? workItems[0];
  const grouped = workItems.filter((workItem) => !workItem.parentId);

  function renderTree(parentId: string | null, depth = 0) {
    return workItems
      .filter((workItem) => workItem.parentId === parentId)
      .map((item) => {
        const children = workItems.filter((workItem) => workItem.parentId === item.id);

        return (
          <div
            key={item.id}
            className={
              depth === 0
                ? "rounded-[24px] border border-white/8 bg-white/4 p-4"
                : "mt-2 border-l border-dashed border-[var(--color-border)] pl-4"
            }
          >
            <button
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`flex w-full items-start justify-between gap-3 text-left ${
                depth > 0 ? "rounded-2xl px-3 py-2 transition hover:bg-[var(--color-accent-soft)]" : ""
              }`}
            >
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                  {item.key}
                </p>
                <p
                  className={`mt-1 text-[var(--color-ink)] ${
                    depth === 0 ? "text-base font-semibold" : "text-sm"
                  }`}
                >
                  {item.title}
                </p>
              </div>
              <StatusPill status={item.status} className={depth > 0 ? "shrink-0" : undefined} />
            </button>
            {children.length ? <div className="mt-2">{renderTree(item.id, depth + 1)}</div> : null}
          </div>
        );
      });
  }

  if (!selectedItem) {
    return null;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.88fr_1.12fr_0.9fr]">
      <div className="panel fine-scrollbar max-h-[720px] overflow-auto rounded-[30px] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Plan outline
            </p>
            <h3 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
              Project structure
            </h3>
          </div>
          <GitBranchPlus className="h-5 w-5 text-[var(--color-accent)]" />
        </div>

        <div className="space-y-4">
          {grouped.length ? renderTree(null) : null}
        </div>
      </div>

      <div className="panel rounded-[30px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Selected step
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={selectedItem.status} />
              <StatusPill status={selectedItem.type} />
            </div>
            <h3 className="text-3xl font-semibold text-[var(--color-ink)]">
              {selectedItem.title}
            </h3>
            <p className="max-w-2xl text-[15px] leading-7 text-[var(--color-muted)]">
              {selectedItem.description}
            </p>
          </div>
          <div className="rounded-[24px] border border-white/8 bg-white/4 px-4 py-3 text-right">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Priority
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
              P{selectedItem.priority}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Acceptance criteria
            </p>
            <ul className="mt-3 space-y-3">
              {selectedItem.acceptanceCriteria.length ? (
                selectedItem.acceptanceCriteria.map((criterion) => (
                  <li
                    key={criterion}
                    className="flex items-start gap-3 text-sm text-[var(--color-muted)]"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-[var(--color-success)]" />
                    <span>{criterion}</span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-[var(--color-muted)]">
                  No explicit criteria were parsed for this item.
                </li>
              )}
            </ul>
          </div>
          <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Dependency map
            </p>
            <div className="mt-3 space-y-4 text-sm text-[var(--color-muted)]">
              <div>
                <p className="font-semibold text-[var(--color-ink)]">Blocked by</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {childIdsFor(dependencyEdges, selectedItem.id, "incoming").map((id) => {
                    const item = workItems.find((candidate) => candidate.id === id);
                    if (!item) {
                      return null;
                    }
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-1"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        {item.key}
                      </span>
                    );
                  })}
                  {!childIdsFor(dependencyEdges, selectedItem.id, "incoming").length ? (
                    <span>Ready to start.</span>
                  ) : null}
                </div>
              </div>
              <div>
                <p className="font-semibold text-[var(--color-ink)]">Unblocks</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {childIdsFor(dependencyEdges, selectedItem.id, "outgoing").map((id) => {
                    const item = workItems.find((candidate) => candidate.id === id);
                    if (!item) {
                      return null;
                    }
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/4 px-3 py-1"
                      >
                        {item.key}
                      </span>
                    );
                  })}
                  {!childIdsFor(dependencyEdges, selectedItem.id, "outgoing").length ? (
                    <span>This is a leaf item.</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel rounded-[30px] p-5">
        <div className="space-y-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Planner notes
            </p>
            <h3 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
              What Overture added or inferred
            </h3>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
            <p className="font-semibold text-[var(--color-ink)]">Inferred scope</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
              {planVersion?.review.inferred.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
            <p className="font-semibold text-[var(--color-ink)]">Mandatory injections</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
              {planVersion?.review.injected.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
            <p className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
              <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
              Key risks
            </p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
              {planVersion?.review.risks.length ? (
                planVersion.review.risks.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>No major risks were extracted from the spec.</li>
              )}
            </ul>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
            <p className="font-semibold text-[var(--color-ink)]">Open questions</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--color-muted)]">
              {planVersion?.review.openQuestions.length ? (
                planVersion.review.openQuestions.map((item) => <li key={item}>{item}</li>)
              ) : (
                <li>No unresolved questions were found in the source plan.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
