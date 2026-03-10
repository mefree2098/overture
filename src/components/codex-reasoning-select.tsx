"use client";

import type { CodexReasoningEffortOption } from "@/lib/codex-reasoning";
import type { CodexReasoningEffort } from "@/lib/types";

export function CodexReasoningSelect({
  id,
  name,
  value,
  onChange,
  options,
}: {
  id?: string;
  name?: string;
  value: CodexReasoningEffort;
  onChange: (value: CodexReasoningEffort) => void;
  options: CodexReasoningEffortOption[];
}) {
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="space-y-2">
      <select
        id={id}
        name={name}
        value={selectedOption?.value ?? value}
        onChange={(event) => onChange(event.target.value as CodexReasoningEffort)}
        className="glass-input w-full rounded-[22px] px-4 py-3"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs leading-6 text-[var(--color-muted)]">
        {selectedOption?.description}
      </p>
    </div>
  );
}
