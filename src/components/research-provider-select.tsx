"use client";

import {
  RESEARCH_PROVIDER_OPTIONS,
  isResearchProviderAvailable,
  type ResearchProviderAvailability,
} from "@/lib/research-provider-catalog";
import type { ResearchProvider } from "@/lib/types";

export function ResearchProviderSelect({
  id,
  name,
  value,
  availability,
  onChange,
}: {
  id: string;
  name: string;
  value: ResearchProvider;
  availability: ResearchProviderAvailability;
  onChange: (value: ResearchProvider) => void;
}) {
  const selected =
    RESEARCH_PROVIDER_OPTIONS.find((option) => option.value === value) ??
    RESEARCH_PROVIDER_OPTIONS[0];

  return (
    <div className="space-y-2">
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value as ResearchProvider)}
        className="glass-input w-full rounded-[22px] px-4 py-3"
      >
        {RESEARCH_PROVIDER_OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={!isResearchProviderAvailable(option.value, availability)}
          >
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs leading-6 text-[var(--color-muted)]">
        {selected.description}{" "}
        {!isResearchProviderAvailable(selected.value, availability)
          ? selected.value === "openai_responses"
            ? "Requires OPENAI_API_KEY on this machine."
            : "Requires Codex CLI plus a usable Codex login on this machine."
          : ""}
      </p>
    </div>
  );
}
