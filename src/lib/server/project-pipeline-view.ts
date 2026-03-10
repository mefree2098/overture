import { readFile } from "node:fs/promises";
import { getProjectSnapshot } from "@/lib/server/repository";

export async function getProjectPipelineViewData(projectId: string) {
  const snapshot = getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  const planArtifact = snapshot.artifacts.find((artifact) => artifact.kind === "research-plan");
  const reportArtifact = snapshot.artifacts.find(
    (artifact) => artifact.kind === "research-report",
  );

  return {
    snapshot,
    initialPlanMarkdown: planArtifact ? await readFile(planArtifact.filePath, "utf8") : "",
    initialResearchReport: reportArtifact
      ? await readFile(reportArtifact.filePath, "utf8")
      : "",
  };
}
