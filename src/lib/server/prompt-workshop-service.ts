import { readFile } from "node:fs/promises";
import { runCodexWorkshopTurn } from "@/lib/server/codex-app-server-client";
import {
  createWorkshopFork,
  getProjectSnapshot,
  getLatestWorkshopThread,
  lockWorkshopPrompt,
  recordWorkshopTurn,
} from "@/lib/server/repository";
import type { WorkshopSearchMode } from "@/lib/types";

export async function sendWorkshopMessage(input: {
  projectId: string;
  message: string;
  searchMode?: WorkshopSearchMode;
  repoContext?: string | null;
}) {
  const snapshot = getProjectSnapshot(input.projectId);

  if (!snapshot) {
    throw new Error("Project not found.");
  }

  const existingThread = getLatestWorkshopThread(input.projectId);
  const sourceBriefArtifact =
    !existingThread
      ? snapshot.artifacts.find((artifact) => artifact.kind === "source-brief") ?? null
      : null;
  const sourceBriefText = sourceBriefArtifact
    ? await readFile(sourceBriefArtifact.filePath, "utf8").catch(() => "")
    : "";
  const workshopMessage =
    sourceBriefText.trim() && !existingThread
      ? [
          "Use the following source brief as the primary context for this workshop turn.",
          "",
          "<source-brief>",
          sourceBriefText.trim(),
          "</source-brief>",
          "",
          "Current user instruction:",
          input.message,
        ].join("\n")
      : input.message;
  const result = await runCodexWorkshopTurn({
    projectName: snapshot.project.name,
    executionMode: snapshot.project.executionMode,
    message: workshopMessage,
    threadId: existingThread?.codexThreadId.trim() ? existingThread.codexThreadId : null,
    model: snapshot.project.plannerModel,
    reasoningEffort: snapshot.project.plannerReasoningEffort,
    searchMode: input.searchMode ?? existingThread?.searchMode ?? "cached",
    repoContext: input.repoContext ?? existingThread?.repoContext ?? snapshot.project.repoSource,
  });

  const persisted = recordWorkshopTurn({
    projectId: input.projectId,
    codexThreadId: result.threadId,
    title: result.title,
    searchMode: input.searchMode ?? existingThread?.searchMode ?? "cached",
    promptDraft: result.promptDraft,
    summary: result.summary,
    repoContext: input.repoContext ?? existingThread?.repoContext ?? snapshot.project.repoSource,
    userMessage: input.message,
    assistantMessage: result.assistantMessage,
    readyForResearch: result.readyForResearch,
    openQuestions: result.openQuestions,
  });

  return {
    ...persisted,
    ...result,
  };
}

export function finalizeWorkshopPrompt(projectId: string) {
  return lockWorkshopPrompt(projectId);
}

export function forkWorkshopThread(projectId: string) {
  return createWorkshopFork(projectId);
}
