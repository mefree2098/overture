import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("launch runner failure evidence", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-launch-runner-test-"));
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
    vi.restoreAllMocks();
  });

  it("writes launch report, log, and diagnostics artifacts when a docker launch fails", async () => {
    const writeArtifact = vi.fn();
    const failLaunchRunRecord = vi.fn();
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        stdout: "launch stdout\n",
        stderr: "launch stderr\n",
        status: 1,
        error: undefined,
      })
      .mockReturnValueOnce({
        stdout: "docker compose ps output\n",
        stderr: "",
        status: 0,
        error: undefined,
      });

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(),
      spawnSync,
    }));

    vi.doMock("@/lib/server/repository", () => ({
      refreshOperationalProfiles: vi.fn(),
      getProjectSnapshot: vi.fn(() => ({
        project: {
          id: "project-1",
          slug: "project-slug",
          name: "Project",
        },
        launchProfiles: [
          {
            id: "launch-docker",
            target: "docker",
            label: "Docker Compose stack",
            command: "docker compose up -d --build",
            cwd: runtimeRoot,
            healthcheckUrl: "http://127.0.0.1:3000/health",
            metadata: {},
          },
        ],
      })),
      createLaunchRunRecord: vi.fn(() => "launch-run-1"),
      completeLaunchRunRecord: vi.fn(),
      failLaunchRunRecord,
      writeArtifact,
    }));

    const { runProjectLaunch } = await import("@/lib/server/launch-runner");

    await expect(
      runProjectLaunch({
        projectId: "project-1",
        launchProfileId: "launch-docker",
      }),
    ).rejects.toThrow("Launch command failed with exit code 1.");

    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "launch-report",
      }),
    );
    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "launch-log",
      }),
    );
    expect(writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "launch-diagnostics",
      }),
    );
    expect(failLaunchRunRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        launchRunId: "launch-run-1",
      }),
    );
  });

  it("stops a managed launch process and records that the process was stopped", async () => {
    const markLaunchRunProcessStopped = vi.fn();
    vi.spyOn(process, "kill").mockImplementation(() => true);

    vi.doMock("@/lib/server/repository", () => ({
      refreshOperationalProfiles: vi.fn(),
      getProjectSnapshot: vi.fn(() => ({
        project: {
          id: "project-1",
          slug: "project-slug",
          name: "Project",
        },
        launchProfiles: [],
        launchRuns: [
          {
            id: "launch-run-2",
            projectId: "project-1",
            launchProfileId: "launch-web",
            status: "completed",
            summary: "Launch succeeded",
            logPath: "/tmp/launch.log",
            metadata: {
              pid: 4242,
            },
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
      })),
      createLaunchRunRecord: vi.fn(),
      completeLaunchRunRecord: vi.fn(),
      failLaunchRunRecord: vi.fn(),
      markLaunchRunProcessStopped,
      writeArtifact: vi.fn(),
    }));

    const { stopProjectLaunchProcess } = await import("@/lib/server/launch-runner");

    await expect(
      stopProjectLaunchProcess({
        projectId: "project-1",
        launchRunId: "launch-run-2",
      }),
    ).resolves.toEqual({
      launchRunId: "launch-run-2",
      summary: "Stopped the managed launch process.",
    });

    expect(process.kill).toHaveBeenCalledWith(4242, 0);
    expect(process.kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(markLaunchRunProcessStopped).toHaveBeenCalledWith(
      expect.objectContaining({
        launchRunId: "launch-run-2",
        summary: "Stopped the managed launch process.",
        metadata: expect.objectContaining({
          pid: 4242,
          processStoppedAt: expect.any(String),
        }),
      }),
    );
  });
});
