import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { accessSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecutionMode } from "@/lib/types";
import { getWorkspaceRoot } from "@/lib/server/storage";

const DEFAULT_SYMPHONY_TRACKER_TOKEN = "overture-symphony-local-token";
const BUNDLED_CODEX_PATH = "/Applications/Codex.app/Contents/Resources/codex";

function isExecutable(filePath: string) {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function looksLikeRemoteRepo(value: string) {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("ssh://") ||
    value.startsWith("git@")
  );
}

export function resolveCodexBin() {
  const configured = process.env.OVERTURE_CODEX_BIN?.trim();

  if (configured) {
    return path.isAbsolute(configured) ? path.resolve(configured) : configured;
  }

  if (isExecutable(BUNDLED_CODEX_PATH)) {
    return BUNDLED_CODEX_PATH;
  }

  return "codex";
}

export function getCodexHome() {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(homedir(), ".codex");
}

function readCodexAuthFile() {
  const authPath = path.join(getCodexHome(), "auth.json");

  if (!existsSync(authPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(authPath, "utf8")) as {
      auth_mode?: string;
      OPENAI_API_KEY?: string | null;
      tokens?: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
      } | null;
    };
  } catch {
    return null;
  }
}

export function getCodexAuthMode() {
  const auth = readCodexAuthFile();
  const hasTokenBundle = Boolean(
    auth?.tokens?.id_token || auth?.tokens?.access_token || auth?.tokens?.refresh_token,
  );
  const hasApiKeyValue = typeof auth?.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.length > 0;

  if (auth?.auth_mode === "chatgpt" || hasTokenBundle) {
    return "chatgpt" as const;
  }

  if (auth?.auth_mode === "apikey" || hasApiKeyValue) {
    return "apikey" as const;
  }

  return auth ? ("unknown" as const) : ("none" as const);
}

export function hasHostedApiKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function hasLocalCodexAuth() {
  return getCodexAuthMode() === "chatgpt";
}

export function hasHostedApiCodexAuth() {
  return hasHostedApiKey() || getCodexAuthMode() === "apikey";
}

export function codexCliAvailable() {
  const resolved = resolveCodexBin();

  if (path.isAbsolute(resolved)) {
    return isExecutable(resolved);
  }

  const probe = spawnSync(resolved, ["--version"], {
    stdio: "ignore",
  });

  return probe.status === 0;
}

export function recommendedExecutionMode(): ExecutionMode {
  if (hasHostedApiCodexAuth()) {
    return "hosted_api";
  }

  if (hasLocalCodexAuth()) {
    return "local_chatgpt";
  }

  return "hosted_api";
}

export function getExecutionModeSupport() {
  const authMode = getCodexAuthMode();

  return {
    codexCliAvailable: codexCliAvailable(),
    codexAuthMode: authMode,
    localChatgptAvailable: authMode === "chatgpt",
    hostedApiAvailable: hasHostedApiCodexAuth(),
    recommendedExecutionMode: recommendedExecutionMode(),
  };
}

export function getSymphonyTrackerToken() {
  return process.env.SYMPHONY_TRACKER_TOKEN?.trim() || DEFAULT_SYMPHONY_TRACKER_TOKEN;
}

export function normalizeRepoSource(repoSource: string) {
  const trimmed = repoSource.trim();

  if (!trimmed || trimmed === ".") {
    return getWorkspaceRoot();
  }

  if (looksLikeRemoteRepo(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("file://")) {
    return trimmed;
  }

  return path.resolve(getWorkspaceRoot(), trimmed);
}

export function repoSourceForGitClone(repoSource: string) {
  if (
    looksLikeRemoteRepo(repoSource) ||
    repoSource.startsWith("file://")
  ) {
    return repoSource;
  }

  return pathToFileURL(path.resolve(repoSource)).toString();
}
