import type { ResearchProvider } from "@/lib/types";

export interface ResearchProviderOption {
  value: ResearchProvider;
  label: string;
  description: string;
}

export interface ResearchProviderAvailability {
  codexNativeAvailable: boolean;
  openaiResponsesAvailable: boolean;
}

export const RESEARCH_PROVIDER_OPTIONS: ResearchProviderOption[] = [
  {
    value: "codex_native",
    label: "Codex native",
    description: "Uses Codex CLI research with native web search first.",
  },
  {
    value: "openai_responses",
    label: "OpenAI Responses",
    description: "Uses the hosted Responses API with web search when an API key is available.",
  },
];

export function isResearchProviderAvailable(
  provider: ResearchProvider,
  availability: ResearchProviderAvailability,
) {
  switch (provider) {
    case "openai_responses":
      return availability.openaiResponsesAvailable;
    default:
      return true;
  }
}

export function preferredResearchProvider(
  provider: ResearchProvider,
  availability: ResearchProviderAvailability,
): ResearchProvider {
  if (isResearchProviderAvailable(provider, availability)) {
    return provider;
  }

  if (availability.openaiResponsesAvailable) {
    return "openai_responses";
  }

  return "codex_native";
}
