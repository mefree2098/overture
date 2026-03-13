import { buildOperationalProofRows } from "@/lib/operational-proof";

describe("operational proof rows", () => {
  it("keeps the proof matrix scoped to the project's selected deployment targets", () => {
    const timestamp = new Date("2026-03-12T12:00:00.000Z").toISOString();
    const rows = buildOperationalProofRows({
      projectDeploymentTargets: ["local", "aws"],
      launchProfiles: [
        {
          id: "launch-web",
          projectId: "project-1",
          target: "web",
          label: "Web app dev server",
          command: "npm run dev",
          cwd: "/repo",
          healthcheckUrl: "http://127.0.0.1:3000",
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      launchRuns: [
        {
          id: "launch-run-1",
          projectId: "project-1",
          launchProfileId: "launch-web",
          status: "completed",
          summary: "Launch succeeded",
          logPath: "/tmp/launch.log",
          metadata: {},
          startedAt: timestamp,
          completedAt: timestamp,
        },
      ],
      deployProfiles: [
        {
          id: "deploy-local",
          projectId: "project-1",
          target: "local",
          label: "Local deploy",
          command: "bash deploy.sh local",
          cwd: "/repo",
          approvalRequired: false,
          metadata: {
            healthcheckUrl: "http://host.docker.internal:3000/api/health",
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "deploy-azure",
          projectId: "project-1",
          target: "azure",
          label: "Azure deploy",
          command: "bash deploy.sh azure",
          cwd: "/repo",
          approvalRequired: true,
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      deployRuns: [
        {
          id: "deploy-run-1",
          projectId: "project-1",
          deployProfileId: "deploy-local",
          status: "completed",
          summary: "Deploy succeeded",
          logPath: "/tmp/deploy.log",
          metadata: {},
          startedAt: timestamp,
          completedAt: timestamp,
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        target: "local",
        profiles: "pass",
        launch: "pass",
        deploy: "pass",
        health: "pass",
      }),
      expect.objectContaining({
        target: "aws",
        profiles: "partial",
        launch: "waived",
        deploy: "partial",
        health: "waived",
      }),
    ]);
  });
});
