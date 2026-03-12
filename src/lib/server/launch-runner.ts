import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  completeLaunchRunRecord,
  createLaunchRunRecord,
  failLaunchRunRecord,
  getProjectSnapshot,
  refreshOperationalProfiles,
  writeArtifact,
} from "@/lib/server/repository";
import { getProjectRoot } from "@/lib/server/storage";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashProjectSlug(projectSlug: string) {
  let hash = 0;

  for (const character of projectSlug) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function managedPort(projectSlug: string, offset = 0) {
  return 3400 + (hashProjectSlug(projectSlug) % 200) + offset;
}

function remapUrlPort(input: string | null, port: number) {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input);
    url.hostname = "127.0.0.1";
    url.port = String(port);
    return url.toString();
  } catch {
    return input;
  }
}

function resolvedHealthUrl(input: {
  target: string;
  healthcheckUrl: string | null;
  projectSlug: string;
}) {
  if (!input.healthcheckUrl) {
    return null;
  }

  if (input.target === "web" || input.target === "api") {
    return remapUrlPort(input.healthcheckUrl, managedPort(input.projectSlug));
  }

  return input.healthcheckUrl;
}

async function waitForHealthcheck(url: string | null, timeoutMs = 90000) {
  if (!url) {
    return null;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        cache: "no-store",
      });

      if (response.ok) {
        return {
          status: response.status,
          url,
        };
      }
    } catch {
      // keep polling
    }

    await sleep(1500);
  }

  throw new Error(`Timed out waiting for ${url} to become healthy.`);
}

function safeReadLogTail(logPath: string, maxBytes = 24000) {
  try {
    const content = readFileSync(logPath, "utf8");
    return content.length > maxBytes ? content.slice(-maxBytes) : content;
  } catch {
    return "";
  }
}

