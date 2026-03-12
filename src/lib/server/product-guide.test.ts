import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("project product guide", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";
  let sourceRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-product-guide-runtime-"));
    sourceRoot = mkdtempSync(path.join(tmpdir(), "overture-product-guide-source-"));
    process.env.OVERTURE_ROOT = runtimeRoot;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(runtimeRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("surfaces the final workspace, run/test commands, and key files", async () => {
    const timestamp = new Date().toISOString();
    const storage = await import("@/lib/server/storage");
    const { buildProjectProductGuide } = await import("@/lib/server/product-guide");
    const { projectRoot, projectWorkspaceRoot } = storage.getProjectPaths("product-guide");

    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(
      path.join(sourceRoot, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "next dev",
          test: "vitest run",
        },
      }),
      "utf8",
    );

    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(projectWorkspaceRoot, { recursive: true });
    writeFileSync(
      path.join(projectWorkspaceRoot, "package.json"),
      JSON.stringify({
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          build: "next build",
        },
      }),
      "utf8",
    );
    writeFileSync(path.join(projectWorkspaceRoot, "README.md"), "# Product\n", "utf8");

    const guide = buildProjectProductGuide({
      project: {
        id: "project-id",
        slug: "product-guide",
        name: "Product Guide",
        repoSource: sourceRoot,
        executionMode: "local_chatgpt",
        lifecycleStage: "execution_ready",
        researchProvider: "codex_native",
        plannerModel: null,
        executionModel: null,
        plannerReasoningEffort: "low",
        executionReasoningEffort: "medium",
        symphonyMaxConcurrentAgents: 5,
        symphonyMaxTurns: 24,
        status: "execution_ready",
        health: "on_track",
        qaStrictness: 4,
        securityStrictness: 4,
        deploymentTargets: ["local"],
        cumulativeTokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
      },
      artifacts: [],
      launchProfiles: [
        {
          id: "launch-id",
          projectId: "project-id",
          target: "web",
          label: "Web app dev server",
          command: "npm run dev",
          cwd: sourceRoot,
          healthcheckUrl: "http://127.0.0.1:3000",
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      deployProfiles: [
        {
          id: "deploy-id",
          projectId: "project-id",
          target: "local",
          label: "Local deploy",
          command: "bash deploy.sh local",
          cwd: sourceRoot,
          approvalRequired: false,
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(guide.primaryPath).toBe(projectWorkspaceRoot);
    expect(guide.runCommands[0]?.cwd).toBe(projectWorkspaceRoot);
    expect(guide.publishCommands[0]?.cwd).toBe(projectWorkspaceRoot);
    expect(guide.testCommands.map((command) => command.command)).toEqual(
      expect.arrayContaining(["npm test", "npm run lint", "npm run build"]),
    );
    expect(guide.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "README",
          path: path.join(projectWorkspaceRoot, "README.md"),
        }),
      ]),
    );
  });
});
