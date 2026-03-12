import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("app settings", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-settings-test-"));
    const dbPath = path.join(runtimeRoot, "db", "overture.test.db");
    process.env.OVERTURE_ROOT = runtimeRoot;
    process.env.OVERTURE_DB_PATH = dbPath;
    mkdirSync(path.dirname(dbPath), { recursive: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(runtimeRoot, { recursive: true, force: true });
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a default settings row and persists updates", async () => {
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
});
