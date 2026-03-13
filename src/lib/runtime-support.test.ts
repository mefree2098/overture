import {
  executionModeAvailable,
  executionModeLabel,
  resolvePreferredExecutionMode,
  runtimeAccountStatusLabel,
  runtimeReady,
  runtimeSupportLabel,
} from "@/lib/runtime-support";

describe("runtime-support", () => {
  const hostedSupport = {
    codexCliAvailable: true,
    localChatgptAvailable: false,
    hostedApiAvailable: true,
    recommendedExecutionMode: "hosted_api" as const,
  };

  it("falls back to the recommended execution mode when the configured one is unavailable", () => {
    expect(resolvePreferredExecutionMode("local_chatgpt", hostedSupport)).toBe("hosted_api");
    expect(executionModeAvailable("hosted_api", hostedSupport)).toBe(true);
    expect(executionModeLabel("hosted_api")).toBe("Hosted API Codex");
  });

  it("treats the runtime as unready when the Codex CLI is missing", () => {
    expect(
      runtimeReady({
        ...hostedSupport,
        codexCliAvailable: false,
      }),
    ).toBe(false);
    expect(
      runtimeAccountStatusLabel({
        ...hostedSupport,
        codexCliAvailable: false,
      }),
    ).toBe("Codex CLI is not installed or not on PATH");
  });

  it("reports the same readiness label used by the settings page", () => {
    expect(runtimeSupportLabel(hostedSupport)).toBe(
      "API-key-backed Codex is available. ChatGPT auth is not detected.",
    );
  });
});
