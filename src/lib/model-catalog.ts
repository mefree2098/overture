export interface CodexModelOption {
  value: string;
  label: string;
  description: string;
  group: string;
}

const BASE_MODEL_OPTIONS: CodexModelOption[] = [
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    description: "Recommended default for most Codex tasks with strong coding and reasoning.",
    group: "Recommended coding models",
  },
  {
    value: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Industry-leading coding model for complex software engineering.",
    group: "Recommended coding models",
  },
  {
    value: "gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    description: "Near-instant research-preview coding model for fast iteration.",
    group: "Recommended coding models",
  },
  {
    value: "gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    description: "Advanced coding model for real-world engineering.",
    group: "Alternative models",
  },
  {
    value: "gpt-5.2",
    label: "GPT-5.2",
    description: "Previous general-purpose model for coding and agentic tasks.",
    group: "Alternative models",
  },
  {
    value: "gpt-5.1-codex-max",
    label: "GPT-5.1 Codex Max",
    description: "Optimized for longer-horizon agentic coding tasks.",
    group: "Alternative models",
  },
  {
    value: "gpt-5.1",
    label: "GPT-5.1",
    description: "General-purpose GPT-5 model that still works well for coding.",
    group: "Alternative models",
  },
  {
    value: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    description: "Long-running Codex-tuned model for agentic coding work.",
    group: "Alternative models",
  },
  {
    value: "gpt-5.1-codex-mini",
    label: "GPT-5.1 Codex Mini",
    description: "Smaller Codex-oriented model surfaced by the local Codex install.",
    group: "Alternative models",
  },
  {
    value: "gpt-5-codex",
    label: "GPT-5 Codex",
    description: "Older GPT-5 Codex model kept for compatibility and older workflows.",
    group: "Alternative models",
  },
  {
    value: "gpt-5-codex-mini",
    label: "GPT-5 Codex Mini",
    description: "Legacy smaller Codex model for lighter-weight runs.",
    group: "Alternative models",
  },
  {
    value: "gpt-5",
    label: "GPT-5",
    description: "Older reasoning-focused GPT-5 option for coding across domains.",
    group: "Alternative models",
  },
];

export function getCodexModelOptions(
  extraValues: Array<string | null | undefined> = [],
): CodexModelOption[] {
  const options = [...BASE_MODEL_OPTIONS];

  for (const extraValue of extraValues) {
    const normalized = extraValue?.trim();

    if (!normalized || options.some((option) => option.value === normalized)) {
      continue;
    }

    options.push({
      value: normalized,
      label: normalized,
      description: "Current saved model that is not in the default dropdown catalog.",
      group: "Current custom selections",
    });
  }

  return options;
}
