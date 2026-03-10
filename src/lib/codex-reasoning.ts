import type { CodexReasoningEffort } from "@/lib/types";

export interface CodexReasoningEffortOption {
  value: CodexReasoningEffort;
  label: string;
  description: string;
}

const REASONING_OPTIONS: Record<CodexReasoningEffort, CodexReasoningEffortOption> = {
  low: {
    value: "low",
    label: "Low",
    description: "Fastest option with the least extra reasoning.",
  },
  medium: {
    value: "medium",
    label: "Medium",
    description: "Balanced reasoning depth for most planning and execution work.",
  },
  high: {
    value: "high",
    label: "High",
    description: "More deliberate reasoning for harder tickets and more complex plans.",
  },
  xhigh: {
    value: "xhigh",
    label: "Extra High",
    description: "Longest-horizon reasoning for newer Codex-capable GPT-5 models.",
  },
};

function normalizeModel(model: string | null | undefined) {
  const normalized = model?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function normalizeCodexReasoningEffort(
  value: string | null | undefined,
): CodexReasoningEffort {
  return value === "medium" || value === "high" || value === "xhigh" ? value : "low";
}

export function codexReasoningEffortLabel(value: CodexReasoningEffort) {
  return REASONING_OPTIONS[value].label;
}

export function getCodexReasoningEffortOptions(
  model: string | null | undefined,
): CodexReasoningEffortOption[] {
  const normalizedModel = normalizeModel(model);

  if (!normalizedModel) {
    return [
      REASONING_OPTIONS.low,
      REASONING_OPTIONS.medium,
      REASONING_OPTIONS.high,
      REASONING_OPTIONS.xhigh,
    ];
  }

  if (normalizedModel === "gpt-5-pro") {
    return [REASONING_OPTIONS.high];
  }

  if (/^gpt-5\.(2|3|4)\b/.test(normalizedModel)) {
    return [
      REASONING_OPTIONS.low,
      REASONING_OPTIONS.medium,
      REASONING_OPTIONS.high,
      REASONING_OPTIONS.xhigh,
    ];
  }

  return [REASONING_OPTIONS.low, REASONING_OPTIONS.medium, REASONING_OPTIONS.high];
}
