import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("deploy runner failure evidence", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-deploy-runner-test-"));
    process.env = {
      ...originalEnv,
      OVERTURE_ROOT: runtimeRoot,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(runtimeRoot, { recursive: true, force: true });
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("writes deployment report and log artifacts when a deployment fails", async () => {
    const writeArtifact = vi.fn();
    const failDeployRunRecord = vi.fn();

    vi.doMock("node:child_process", () => ({
      spawnSync: vi.fn(() => ({
        stdout: "deploy stdout\n",
        stderr: "deploy stderr\n",
        status: 1,
        error: undefined,
      })),
    }));

    vi.doMock("@/lib/server/repository", () => ({
      refreshOperationalProfiles: vi.fn(),
      getProjectSnapshot: vi.fn(() => ({
        project: {
          id: "project-1",
          slug: "project-slug",
          name: "Project",
        },
        deployProfiles: [
          {
            id: "deploy-local",
            target: "local",
            label: "Local deploy",
            command: "bash deploy.sh local",
            cwd: runtimeRoot,
            approvalRequired: false,
            metadata: {},
          },
        ],
      })),
      createDeployRunRecord: vi.fn(() => "deploy-run-1"),
      completeDeployRunRecord: vi.fn(),
      failDeployRunRecord,
      writeArtifact,
    }));

    const { runProjectDeployment } = await import("@/lib/server/deploy-runner");

    await expect(
      runProjectDeployment({
        projectId: "project-1",
        deployProfileId: "deploy-local",
      }),
    ).rejects.toThrow("Deployment command failed with exit code 1.");

    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "deployment-report",
      }),
    );
    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "deployment-log",
      }),
    );
    expect(failDeployRunRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        deployRunId: "deploy-run-1",
      }),
    );
  });
});
