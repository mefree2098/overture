import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function makeExecutable(filePath: string) {
  writeFileSync(filePath, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(filePath, 0o755);
}

describe("app settings", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-settings-test-"));
    const dbPath = path.join(runtimeRoot, "db", "overture.test.db");
    process.env.OVERTURE_ROOT = runtimeRoot;
    process.env.OVERTURE_DB_PATH = dbPath;
    process.env.CODEX_HOME = path.join(runtimeRoot, "codex-home");
    process.env.OVERTURE_CODEX_BIN = path.join(runtimeRoot, "bin", "codex");
    mkdirSync(path.dirname(dbPath), { recursive: true });
    mkdirSync(process.env.CODEX_HOME, { recursive: true });
    mkdirSync(path.dirname(process.env.OVERTURE_CODEX_BIN), { recursive: true });
    makeExecutable(process.env.OVERTURE_CODEX_BIN);
    writeFileSync(
      path.join(process.env.CODEX_HOME, "auth.json"),
      JSON.stringify({
        tokens: {
          access_token: "test-access-token",
        },
      }),
      "utf8",
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(runtimeRoot, { recursive: true, force: true });
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a default settings row and persists updates", async () => {
    process.env.OPENAI_API_KEY = "sk-live-test";
    const settingsModule = await import("@/lib/server/app-settings");

    const defaults = settingsModule.getAppSettings();
    expect(defaults.defaultExecutionMode).toBe("local_chatgpt");
    expect(defaults.plannerModel).toBeNull();
    expect(defaults.executionModel).toBeNull();
    expect(defaults.executionReasoningEffort).toBe("medium");
    expect(defaults.defaultDeploymentTargets).toEqual(["local"]);
    expect(defaults.symphonyMaxConcurrentAgents).toBe(5);
    expect(defaults.symphonyMaxTurns).toBe(24);

    const updated = settingsModule.updateAppSettings({
      plannerModel: "planner-x",
      executionModel: "executor-y",
      plannerReasoningEffort: "xhigh",
      executionReasoningEffort: "high",
      defaultExecutionMode: "hosted_api",
      defaultRepoSource: "/tmp/workspace",
      defaultQaStrictness: 5,
      defaultSecurityStrictness: 3,
      defaultDeploymentTargets: ["local", "aws"],
      symphonyMaxConcurrentAgents: 4,
      symphonyMaxTurns: 36,
    });

    expect(updated.plannerModel).toBe("planner-x");
    expect(updated.executionModel).toBe("executor-y");
    expect(updated.plannerReasoningEffort).toBe("xhigh");
    expect(updated.executionReasoningEffort).toBe("high");
    expect(updated.defaultExecutionMode).toBe("hosted_api");
    expect(updated.defaultRepoSource).toBe("/tmp/workspace");
    expect(updated.defaultQaStrictness).toBe(5);
    expect(updated.defaultSecurityStrictness).toBe(3);
    expect(updated.defaultDeploymentTargets).toEqual(["local", "aws"]);
    expect(updated.symphonyMaxConcurrentAgents).toBe(4);
    expect(updated.symphonyMaxTurns).toBe(36);
  });

  it("rejects unsupported research providers for the current environment", async () => {
    const settingsModule = await import("@/lib/server/app-settings");

    expect(() =>
      settingsModule.updateAppSettings({
        defaultResearchProvider: "openai_responses",
      }),
    ).toThrow("OpenAI Responses research requires OPENAI_API_KEY.");
  });

  it("rejects unsupported execution modes for the current environment", async () => {
    const settingsModule = await import("@/lib/server/app-settings");

    expect(() =>
      settingsModule.updateAppSettings({
        defaultExecutionMode: "hosted_api",
      }),
    ).toThrow("Hosted API execution mode requires OPENAI_API_KEY or Codex API auth.");
  });

  it("honors an execution-mode environment override when reading settings", async () => {
    process.env.OVERTURE_DEFAULT_EXECUTION_MODE = "hosted_api";
    const settingsModule = await import("@/lib/server/app-settings");

    expect(settingsModule.getAppSettings().defaultExecutionMode).toBe("hosted_api");
  });
});
