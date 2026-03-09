import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { accessSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getSymphonyTrackerToken,
  normalizeRepoSource,
  repoSourceForGitClone,
  resolveCodexBin,
} from "@/lib/server/runtime-config";
import type { ProjectRecord, SymphonyRuntimeRecord } from "@/lib/types";
import {
  getProjectPaths,
  getProjectRoot,
  getProjectWorkspaceRoot,
  getWorkspaceRoot,
} from "@/lib/server/storage";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function sanitizeSlugPortSegment(value: string) {
  return [...value].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function symphonyRoot() {
  return path.join(getWorkspaceRoot(), "vendor", "symphony", "elixir");
}

function symphonyBinaryPath() {
  return process.env.OVERTURE_SYMPHONY_BIN?.trim()
    ? path.resolve(process.env.OVERTURE_SYMPHONY_BIN)
    : path.join(symphonyRoot(), "bin", "symphony");
}

function mixBinaryPath() {
  const configured = process.env.OVERTURE_MIX_BIN?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  const homebrewMix = "/opt/homebrew/bin/mix";

  try {
    accessSync(homebrewMix, fsConstants.X_OK);
    return homebrewMix;
  } catch {
    return "mix";
  }
}

function toolEnv() {
  return {
    ...process.env,
    PATH: ["/opt/homebrew/bin", process.env.PATH ?? ""].filter(Boolean).join(":"),
  };
}

function symphonyPort(projectSlug: string) {
  const base = Number(process.env.OVERTURE_SYMPHONY_PORT_BASE ?? 4400);
  return base + (sanitizeSlugPortSegment(projectSlug) % 400);
}

function runtimePaths(projectSlug: string) {
  const projectRoot = getProjectRoot(projectSlug);
  const runtimeRoot = path.join(projectRoot, "symphony");

  return {
    runtimeRoot,
    workflowPath: path.join(runtimeRoot, "WORKFLOW.md"),
    runtimeFilePath: path.join(runtimeRoot, "runtime.json"),
    logsRoot: path.join(runtimeRoot, "logs"),
    bootstrapLogPath: path.join(runtimeRoot, "bootstrap.log"),
  };
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureSymphonyBuilt() {
  try {
    accessSync(symphonyBinaryPath(), fsConstants.X_OK);
    return;
  } catch {
    // Fall through and build.
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(mixBinaryPath(), ["setup"], {
      cwd: symphonyRoot(),
      env: toolEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || "mix setup failed"));
    });
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(mixBinaryPath(), ["build"], {
      cwd: symphonyRoot(),
      env: toolEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || "mix build failed"));
    });
  });

  accessSync(symphonyBinaryPath(), fsConstants.X_OK);
}

function buildWorkflow(
  project: ProjectRecord,
  origin: string,
  workflowPath: string,
) {
  const workspaceRoot = getProjectWorkspaceRoot(project.slug);
  const repoSource = repoSourceForGitClone(normalizeRepoSource(project.repoSource));
  const codexBin = resolveCodexBin();
  const codexCommand = [
    shellQuote(codexBin),
    "app-server",
    ...(project.executionModel ? ["--model", shellQuote(project.executionModel)] : []),
  ].join(" ");

  return [
    "---",
    "tracker:",
    "  kind: linear",
    `  endpoint: ${JSON.stringify(`${origin}/api/tracker/graphql`)}`,
    '  api_key: "$SYMPHONY_TRACKER_TOKEN"',
    `  project_slug: ${JSON.stringify(project.slug)}`,
    "  active_states:",
    "    - Todo",
    "    - In Progress",
    "  terminal_states:",
    "    - Done",
    "polling:",
    "  interval_ms: 4000",
    "workspace:",
    `  root: ${JSON.stringify(workspaceRoot)}`,
    "hooks:",
    "  after_create: |",
    `    git clone --depth 1 ${shellQuote(repoSource)} .`,
    "agent:",
    `  max_concurrent_agents: ${project.symphonyMaxConcurrentAgents}`,
    `  max_turns: ${project.symphonyMaxTurns}`,
    "observability:",
    "  refresh_ms: 1000",
    "codex:",
    `  command: ${JSON.stringify(codexCommand)}`,
    "  approval_policy: never",
    "  thread_sandbox: workspace-write",
    "  turn_sandbox_policy:",
    "    type: workspaceWrite",
    "---",
    "",
    "You are working on an Overture tracker issue.",
    "",
    "Issue context:",
    "Identifier: {{ issue.identifier }}",
    "Title: {{ issue.title }}",
    "Current status: {{ issue.state }}",
    "Labels: {{ issue.labels }}",
    "URL: {{ issue.url }}",
    "",
    "Description:",
    "{% if issue.description %}",
    "{{ issue.description }}",
    "{% else %}",
    "No description provided.",
    "{% endif %}",
    "",
    "Rules:",
    "1. This is an unattended execution run. Do not ask the user to perform follow-up work.",
    "2. Work only inside the provided repository copy.",
    "3. Use the available linear_graphql tool to keep tracker state current.",
    "4. If the issue is Todo, move it to In Progress immediately before implementation.",
    "5. Post concise progress notes to the tracker as comments only when they carry meaningful evidence or blockers.",
    "6. If blocked by missing auth, permissions, or an external dependency, add a blocker comment and move the issue to Blocked.",
    "7. When implementation is complete and local validation for the ticket passes, add a completion comment summarizing the evidence and move the issue to Review.",
    "8. Never move the issue to Done. Overture closes work only after external gate enforcement.",
    "9. Final message should list completed work, validation run, and blockers only.",
    "",
    "Tracker operations via linear_graphql:",
    "- Resolve a state id by name: query the current issue's team.states(filter: {name: {eq: ...}}, first: 1).",
    "- Update state: issueUpdate(id: ISSUE_ID, input: {stateId: STATE_ID}).",
    "- Add evidence or blocker note: commentCreate(input: {issueId: ISSUE_ID, body: BODY}).",
    "",
    "Execution bar:",
    "- Reproduce the task target before editing code when possible.",
    "- Make the smallest coherent change that satisfies the issue.",
    "- Run targeted validation before moving to Review.",
    "- Leave the workspace in a runnable state.",
    "",
    `Workflow file: ${workflowPath}`,
  ].join("\n");
}

