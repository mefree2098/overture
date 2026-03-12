import type { ResearchProvider } from "@/lib/types";

export interface ResearchProviderOption {
  value: ResearchProvider;
  label: string;
  description: string;
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
