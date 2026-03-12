"use client";

import { DEPLOYMENT_TARGETS } from "@/lib/constants";
import {
  deploymentTargetLabel,
  deploymentTargetScopeNote,
  toggleDeploymentTargetSelection,
} from "@/lib/project-pipeline";
import type { DeploymentTarget } from "@/lib/types";

export function DeploymentTargetsField({
  selectedTargets,
  onChange,
}: {
  selectedTargets: DeploymentTarget[];
  onChange: (targets: DeploymentTarget[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {DEPLOYMENT_TARGETS.map((target) => {
          const selected = selectedTargets.includes(target);
          const scopeNote = deploymentTargetScopeNote(target);

          return (
            <label
              key={target}
              className={`cursor-pointer rounded-[20px] border p-4 transition ${
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                  : "border-white/8 bg-white/4 hover:border-[var(--color-accent)]"
              }`}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() =>
                  onChange(toggleDeploymentTargetSelection(selectedTargets, target))
                }
                className="sr-only"
              />
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {deploymentTargetLabel(target)}
              </p>
              <p className="mt-2 text-xs leading-6 text-[var(--color-muted)]">
                {selected ? "Included in project scope." : "Not included in project scope."}
              </p>
              {scopeNote ? (
                <p className="mt-2 text-xs leading-6 text-amber-100/80">{scopeNote}</p>
              ) : null}
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-6 text-[var(--color-muted)]">
        At least one deployment target stays selected.
      </p>
    </div>
  );
}
