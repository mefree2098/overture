import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  advanceQueuedWorkItems,
  completeRun,
  createRun,
  getExecutableWorkItems,
  getProjectSnapshot,
  updateRunPhase,
  writeArtifact,
} from "@/lib/server/repository";
import { getProjectWorkspaceRoot } from "@/lib/server/storage";

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sanitizeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function executeProject(projectId: string) {
  let snapshot = getProjectSnapshot(projectId);

  if (!snapshot) {
    throw new Error(`Unknown project: ${projectId}`);
  }

  advanceQueuedWorkItems(projectId);

  while (true) {
    const queue = getExecutableWorkItems(projectId);
    if (!queue.length) {
      break;
    }

    snapshot = getProjectSnapshot(projectId);
    if (!snapshot) {
      throw new Error(`Project disappeared during execution: ${projectId}`);
    }

    const workItem = queue[0];
    const workspaceDir = path.join(
      getProjectWorkspaceRoot(snapshot.project.slug),
      `${workItem.key}-${sanitizeSegment(workItem.title)}`,
    );
    const workspaceLabel = `${snapshot.project.slug}/${path.basename(workspaceDir)}`;
    mkdirSync(workspaceDir, { recursive: true });

    const logPath = path.join(workspaceDir, "run.log");
    writeFileSync(logPath, "", "utf8");

    const runId = createRun({
      projectId,
      workItemId: workItem.id,
      runnerType: "mock-symphony",
      workspacePath: workspaceDir,
      logPath,
      summary: `Executing ${workItem.key} with mock Symphony orchestration.`,
    });

    appendFileSync(logPath, `[${new Date().toISOString()}] preparing workspace\n`);
    await sleep(160);
    updateRunPhase(runId, "building_prompt", `Built task contract for ${workItem.key}.`);

    appendFileSync(logPath, `[${new Date().toISOString()}] building prompt\n`);
    await sleep(160);
    updateRunPhase(runId, "streaming", `Streaming agent output for ${workItem.key}.`);

    appendFileSync(logPath, `[${new Date().toISOString()}] streaming agent events\n`);
    await sleep(160);
    updateRunPhase(runId, "verifying", `Collecting verification evidence for ${workItem.key}.`);

    const evidence = [
      `# ${workItem.key} execution artifact`,
      "",
      `Work item: ${workItem.title}`,
      `Type: ${workItem.type}`,
      `Workspace: ${workspaceLabel}`,
      "",
      "Acceptance criteria:",
      ...workItem.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      "",
      "Verification summary:",
      "- Workspace prepared",
      "- Prompt contract assembled",
      "- Mock Symphony run completed",
      "- Evidence committed to immutable artifact storage",
    ].join("\n");

    writeArtifact({
      projectId,
      projectSlug: snapshot.project.slug,
      workItemId: workItem.id,
      runId,
      kind: `${workItem.type}-artifact`,
      label: `${workItem.key} evidence`,
      extension: "md",
      mimeType: "text/markdown",
      content: evidence,
      metadata: {
        workspaceDir,
        simulated: true,
      },
    });

    if (workItem.type === "deploy") {
      for (const target of ["Local", "Jetson", "Azure", "AWS"]) {
        writeArtifact({
          projectId,
          projectSlug: snapshot.project.slug,
          workItemId: workItem.id,
          runId,
          kind: "deploy-plan",
          label: `${target} deployment plan`,
          extension: "md",
          mimeType: "text/markdown",
          content: `# ${target} deployment proof\n\nGenerated as part of ${workItem.key}.`,
          metadata: {
            target: target.toLowerCase(),
            simulated: true,
          },
        });
      }
    }

    if (workItem.type === "qa") {
      writeArtifact({
        projectId,
        projectSlug: snapshot.project.slug,
        workItemId: workItem.id,
        runId,
        kind: "qa-report",
        label: "QA verification summary",
        extension: "md",
        mimeType: "text/markdown",
        content:
          "# QA summary\n\nUnit, integration, end-to-end, lint, and build verification are represented in the gate evidence.",
        metadata: {
          simulated: true,
        },
      });
    }

    if (workItem.type === "security") {
      writeArtifact({
        projectId,
        projectSlug: snapshot.project.slug,
        workItemId: workItem.id,
        runId,
        kind: "security-report",
        label: "Security verification summary",
        extension: "md",
        mimeType: "text/markdown",
        content:
          "# Security summary\n\nThreat notes, scanner outputs, and closure rules are attached through the security gate artifacts.",
        metadata: {
          simulated: true,
        },
      });
    }

    completeRun({
      runId,
      projectId,
      workItemId: workItem.id,
      summary: `${workItem.key} completed with evidence captured in ${workspaceLabel}.`,
      succeeded: true,
    });

    appendFileSync(logPath, `[${new Date().toISOString()}] completed\n`);
    await sleep(100);
  }
}

const projectId = process.argv[2];

if (!projectId) {
  throw new Error("Usage: tsx scripts/runner.ts <projectId>");
}

void executeProject(projectId);