async function captureLaunchScreenshot(input: {
  url: string | null;
  artifactPath: string;
}) {
  if (!input.url) {
    return null;
  }

  try {
    const playwright = await import("@playwright/test");
    const browser = await playwright.chromium.launch({ headless: true });

    try {
      const page = await browser.newPage({
        viewport: {
          width: 1440,
          height: 980,
        },
      });
      await page.goto(input.url, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.screenshot({
        path: input.artifactPath,
        fullPage: true,
      });
    } finally {
      await browser.close();
    }

    return input.artifactPath;
  } catch {
    return null;
  }
}

function composeDiagnostics(profile: {
  target: string;
  cwd: string;
}) {
  if (profile.target !== "docker") {
    return null;
  }

  const result = spawnSync("sh", ["-lc", "docker compose ps && printf '\\n---\\n\\n' && docker compose logs --tail=200"], {
    cwd: profile.cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
    encoding: "utf8",
    timeout: 120000,
  });

  if (result.error) {
    return `Unable to collect docker diagnostics: ${result.error.message}`;
  }

  return [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("");
}

function buildLaunchReport(input: {
  projectName: string;
  profileLabel: string;
  command: string;
  cwd: string;
  managedUrl: string | null;
  summary: string;
  pid?: number | null;
}) {
  return [
    `# Launch report for ${input.projectName}`,
    "",
    `- Profile: ${input.profileLabel}`,
    `- Command: \`${input.command}\``,
    `- Working directory: \`${input.cwd}\``,
    `- Managed URL: ${input.managedUrl ?? "n/a"}`,
    `- PID: ${input.pid ?? "n/a"}`,
    "",
    "## Summary",
    input.summary,
  ].join("\n");
}

function killDetachedProcess(pid: number | null | undefined) {
  if (!pid) {
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore cleanup failures
    }
  }
}

export async function runProjectLaunch(input: {
  projectId: string;
  launchProfileId: string;
}) {
  refreshOperationalProfiles(input.projectId);
  const snapshot = getProjectSnapshot(input.projectId);

  if (!snapshot) {
    throw new Error("Project not found.");
  }

  const profile = snapshot.launchProfiles.find((item) => item.id === input.launchProfileId);

  if (!profile) {
    throw new Error("Launch profile not found.");
  }

  const runRoot = path.join(getProjectRoot(snapshot.project.slug), "launch");
  mkdirSync(runRoot, { recursive: true });

  const launchRunId = randomUUID();
  const logPath = path.join(runRoot, `${launchRunId}.log`);
  const managedUrl = resolvedHealthUrl({
    target: profile.target,
    healthcheckUrl: profile.healthcheckUrl,
    projectSlug: snapshot.project.slug,
  });

  writeFileSync(
    logPath,
    [
      `# Launch ${profile.label}`,
      `project=${snapshot.project.slug}`,
      `target=${profile.target}`,
      `command=${profile.command}`,
      `cwd=${profile.cwd}`,
      "",
    ].join("\n"),
    "utf8",
  );

  const persistedRunId = createLaunchRunRecord({
    projectId: snapshot.project.id,
    launchProfileId: profile.id,
    summary: `Launching ${profile.label}.`,
    logPath,
    metadata: {
      target: profile.target,
      command: profile.command,
      cwd: profile.cwd,
      managedUrl,
    },
  });

  let launchedPid: number | null = null;

  try {
    let summary = "";
    let pid: number | null = null;

    if (profile.target === "web" || profile.target === "api") {
      const stdoutFd = openSync(logPath, "a");
      const port = managedPort(snapshot.project.slug);
      const child = spawn("sh", ["-lc", profile.command], {
        cwd: profile.cwd,
        env: {
          ...process.env,
          PORT: String(port),
          HOSTNAME: "127.0.0.1",
          OVERTURE_BIND_HOST: "127.0.0.1",
          FORCE_COLOR: "0",
        },
        detached: true,
        stdio: ["ignore", stdoutFd, stdoutFd],
      });
      closeSync(stdoutFd);

      pid = child.pid ?? null;
      launchedPid = pid;
      child.unref();

      const exitResult = new Promise<{ type: "exit"; code: number | null }>((resolve) => {
        child.once("exit", (code) => resolve({ type: "exit", code }));
      });
      const healthResult = waitForHealthcheck(managedUrl, 90000).then((health) => ({
        type: "healthy" as const,
        health,
      }));
      const outcome = await Promise.race([exitResult, healthResult]);

      if (outcome.type === "exit") {
        throw new Error(
          `Launch process exited before becoming ready (exit code ${outcome.code ?? "unknown"}).`,
        );
      }

      summary = `Launched ${profile.label} and verified ${outcome.health?.url}.`;
    } else {
      const port = managedPort(snapshot.project.slug, 1);
      const result = spawnSync("sh", ["-lc", profile.command], {
        cwd: profile.cwd,
        env: {
          ...process.env,
          PORT: String(port),
          HOSTNAME: "127.0.0.1",
          OVERTURE_BIND_HOST: "127.0.0.1",
          COMPOSE_PROJECT_NAME: `overture-${snapshot.project.slug}`,
          FORCE_COLOR: "0",
        },
        encoding: "utf8",
        timeout: profile.target === "ios_simulator" ? 20 * 60_000 : 10 * 60_000,
      });

      writeFileSync(
        logPath,
        [
          readFileSync(logPath, "utf8"),
          result.stdout ?? "",
          result.stderr ?? "",
        ].join(""),
        "utf8",
      );

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        throw new Error(`Launch command failed with exit code ${result.status}.`);
      }

      await waitForHealthcheck(managedUrl, 90000);
      summary = `Completed ${profile.label} launch steps successfully.`;
    }

    const logTail = safeReadLogTail(logPath);
    const screenshotPath = path.join(runRoot, `${launchRunId}.png`);
    const screenshotArtifactPath = await captureLaunchScreenshot({
      url: managedUrl,
      artifactPath: screenshotPath,
    });
    const dockerDiagnostics = composeDiagnostics({
      target: profile.target,
      cwd: profile.cwd,
    });

    writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "launch-report",
      label: `${profile.label} launch report`,
      extension: "md",
      mimeType: "text/markdown",
      content: buildLaunchReport({
        projectName: snapshot.project.name,
        profileLabel: profile.label,
        command: profile.command,
        cwd: profile.cwd,
        managedUrl,
        summary,
        pid,
      }),
      metadata: {
        launchRunId: persistedRunId,
        launchProfileId: profile.id,
      },
    });

    if (logTail.trim()) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "launch-log",
        label: `${profile.label} launch log`,
        extension: "log",
        mimeType: "text/plain",
        content: logTail,
        metadata: {
          launchRunId: persistedRunId,
          launchProfileId: profile.id,
        },
      });
    }

    if (screenshotArtifactPath) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "launch-screenshot",
        label: `${profile.label} screenshot`,
        extension: "png",
        mimeType: "image/png",
        content: readFileSync(screenshotArtifactPath),
        metadata: {
          launchRunId: persistedRunId,
          launchProfileId: profile.id,
          url: managedUrl,
        },
      });
    }

    if (dockerDiagnostics?.trim()) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "launch-diagnostics",
        label: `${profile.label} diagnostics`,
        extension: "log",
        mimeType: "text/plain",
        content: dockerDiagnostics,
        metadata: {
          launchRunId: persistedRunId,
          launchProfileId: profile.id,
        },
      });
    }

    completeLaunchRunRecord({
      launchRunId: persistedRunId,
      projectId: snapshot.project.id,
      summary,
      metadata: {
        launchProfileId: profile.id,
        managedUrl,
        pid,
      },
    });

    return {
      launchRunId: persistedRunId,
      summary,
      managedUrl,
      pid,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Launch run failed.";
    const summary = `Launch failed for ${profile.label}: ${message}`;
    const logTail = safeReadLogTail(logPath);
    const dockerDiagnostics = composeDiagnostics({
      target: profile.target,
      cwd: profile.cwd,
    });

    writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: "launch-report",
      label: `${profile.label} launch report`,
      extension: "md",
      mimeType: "text/markdown",
      content: buildLaunchReport({
        projectName: snapshot.project.name,
        profileLabel: profile.label,
        command: profile.command,
        cwd: profile.cwd,
        managedUrl,
        summary,
        pid: launchedPid,
      }),
      metadata: {
        launchRunId: persistedRunId,
        launchProfileId: profile.id,
        failed: true,
      },
    });

    if (logTail.trim()) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "launch-log",
        label: `${profile.label} launch log`,
        extension: "log",
        mimeType: "text/plain",
        content: logTail,
        metadata: {
          launchRunId: persistedRunId,
          launchProfileId: profile.id,
          failed: true,
        },
      });
    }

    if (dockerDiagnostics?.trim()) {
      writeArtifact({
        projectId: snapshot.project.id,
        projectSlug: snapshot.project.slug,
        kind: "launch-diagnostics",
        label: `${profile.label} diagnostics`,
        extension: "log",
        mimeType: "text/plain",
        content: dockerDiagnostics,
        metadata: {
          launchRunId: persistedRunId,
          launchProfileId: profile.id,
          failed: true,
        },
      });
    }

    failLaunchRunRecord({
      launchRunId: persistedRunId,
      projectId: snapshot.project.id,
      summary: message,
      metadata: {
        launchProfileId: profile.id,
        logPath,
      },
    });

    killDetachedProcess(launchedPid);

    throw error;
  }
}
