import type { ProjectRecord } from "@/lib/types";

export function buildResearchPrompt(input: {
  project: ProjectRecord;
  promptDraft: string;
  repoSummary?: string | null;
}) {
  return [
    `Project: ${input.project.name}`,
    `Repository source: ${input.project.repoSource}`,
    input.repoSummary ? `Repository context: ${input.repoSummary}` : null,
    "",
    "You are Overture's deep research stage.",
    "Research the request, browse when needed, and produce a grounded implementation plan.",
    "Keep plan.md separate from ticket decomposition. The plan is the canonical handoff into Overture's planner.",
    "Prefer native OpenAI/Codex web research first.",
    "Return a complete structured research bundle matching the provided JSON schema only.",
    "",
    "Canonical research prompt:",
    input.promptDraft,
  ]
    .filter(Boolean)
    .join("\n");
}
