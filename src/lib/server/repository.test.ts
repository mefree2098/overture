import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SpecIR } from "@/lib/types";

const SPEC_IR: SpecIR = {
  summary:
    "A delivery blueprint for validating project creation and deletion across persisted runtime state.",
  outline: [
    {
      title: "Blueprint",
      level: 1,
    },
  ],
  sections: [],
  features: ["Project deletion"],
  roles: ["Operator"],
  entities: ["Project"],
  integrations: ["Symphony"],
  constraints: [],
  risks: [],
  acceptanceCriteria: ["Projects can be fully deleted."],
  deploymentTargets: ["local"],
  milestones: [
    {
      name: "Core lifecycle",
      tasks: ["Create and delete projects cleanly"],
    },
  ],
  epics: [
    {
      name: "Deletion",
      milestoneName: "Core lifecycle",
      tasks: ["Delete records and runtime state"],
    },
  ],
  openQuestions: [],
};

describe("repository lifecycle", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-repository-test-"));
    const dbPath = path.join(runtimeRoot, "db", "overture.test.db");
    process.env.OVERTURE_ROOT = runtimeRoot;
    process.env.OVERTURE_DB_PATH = dbPath;
    mkdirSync(path.dirname(dbPath), { recursive: true });

    vi.doMock("@/lib/server/llm-planner", () => ({
      buildSpecIrWithLlm: vi.fn(async () => SPEC_IR),
    }));
    vi.doMock("@/lib/server/symphony-manager", () => ({
      stopSymphonyForProject: vi.fn(async () => ({ stopped: true })),
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(runtimeRoot, { recursive: true, force: true });
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock("@/lib/server/llm-planner");
    vi.unmock("@/lib/server/symphony-manager");
  });

  it("hard-deletes a project and its runtime directories", async () => {
    const repository = await import("@/lib/server/repository");
    const storage = await import("@/lib/server/storage");
    const symphonyManager = await import("@/lib/server/symphony-manager");

    const created = await repository.createProjectFromSpec({
      name: "Delete Me",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Core lifecycle\n- Create and delete projects cleanly",
    });

    const snapshotBeforeDelete = repository.getProjectSnapshot(created.projectId);
    expect(snapshotBeforeDelete?.project.slug).toBe(created.slug);

    const {
      projectRoot,
      projectArtifactsRoot,
      projectWorkspaceRoot,
    } = storage.getProjectPaths(created.slug);

    mkdirSync(projectArtifactsRoot, { recursive: true });
    writeFileSync(path.join(projectRoot, "marker.txt"), "project", "utf8");
    writeFileSync(path.join(projectArtifactsRoot, "artifact.txt"), "artifact", "utf8");
    writeFileSync(path.join(projectWorkspaceRoot, "workspace.txt"), "workspace", "utf8");

    const deletedProject = await repository.deleteProject(created.projectId);

    expect(deletedProject?.id).toBe(created.projectId);
    expect(repository.getProjectSnapshot(created.projectId)).toBeNull();
    expect(repository.listProjects()).toHaveLength(0);
    expect(existsSync(projectRoot)).toBe(false);
    expect(existsSync(projectArtifactsRoot)).toBe(false);
    expect(existsSync(projectWorkspaceRoot)).toBe(false);
    expect(symphonyManager.stopSymphonyForProject).toHaveBeenCalledWith(created.slug);
  });
});
