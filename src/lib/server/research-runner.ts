import { readFile } from "node:fs/promises";
import { buildResearchSummaryJson } from "@/lib/server/research-artifacts";
import { buildResearchPrompt } from "@/lib/server/research-prompt-builder";
import { runResearchProvider } from "@/lib/server/research-provider";
import {
  completeResearchRunRecord,
  createResearchRunRecord,
  failResearchRunRecord,
  getProjectSnapshot,
  lockWorkshopPrompt,
  writeArtifact,
} from "@/lib/server/repository";
import type { WorkshopSearchMode } from "@/lib/types";

export async function runProjectResearch(input: {
  projectId: string;
  searchMode?: WorkshopSearchMode;
}) {
  const snapshot = getProjectSnapshot(input.projectId);

  if (!snapshot) {
    throw new Error("Project not found.");
  }

  const existingPromptArtifact =
    snapshot.artifacts.find((artifact) => artifact.kind === "research-prompt") ?? null;

  const promptState = existingPromptArtifact
    ? {
        promptArtifactId: existingPromptArtifact.id,
        promptText: await readFile(existingPromptArtifact.filePath, "utf8"),
      }
    : (() => {
        const locked = lockWorkshopPrompt(snapshot.project.id);
        const artifact = getProjectSnapshot(snapshot.project.id)?.artifacts.find(
          (item) => item.id === locked.promptArtifactId,
        );

        if (!artifact) {
          throw new Error("Failed to lock a workshop prompt for research.");
        }

        return {
          promptArtifactId: locked.promptArtifactId,
          promptText: snapshot.workshopThread?.promptDraft ?? "",
        };
      })();

  const researchRunId = createResearchRunRecord({
    projectId: snapshot.project.id,
    provider: snapshot.project.researchProvider,
    searchMode: input.searchMode ?? snapshot.workshopThread?.searchMode ?? "live",
    promptArtifactId: promptState.promptArtifactId,
  });

  try {
    const bundle = await runResearchProvider({
      project: snapshot.project,
      provider: snapshot.project.researchProvider,
      searchMode: input.searchMode ?? snapshot.workshopThread?.searchMode ?? "live",
      prompt: buildResearchPrompt({
        project: snapshot.project,
        promptDraft: promptState.promptText,
        repoSummary: snapshot.project.repoSource,
      }),
    });

    const reportArtifactId = writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "research-report",
      label: "Deep research report",
      extension: "md",
      mimeType: "text/markdown",
      content: bundle.researchReport,
      metadata: {
        researchRunId,
        provider: snapshot.project.researchProvider,
      },
    });
    const planArtifactId = writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "research-plan",
      label: "Generated plan.md",
      extension: "md",
      mimeType: "text/markdown",
      content: bundle.planMarkdown,
      metadata: {
        researchRunId,
        provider: snapshot.project.researchProvider,
      },
    });
    const citationsArtifactId = writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "citations",
      label: "Research citations",
      extension: "json",
      mimeType: "application/json",
      content: JSON.stringify(bundle.citations, null, 2),
      metadata: {
        researchRunId,
      },
    });
    const summaryArtifactId = writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "research-summary",
      label: "Research summary",
      extension: "json",
      mimeType: "application/json",
      content: buildResearchSummaryJson(bundle),
      metadata: {
        researchRunId,
      },
    });

    if (bundle.architectureDecisions) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "architecture-decisions",
        label: "Architecture decisions",
        extension: "md",
        mimeType: "text/markdown",
        content: bundle.architectureDecisions,
        metadata: {
          researchRunId,
        },
      });
    }

    completeResearchRunRecord({
      researchRunId,
      projectId: snapshot.project.id,
      summary: bundle.summary,
      reportArtifactId,
      planArtifactId,
      citationsArtifactId,
      summaryArtifactId,
      metadata: {
        openQuestions: bundle.openQuestions,
        tokenUsage: bundle.tokenUsage ?? null,
      },
    });

    return {
      researchRunId,
      reportArtifactId,
      planArtifactId,
      citationsArtifactId,
      summaryArtifactId,
      summary: bundle.summary,
    };
  } catch (error) {
    failResearchRunRecord({
      researchRunId,
      projectId: snapshot.project.id,
      summary: error instanceof Error ? error.message : "Research run failed.",
      metadata: {
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      },
    });
    throw error;
  }
}
