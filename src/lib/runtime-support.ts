import type { ExecutionMode } from "@/lib/types";

export interface RuntimeExecutionSupport {
  codexCliAvailable: boolean;
  localChatgptAvailable: boolean;
  hostedApiAvailable: boolean;
  recommendedExecutionMode: ExecutionMode;
}

export function executionModeAvailable(
  mode: ExecutionMode,
  support: Pick<RuntimeExecutionSupport, "localChatgptAvailable" | "hostedApiAvailable">,
) {
  return mode === "local_chatgpt"
    ? support.localChatgptAvailable
    : support.hostedApiAvailable;
}

export function resolvePreferredExecutionMode(
  mode: ExecutionMode,
  support: RuntimeExecutionSupport,
) {
  return executionModeAvailable(mode, support) ? mode : support.recommendedExecutionMode;
}

export function executionModeLabel(mode: ExecutionMode) {
  return mode === "local_chatgpt" ? "Local ChatGPT Codex" : "Hosted API Codex";
}

export function runtimeReady(support: Pick<
  RuntimeExecutionSupport,
  "codexCliAvailable" | "localChatgptAvailable" | "hostedApiAvailable"
>) {
  return (
    support.codexCliAvailable &&
    (support.localChatgptAvailable || support.hostedApiAvailable)
  );
}

export function runtimeSupportLabel(support: RuntimeExecutionSupport) {
  if (!support.codexCliAvailable) {
    return "Codex CLI is not available yet on this machine.";
  }

  if (support.localChatgptAvailable) {
    return "ChatGPT-backed Codex is ready for local planning and execution.";
  }

  if (support.hostedApiAvailable) {
    return "API-key-backed Codex is available. ChatGPT auth is not detected.";
  }

  return "Codex CLI is installed, but Overture could not find a usable login yet.";
}

export function runtimeAccountStatusLabel(support: RuntimeExecutionSupport) {
  if (!support.codexCliAvailable) {
    return "Codex CLI is not installed or not on PATH";
  }

  if (support.localChatgptAvailable) {
    return "Your ChatGPT Codex login is ready";
  }

  if (support.hostedApiAvailable) {
    return "Hosted API mode is ready";
  }

  return "A Codex login is still needed";
}
