import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { accessSync, openSync } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendProjectTokenUsageBySlug,
  getStoredProjectTokenUsageBySlug,
} from "@/lib/server/project-token-usage";
import {
  getSymphonyTrackerToken,
  normalizeRepoSource,
  resolveCodexBin,
} from "@/lib/server/runtime-config";
import type { ProjectRecord, SymphonyRuntimeRecord } from "@/lib/types";
import {
  getProjectPaths,
  getProjectRoot,
  getProjectWorkspaceRoot,
  getWorkspaceRoot,
} from "@/lib/server/storage";
import {
  EMPTY_TOKEN_USAGE,
  hasTokenUsage,
  maxTokenUsage,
  parseTokenUsage,
  subtractTokenUsage,
  tokenUsageAtLeast,
  type TokenUsage,
} from "@/lib/token-usage";

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

type PersistedSymphonyRuntime = {
  pid: number;
  port: number;
  workflowPath: string;
  logsRoot: string;
  bootstrapLogPath: string;
  startedAt: string;
  lastObservedTokenUsage: TokenUsage;
  persistedProjectTokenUsage: TokenUsage | null;
  projectTokenUsageArchivedAt: string | null;
};

const DEFAULT_BOOTSTRAP_LOG_TAIL_BYTES = Number(
  process.env.OVERTURE_BOOTSTRAP_LOG_TAIL_BYTES ?? 128 * 1024,
);

function buildWorkspaceBootstrapCommand(repoSource: string) {
  if (
    repoSource.startsWith("http://") ||
    repoSource.startsWith("https://") ||
    repoSource.startsWith("ssh://") ||
    repoSource.startsWith("git@")
  ) {
    return `git clone --depth 1 ${shellQuote(repoSource)} .`;
  }

  if (repoSource.startsWith("file://")) {
    return `git clone --depth 1 ${shellQuote(repoSource)} .`;
  }

  const sourcePath = path.resolve(repoSource);
  const sourceGitUrl = pathToFileURL(sourcePath).toString();

  return [
    `SOURCE_PATH=${shellQuote(sourcePath)}`,
    `if [ -d "$SOURCE_PATH/.git" ]; then`,
    `  git clone --depth 1 ${shellQuote(sourceGitUrl)} .`,
    "else",
    "  tar \\",
    '    --exclude=".git" \\',
    '    --exclude=".overture" \\',
    '    --exclude=".overture-e2e" \\',
    '    --exclude=".next" \\',
    '    --exclude="node_modules" \\',
    '    --exclude="playwright-report" \\',
    '    --exclude="test-results" \\',
    '    -C "$SOURCE_PATH" -cf - . | tar -xf -',
    "fi",
  ].join("\n");
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

  async function runMixCommand(args: string[], failureLabel: string) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(mixBinaryPath(), args, {
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

        reject(new Error(stderr.trim() || `${failureLabel} failed`));
      });
    });
  }

  await runMixCommand(["local.hex", "--force"], "mix local.hex");
  await runMixCommand(["local.rebar", "--force"], "mix local.rebar");
  await runMixCommand(["setup"], "mix setup");
  await runMixCommand(["build"], "mix build");

  accessSync(symphonyBinaryPath(), fsConstants.X_OK);
}

export function buildCodexAppServerCommand(project: Pick<ProjectRecord, "executionModel" | "executionReasoningEffort">) {
  const codexBin = resolveCodexBin();

  return [
    shellQuote(codexBin),
    "-c",
    shellQuote(`model_reasoning_effort="${project.executionReasoningEffort}"`),
    ...(project.executionModel ? ["--model", shellQuote(project.executionModel)] : []),
    "app-server",
  ].join(" ");
}