async function readLogTail(filePath: string, maxLines = 24) {
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .trim()
      .split("\n")
      .slice(-maxLines)
      .filter(Boolean);
  } catch {
    return [] as string[];
  }
}

async function writeWorkflow(project: ProjectRecord, origin: string) {
  const paths = runtimePaths(project.slug);
  await mkdir(paths.runtimeRoot, { recursive: true });
  await mkdir(paths.logsRoot, { recursive: true });
  await writeFile(paths.workflowPath, buildWorkflow(project, origin, paths.workflowPath), "utf8");
  return paths;
}

async function readRuntimeFile(projectSlug: string) {
  const { runtimeFilePath } = runtimePaths(projectSlug);

  try {
    return JSON.parse(await readFile(runtimeFilePath, "utf8")) as {
      pid: number;
      port: number;
      workflowPath: string;
      logsRoot: string;
      bootstrapLogPath: string;
      startedAt: string;
    };
  } catch {
    return null;
  }
}

async function waitForSymphonyReady(runtime: {
  pid: number;
  port: number;
  bootstrapLogPath: string;
}) {
  const stateUrl = `http://127.0.0.1:${runtime.port}/api/v1/state`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20000) {
    if (!processIsRunning(runtime.pid)) {
      break;
    }

    try {
      const response = await fetch(stateUrl, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting for the observability server.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  const bootstrapTail = await readLogTail(runtime.bootstrapLogPath, 32);
  throw new Error(
    [
      `Symphony failed to become ready on port ${runtime.port}.`,
      ...bootstrapTail,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function getSymphonyRuntime(projectSlug: string) {
  const runtime = await readRuntimeFile(projectSlug);

  if (!runtime) {
    return null;
  }

  const running = processIsRunning(runtime.pid);
  const stateUrl = `http://127.0.0.1:${runtime.port}/api/v1/state`;
  let state: Record<string, unknown> | null = null;
  const bootstrapTail = await readLogTail(runtime.bootstrapLogPath);

  if (running) {
    try {
      const response = await fetch(stateUrl, { cache: "no-store" });
      if (response.ok) {
        state = (await response.json()) as Record<string, unknown>;
      }
    } catch {
      state = null;
    }
  }

  return {
    ...runtime,
    stateUrl,
    running,
    state,
    bootstrapTail,
  } satisfies SymphonyRuntimeRecord;
}

export async function startSymphonyForProject(project: ProjectRecord, origin: string) {
  const existing = await getSymphonyRuntime(project.slug);

  if (existing?.running) {
    try {
      await fetch(`http://127.0.0.1:${existing.port}/api/v1/refresh`, {
        method: "POST",
      });
    } catch {
      // Keep the existing runtime and let polling continue.
    }

    return existing;
  }

  await ensureSymphonyBuilt();
  const paths = await writeWorkflow(project, origin);
  await rm(paths.bootstrapLogPath, { force: true });

  const port = symphonyPort(project.slug);
  const outFd = openSync(paths.bootstrapLogPath, "a");
  const errFd = openSync(paths.bootstrapLogPath, "a");
  const args = [
    "--i-understand-that-this-will-be-running-without-the-usual-guardrails",
    "--logs-root",
    paths.logsRoot,
    "--port",
    String(port),
    paths.workflowPath,
  ];
  const child = spawn(symphonyBinaryPath(), args, {
    cwd: symphonyRoot(),
    detached: true,
    env: {
      ...toolEnv(),
      SYMPHONY_TRACKER_TOKEN: getSymphonyTrackerToken(),
    },
    stdio: ["ignore", outFd, errFd],
  });

  child.unref();

  const runtime = {
    pid: child.pid ?? -1,
    port,
    workflowPath: paths.workflowPath,
    logsRoot: paths.logsRoot,
    bootstrapLogPath: paths.bootstrapLogPath,
    startedAt: new Date().toISOString(),
  };

  await writeFile(
    paths.runtimeFilePath,
    JSON.stringify(runtime, null, 2),
    "utf8",
  );

  await waitForSymphonyReady(runtime);

  return (await getSymphonyRuntime(project.slug)) as SymphonyRuntimeRecord;
}

async function stopRuntimeProcess(pid: number) {
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGKILL"];

  for (const signal of signals) {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        return;
      }
    }

    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      if (!processIsRunning(pid)) {
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
    }
  }
}

export async function stopSymphonyForProject(projectSlug: string) {
  const runtime = await readRuntimeFile(projectSlug);
  const { projectRoot } = getProjectPaths(projectSlug);
  const runtimeFilePath = path.join(projectRoot, "symphony", "runtime.json");

  if (!runtime) {
    await rm(runtimeFilePath, { force: true });
    return { stopped: false };
  }

  if (runtime.pid > 0 && processIsRunning(runtime.pid)) {
    await stopRuntimeProcess(runtime.pid);
  }

  await rm(runtimeFilePath, { force: true });

  return {
    stopped: true,
    pid: runtime.pid,
    port: runtime.port,
  };
}
