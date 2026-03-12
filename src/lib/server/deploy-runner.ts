import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  completeDeployRunRecord,
  createDeployRunRecord,
  failDeployRunRecord,
  getProjectSnapshot,
  refreshOperationalProfiles,
  writeArtifact,
} from "@/lib/server/repository";
import { getProjectRoot } from "@/lib/server/storage";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthcheck(url: string, timeoutMs = 90000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        cache: "no-store",
      });

      if (response.ok) {
        return response.status;
      }
    } catch {
      // keep polling
    }

    await sleep(1500);
  }

  throw new Error(`Timed out waiting for ${url} to become healthy after deployment.`);
}

function deploymentHealthUrl(input: {
  target: string;
  metadata?: Record<string, unknown>;
  commandOutput?: string;
}) {
  const configured =
    typeof input.metadata?.healthcheckUrl === "string"
      ? input.metadata.healthcheckUrl
      : null;

  if (configured) {
    return configured;
  }

  if (input.commandOutput) {
    const lines = input.commandOutput.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith("OVERTURE_HEALTHCHECK_URL=") || trimmed.startsWith("HEALTHCHECK_URL=")) {
        const [, rawUrl] = trimmed.split("=", 2);
        const url = rawUrl?.trim();

        if (url) {
          return url;
        }
      }

      if (trimmed.startsWith("OVERTURE_APP_URL=") || trimmed.startsWith("APP_URL=")) {
        const [, rawUrl] = trimmed.split("=", 2);
        const url = rawUrl?.trim();

        if (url) {
          return `${url.replace(/\/$/, "")}/api/health`;
        }
      }
    }
  }

  switch (input.target) {
    case "local":
      return "http://host.docker.internal:3000/api/health";
    default:
      return null;
  }
}

function buildDeploymentReport(input: {
  projectName: string;
  profileLabel: string;
  command: string;
  cwd: string;
  summary: string;
}) {
  return [
    `# Deployment report for ${input.projectName}`,
    "",
    `- Profile: ${input.profileLabel}`,
    `- Command: \`${input.command}\``,
    `- Working directory: \`${input.cwd}\``,
    "",
    "## Summary",
    input.summary,
  ].join("\n");
}

function safeLogTail(logPath: string, maxBytes = 24000) {
  try {
    const content = readFileSync(logPath, "utf8");
    return content.length > maxBytes ? content.slice(-maxBytes) : content;
  } catch {
    return "";
  }
}

export async function runProjectDeployment(input: {
  projectId: string;
  deployProfileId: string;
  confirmed?: boolean;
}) {
  refreshOperationalProfiles(input.projectId);
  const snapshot = getProjectSnapshot(input.projectId);

  if (!snapshot) {
    throw new Error("Project not found.");
  }

  const profile = snapshot.deployProfiles.find((item) => item.id === input.deployProfileId);

  if (!profile) {
    throw new Error("Deployment profile not found.");
  }

  if (profile.approvalRequired && !input.confirmed) {
    throw new Error("This deployment target requires operator confirmation.");
  }

  const runRoot = path.join(getProjectRoot(snapshot.project.slug), "deploy");
  mkdirSync(runRoot, { recursive: true });
  const deployRunId = randomUUID();
  const logPath = path.join(runRoot, `${deployRunId}.log`);

  writeFileSync(
    logPath,
    [
      `# Deploy ${profile.label}`,
      `project=${snapshot.project.slug}`,
      `target=${profile.target}`,
      `command=${profile.command}`,
      `cwd=${profile.cwd}`,
      "",
    ].join("\n"),
    "utf8",
  );

  const persistedRunId = createDeployRunRecord({
    projectId: snapshot.project.id,
    deployProfileId: profile.id,
    summary: `Deploying via ${profile.label}.`,
    logPath,
    metadata: {
      target: profile.target,
      command: profile.command,
      cwd: profile.cwd,
      approvalRequired: profile.approvalRequired,
    },
  });

  try {
    const result = spawnSync("sh", ["-lc", profile.command], {
      cwd: profile.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
      encoding: "utf8",
      timeout:
        profile.target === "ios_testflight" || profile.target === "ios_app_store"
          ? 30 * 60_000
          : 15 * 60_000,
    });

    writeFileSync(
      logPath,
      [readFileSync(logPath, "utf8"), result.stdout ?? "", result.stderr ?? ""].join(""),
      "utf8",
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`Deployment command failed with exit code ${result.status}.`);
    }

    const commandOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const healthUrl = deploymentHealthUrl({
      target: profile.target,
      metadata: profile.metadata,
      commandOutput,
    });
    if (healthUrl) {
      await waitForHealthcheck(healthUrl, 120000);
    }

    const summary = `Deployment completed for ${profile.label}.`;
    const logTail = safeLogTail(logPath);

    writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "deployment-report",
      label: `${profile.label} deployment report`,
      extension: "md",
      mimeType: "text/markdown",
      content: buildDeploymentReport({
        projectName: snapshot.project.name,
        profileLabel: profile.label,
        command: profile.command,
        cwd: profile.cwd,
        summary,
      }),
      metadata: {
        deployRunId: persistedRunId,
        deployProfileId: profile.id,
      },
    });

    if (logTail.trim()) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "deployment-log",
        label: `${profile.label} deployment log`,
        extension: "log",
        mimeType: "text/plain",
        content: logTail,
        metadata: {
          deployRunId: persistedRunId,
          deployProfileId: profile.id,
        },
      });
    }

    completeDeployRunRecord({
      deployRunId: persistedRunId,
      projectId: snapshot.project.id,
      summary,
      metadata: {
        deployProfileId: profile.id,
        target: profile.target,
        ...(healthUrl ? { healthcheckUrl: healthUrl } : {}),
      },
    });

    return {
      deployRunId: persistedRunId,
      summary,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Deployment run failed.";
    const summary = `Deployment failed for ${profile.label}: ${message}`;
    const logTail = safeLogTail(logPath);

    writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "deployment-report",
      label: `${profile.label} deployment report`,
      extension: "md",
      mimeType: "text/markdown",
      content: buildDeploymentReport({
        projectName: snapshot.project.name,
        profileLabel: profile.label,
        command: profile.command,
        cwd: profile.cwd,
        summary,
      }),
      metadata: {
        deployRunId: persistedRunId,
        deployProfileId: profile.id,
        failed: true,
      },
    });

    if (logTail.trim()) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "deployment-log",
        label: `${profile.label} deployment log`,
        extension: "log",
        mimeType: "text/plain",
        content: logTail,
        metadata: {
          deployRunId: persistedRunId,
          deployProfileId: profile.id,
          failed: true,
        },
      });
    }

    failDeployRunRecord({
      deployRunId: persistedRunId,
      projectId: snapshot.project.id,
      summary: message,
      metadata: {
        deployProfileId: profile.id,
        logPath,
      },
    });

    throw error;
  }
}