function buildWorkflow(
  project: ProjectRecord,
  origin: string,
  workflowPath: string,
) {
  const workspaceRoot = getProjectWorkspaceRoot(project.slug);
  const repoSource = normalizeRepoSource(project.repoSource);
  const workspaceBootstrapCommand = buildWorkspaceBootstrapCommand(repoSource);
  const codexCommand = buildCodexAppServerCommand(project);

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
    ...workspaceBootstrapCommand.split("\n").map((line) => `    ${line}`),
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

export async function readLogTail(
  filePath: string,
  maxLines = 24,
  maxBytes = DEFAULT_BOOTSTRAP_LOG_TAIL_BYTES,
) {
  try {
    const handle = await open(filePath, "r");

    try {
      const stats = await handle.stat();
      const safeMaxBytes = Math.max(1024, maxBytes);
      const start = Math.max(0, stats.size - safeMaxBytes);
      const length = stats.size - start;

      if (length <= 0) {
        return [] as string[];
      }

      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      let content = buffer.toString("utf8");

      if (start > 0) {
        const firstNewline = content.indexOf("\n");
        content = firstNewline >= 0 ? content.slice(firstNewline + 1) : "";
      }

      return content
        .replace(/\0/g, "")
        .trim()
        .split(/\r?\n/)
        .slice(-maxLines)
        .filter(Boolean);
    } finally {
      await handle.close();
    }
  } catch {
    return [] as string[];
  }
}

async function fetchStateSnapshot(stateUrl: string) {
  try {
    const response = await fetch(stateUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requestSymphonyShutdown(stateUrl: string) {
  const shutdownUrl = stateUrl.replace(/\/api\/v1\/state$/, "/api/v1/shutdown");

  try {
    const response = await fetch(shutdownUrl, {
      method: "POST",
      signal: AbortSignal.timeout(1500),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function waitForSymphonyShutdown(stateUrl: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    const state = await fetchStateSnapshot(stateUrl);

    if (!state) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
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
    const payload = JSON.parse(await readFile(runtimeFilePath, "utf8")) as Record<
      string,
      unknown
    >;

    return {
      pid: Number(payload.pid ?? -1),
      port: Number(payload.port ?? -1),
      workflowPath: String(payload.workflowPath ?? ""),
      logsRoot: String(payload.logsRoot ?? ""),
      bootstrapLogPath: String(payload.bootstrapLogPath ?? ""),
      startedAt: String(payload.startedAt ?? ""),
      lastObservedTokenUsage: parseTokenUsage(payload.lastObservedTokenUsage),
      persistedProjectTokenUsage: hasTokenUsage(parseTokenUsage(payload.persistedProjectTokenUsage))
        ? parseTokenUsage(payload.persistedProjectTokenUsage)
        : null,
      projectTokenUsageArchivedAt:
        typeof payload.projectTokenUsageArchivedAt === "string" &&
        payload.projectTokenUsageArchivedAt.trim()
          ? payload.projectTokenUsageArchivedAt
          : null,
    } satisfies PersistedSymphonyRuntime;
  } catch {
    return null;
  }
}

async function writeRuntimeFile(projectSlug: string, runtime: PersistedSymphonyRuntime) {
  const { runtimeFilePath } = runtimePaths(projectSlug);

  await writeFile(runtimeFilePath, JSON.stringify(runtime, null, 2), "utf8");
}

function tokenUsageFromState(state: Record<string, unknown> | null) {
  const codexTotals =
    state && typeof state.codex_totals === "object" && !Array.isArray(state.codex_totals)
      ? state.codex_totals
      : null;

  return parseTokenUsage(codexTotals);
}

function sameTokenUsage(left: TokenUsage, right: TokenUsage) {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.totalTokens === right.totalTokens
  );
}

function resolvedPersistedProjectTokenUsage(
  projectSlug: string,
  runtime: PersistedSymphonyRuntime,
) {
  if (runtime.persistedProjectTokenUsage) {
    return runtime.persistedProjectTokenUsage;
  }

  if (!runtime.projectTokenUsageArchivedAt) {
    return { ...EMPTY_TOKEN_USAGE };
  }

  const currentProjectUsage = getStoredProjectTokenUsageBySlug(projectSlug);
  return tokenUsageAtLeast(currentProjectUsage, runtime.lastObservedTokenUsage)
    ? runtime.lastObservedTokenUsage
    : { ...EMPTY_TOKEN_USAGE };
}

async function persistObservedTokenUsage(
  projectSlug: string,
  runtime: PersistedSymphonyRuntime,
  state: Record<string, unknown>,
) {
  const observed = maxTokenUsage(runtime.lastObservedTokenUsage, tokenUsageFromState(state));
  const persisted = resolvedPersistedProjectTokenUsage(projectSlug, runtime);
  const delta = subtractTokenUsage(observed, persisted);

  if (
    sameTokenUsage(observed, runtime.lastObservedTokenUsage) &&
    sameTokenUsage(persisted, runtime.persistedProjectTokenUsage ?? EMPTY_TOKEN_USAGE) &&
    !hasTokenUsage(delta)
  ) {
    return runtime;
  }

  if (hasTokenUsage(delta)) {
    appendProjectTokenUsageBySlug(projectSlug, delta);
  }

  const next = {
    ...runtime,
    lastObservedTokenUsage: observed,
    persistedProjectTokenUsage: observed,
  } satisfies PersistedSymphonyRuntime;

  await writeRuntimeFile(projectSlug, next);
  return next;
}

async function archiveObservedTokenUsage(
  projectSlug: string,
  runtime: PersistedSymphonyRuntime,
) {
  const persisted = resolvedPersistedProjectTokenUsage(projectSlug, runtime);
  const delta = subtractTokenUsage(runtime.lastObservedTokenUsage, persisted);

  if (runtime.projectTokenUsageArchivedAt && !hasTokenUsage(delta)) {
    return runtime;
  }

  if (hasTokenUsage(delta)) {
    appendProjectTokenUsageBySlug(projectSlug, delta);
  }

  const next = {
    ...runtime,
    persistedProjectTokenUsage: runtime.lastObservedTokenUsage,
    projectTokenUsageArchivedAt: new Date().toISOString(),
  } satisfies PersistedSymphonyRuntime;

  await writeRuntimeFile(projectSlug, next);
  return next;
}

async function waitForSymphonyReady(runtime: {
  pid: number;
  port: number;
  bootstrapLogPath: string;
}) {
  const stateUrl = `http://127.0.0.1:${runtime.port}/api/v1/state`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 20000) {
    const state = await fetchStateSnapshot(stateUrl);

    if (state) {
      return;
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
  let runtime = await readRuntimeFile(projectSlug);

  if (!runtime) {
    return null;
  }

  const stateUrl = `http://127.0.0.1:${runtime.port}/api/v1/state`;
  const state = await fetchStateSnapshot(stateUrl);

  if (state) {
    runtime = await persistObservedTokenUsage(projectSlug, runtime, state);
  }

  const bootstrapTail = await readLogTail(runtime.bootstrapLogPath);
  const running = Boolean(state) || processIsRunning(runtime.pid);

  if (!running) {
    runtime = await archiveObservedTokenUsage(projectSlug, runtime);
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

  const previousRuntime = await readRuntimeFile(project.slug);

  if (previousRuntime && !previousRuntime.projectTokenUsageArchivedAt) {
    await archiveObservedTokenUsage(project.slug, previousRuntime);
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
    lastObservedTokenUsage: EMPTY_TOKEN_USAGE,
    persistedProjectTokenUsage: EMPTY_TOKEN_USAGE,
    projectTokenUsageArchivedAt: null,
  } satisfies PersistedSymphonyRuntime;

  await writeRuntimeFile(project.slug, runtime);

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
  const runtime = await getSymphonyRuntime(projectSlug);
  const { projectRoot } = getProjectPaths(projectSlug);
  const runtimeFilePath = path.join(projectRoot, "symphony", "runtime.json");

  if (!runtime) {
    await rm(runtimeFilePath, { force: true });
    return { stopped: false };
  }

  if (runtime.running) {
    const shutdownQueued = await requestSymphonyShutdown(runtime.stateUrl);

    if (shutdownQueued) {
      await waitForSymphonyShutdown(runtime.stateUrl);
    }
  }

  if (runtime.pid > 0 && processIsRunning(runtime.pid)) {
    await stopRuntimeProcess(runtime.pid);
  }

  const persistedRuntime = await readRuntimeFile(projectSlug);

  if (persistedRuntime) {
    await archiveObservedTokenUsage(projectSlug, persistedRuntime);
  }

  await rm(runtimeFilePath, { force: true });

  return {
    stopped: true,
    pid: runtime.pid,
    port: runtime.port,
  };
}
