import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SpecIR } from "@/lib/types";

const SPEC_IR: SpecIR = {
  summary:
    "Build Placeholder Project as a delivery blueprint for validating project creation and deletion across persisted runtime state.",
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
      buildSpecIrWithLlm: vi.fn(async (input: { name: string }) => ({
        specIr: {
          ...SPEC_IR,
          summary: `Build ${input.name} as a delivery blueprint for validating project creation and deletion across persisted runtime state.`,
        },
        tokenUsage: null,
      })),
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
      plannerModel: "planner-x",
      executionModel: "executor-y",
      plannerReasoningEffort: "xhigh",
      executionReasoningEffort: "high",
      symphonyMaxConcurrentAgents: 3,
      symphonyMaxTurns: 30,
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Core lifecycle\n- Create and delete projects cleanly",
    });

    const snapshotBeforeDelete = repository.getProjectSnapshot(created.projectId);
    expect(snapshotBeforeDelete?.project.slug).toBe(created.slug);
    expect(snapshotBeforeDelete?.project.plannerModel).toBe("planner-x");
    expect(snapshotBeforeDelete?.project.executionModel).toBe("executor-y");
    expect(snapshotBeforeDelete?.project.plannerReasoningEffort).toBe("xhigh");
    expect(snapshotBeforeDelete?.project.executionReasoningEffort).toBe("high");
    expect(snapshotBeforeDelete?.project.symphonyMaxConcurrentAgents).toBe(3);
    expect(snapshotBeforeDelete?.project.symphonyMaxTurns).toBe(30);

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

  it("updates a project's stored name without changing its slug", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Original Name",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nPersist a renamed project name",
    });

    const updated = repository.updateProjectName(created.projectId, "Renamed Project");
    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(updated?.name).toBe("Renamed Project");
    expect(updated?.slug).toBe(created.slug);
    expect(snapshot?.project.name).toBe("Renamed Project");
    expect(snapshot?.project.slug).toBe(created.slug);
    expect(snapshot?.planVersion?.specIr.summary).toContain("Renamed Project");
    expect(snapshot?.planVersion?.specIr.summary).not.toContain("Original Name");
  });

  it("updates an existing project's captured execution settings", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Settings Project",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nAllow existing project settings to be edited",
    });

    const updated = repository.updateProjectSettings(created.projectId, {
      plannerModel: "gpt-5.4",
      executionModel: "gpt-5.4",
      plannerReasoningEffort: "xhigh",
      executionReasoningEffort: "xhigh",
      executionMode: "hosted_api",
      qaStrictness: 2,
      securityStrictness: 5,
      deploymentTargets: ["local", "azure"],
      symphonyMaxConcurrentAgents: 5,
      symphonyMaxTurns: 36,
    });
    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(updated?.plannerModel).toBe("gpt-5.4");
    expect(updated?.executionModel).toBe("gpt-5.4");
    expect(updated?.plannerReasoningEffort).toBe("xhigh");
    expect(updated?.executionReasoningEffort).toBe("xhigh");
    expect(updated?.executionMode).toBe("hosted_api");
    expect(updated?.qaStrictness).toBe(2);
    expect(updated?.securityStrictness).toBe(5);
    expect(updated?.deploymentTargets).toEqual(["local", "azure"]);
    expect(updated?.symphonyMaxConcurrentAgents).toBe(5);
    expect(updated?.symphonyMaxTurns).toBe(36);
    expect(snapshot?.project.plannerReasoningEffort).toBe("xhigh");
    expect(snapshot?.project.executionReasoningEffort).toBe("xhigh");
    expect(snapshot?.project.qaStrictness).toBe(2);
    expect(snapshot?.project.securityStrictness).toBe(5);
    expect(snapshot?.project.deploymentTargets).toEqual(["local", "azure"]);
    expect(snapshot?.project.symphonyMaxConcurrentAgents).toBe(5);
    expect(snapshot?.project.symphonyMaxTurns).toBe(36);
  });

  it("preserves repo source when updating unrelated project settings", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Repo Source Project",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nKeep repo source unchanged during settings edits",
    });

    const before = repository.getProjectSnapshot(created.projectId);

    repository.updateProjectSettings(created.projectId, {
      plannerReasoningEffort: "xhigh",
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(snapshot?.project.repoSource).toBe(before?.project.repoSource);
  });

  it("stores zeroed cumulative token usage and inherits the new default agent count", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Default Concurrency",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nUse the platform defaults for a new project",
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(snapshot?.project.symphonyMaxConcurrentAgents).toBe(5);
    expect(snapshot?.project.cumulativeTokenUsage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it("can fork a workshop thread into a resumable alternate prompt branch", async () => {
    const repository = await import("@/lib/server/repository");

    const created = repository.createDraftProject({
      name: "Workshop Fork",
      repoSource: ".",
      executionMode: "local_chatgpt",
    });

    repository.recordWorkshopTurn({
      projectId: created.projectId,
      codexThreadId: "thread-original",
      title: "Original workshop",
      searchMode: "cached",
      promptDraft: "Research the next phase of Overture.",
      summary: "Focus on research, launch, and deploy.",
      repoContext: ".",
      userMessage: "Help me turn this into a research prompt.",
      assistantMessage: "Here is a stronger prompt draft.",
      readyForResearch: false,
      openQuestions: ["Should launch include iOS simulator automation?"],
    });

    const originalThread = repository.getLatestWorkshopThread(created.projectId);
    const forked = repository.createWorkshopFork(created.projectId);
    const forkedThread = repository.getLatestWorkshopThread(created.projectId);

    expect(originalThread?.codexThreadId).toBe("thread-original");
    expect(forked.workshopThreadId).toBe(forkedThread?.id);
    expect(forkedThread?.id).not.toBe(originalThread?.id);
    expect(forkedThread?.codexThreadId).toBe("");
    expect(forkedThread?.promptDraft).toBe(originalThread?.promptDraft);
    expect(forkedThread?.summary).toBe(originalThread?.summary);
    expect(forkedThread?.metadata.forkedFromWorkshopThreadId).toBe(originalThread?.id);
  });

  it("stores the guided source brief as an artifact on draft creation", async () => {
    const repository = await import("@/lib/server/repository");

    const created = repository.createDraftProject({
      name: "Guided Source Brief",
      repoSource: ".",
      executionMode: "local_chatgpt",
      sourceBriefFilename: "expansion-brief.md",
      sourceBriefText: "# Expansion brief\n\nAdd a guided research and deploy pipeline.",
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);
    const sourceBrief = snapshot?.artifacts.find((artifact) => artifact.kind === "source-brief");

    expect(sourceBrief?.label).toBe("expansion-brief.md");
    expect(sourceBrief?.mimeType).toBe("text/markdown");
  });

  it("persists guided policy settings on draft projects", async () => {
    const repository = await import("@/lib/server/repository");

    const created = repository.createDraftProject({
      name: "Guided Policy Profile",
      repoSource: ".",
      executionMode: "local_chatgpt",
      policyProfile: {
        qaStrictness: 2,
        securityStrictness: 5,
        deploymentTargets: ["local", "aws"],
      },
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(snapshot?.project.qaStrictness).toBe(2);
    expect(snapshot?.project.securityStrictness).toBe(5);
    expect(snapshot?.project.deploymentTargets).toEqual(["local", "aws"]);
  });

  it("records research runs without writing non-work-item run ids into audit foreign keys", async () => {
    const repository = await import("@/lib/server/repository");

    const created = repository.createDraftProject({
      name: "Research Audit Safety",
      repoSource: ".",
      executionMode: "local_chatgpt",
    });

    repository.recordWorkshopTurn({
      projectId: created.projectId,
      codexThreadId: "thread-research",
      title: "Research workshop",
      searchMode: "cached",
      promptDraft: "Research the next phase of Overture and produce a plan.",
      summary: "Ready for research.",
      repoContext: ".",
      userMessage: "Turn this into a research brief.",
      assistantMessage: "This prompt is ready for research.",
      readyForResearch: true,
      openQuestions: [],
    });

    const locked = repository.lockWorkshopPrompt(created.projectId);
    const researchRunId = repository.createResearchRunRecord({
      projectId: created.projectId,
      provider: "codex_native",
      searchMode: "cached",
      promptArtifactId: locked.promptArtifactId,
    });

    repository.completeResearchRunRecord({
      researchRunId,
      projectId: created.projectId,
      summary: "Research completed.",
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);
    const startedEvent = snapshot?.auditEvents.find((event) => event.action === "research.started");
    const completedEvent = snapshot?.auditEvents.find(
      (event) => event.action === "research.completed",
    );

    expect(snapshot?.researchRuns).toHaveLength(1);
    expect(snapshot?.researchRuns[0]?.id).toBe(researchRunId);
    expect(startedEvent?.runId).toBeNull();
    expect(startedEvent?.payload.researchRunId).toBe(researchRunId);
    expect(completedEvent?.runId).toBeNull();
    expect(completedEvent?.payload.researchRunId).toBe(researchRunId);
  });

  it("stores only the workshop token delta for repeated turns on the same Codex thread", async () => {
    const repository = await import("@/lib/server/repository");

    const created = repository.createDraftProject({
      name: "Workshop Tokens",
      repoSource: ".",
      executionMode: "local_chatgpt",
    });

    repository.recordWorkshopTurn({
      projectId: created.projectId,
      codexThreadId: "thread-workshop-tokens",
      title: "Prompt workshop",
      searchMode: "cached",
      promptDraft: "Prompt v1",
      summary: "Summary v1",
      repoContext: ".",
      userMessage: "First turn",
      assistantMessage: "First reply",
      readyForResearch: false,
      openQuestions: [],
      tokenUsage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
      },
    });

    repository.recordWorkshopTurn({
      projectId: created.projectId,
      codexThreadId: "thread-workshop-tokens",
      title: "Prompt workshop",
      searchMode: "cached",
      promptDraft: "Prompt v2",
      summary: "Summary v2",
      repoContext: ".",
      userMessage: "Second turn",
      assistantMessage: "Second reply",
      readyForResearch: true,
      openQuestions: [],
      tokenUsage: {
        inputTokens: 150,
        outputTokens: 45,
        totalTokens: 195,
      },
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(snapshot?.project.cumulativeTokenUsage).toEqual({
      inputTokens: 150,
      outputTokens: 45,
      totalTokens: 195,
    });
  });

  it("keeps launch and deploy profile ids stable across snapshot refreshes", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Stable Profiles",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nKeep operational profile ids stable across polling",
    });

    const first = repository.getProjectSnapshot(created.projectId);
    const second = repository.getProjectSnapshot(created.projectId);

    expect(first?.launchProfiles.map((profile) => profile.id)).toEqual(
      second?.launchProfiles.map((profile) => profile.id),
    );
    expect(first?.deployProfiles.map((profile) => profile.id)).toEqual(
      second?.deployProfiles.map((profile) => profile.id),
    );
  });

  it("does not mutate project timestamps when a snapshot is read", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Read Only Snapshot",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nKeep snapshot reads side-effect free",
    });

    const first = repository.getProjectSnapshot(created.projectId);

    await new Promise((resolve) => setTimeout(resolve, 15));

    const second = repository.getProjectSnapshot(created.projectId);

    expect(second?.project.updatedAt).toBe(first?.project.updatedAt);
    expect(second?.project.lastActivityAt).toBe(first?.project.lastActivityAt);
  });

  it("auto-advances epic containers and queues their leaf tasks after a milestone closes", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Epic Auto Advance",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Core lifecycle\n- Create and delete projects cleanly",
    });

    const initial = repository.getProjectSnapshot(created.projectId);
    const milestone = initial?.workItems.find((item) => item.metadata.lane === "milestone");
    const epic = initial?.workItems.find((item) => item.metadata.lane === "epic");
    const milestoneLeafTask = initial?.workItems.find((item) => item.key === "M1.1");

    expect(milestone).toBeDefined();
    expect(epic?.status).toBe("blocked");
    expect(milestoneLeafTask).toBeUndefined();

    repository.updateWorkItemFromTracker({
      issueId: milestone!.id,
      stateId: "state-done",
    });

    const settled = repository.getProjectSnapshot(created.projectId);
    const settledEpic = settled?.workItems.find((item) => item.metadata.lane === "epic");
    const settledEpicLeaf = settled?.workItems.find((item) => item.key === "E1.1");

    expect(settledEpic?.status).toBe("done");
    expect(settledEpicLeaf?.status).toBe("queued");
  });

  it("does not satisfy deploy status from launch evidence and fails release on deploy findings", async () => {
    const repository = await import("@/lib/server/repository");

    const created = await repository.createProjectFromSpec({
      name: "Deploy Gate Accuracy",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nKeep deploy gates grounded in deployment evidence",
    });

    const initial = repository.getProjectSnapshot(created.projectId);

    repository.writeArtifact({
      projectId: created.projectId,
      projectSlug: created.slug,
      kind: "launch-report",
      label: "Launch evidence",
      extension: "md",
      mimeType: "text/markdown",
      content: "# Launch report",
    });

    const afterLaunch = repository.getProjectSnapshot(created.projectId);

    repository.createFinding({
      projectId: created.projectId,
      category: "deploy",
      severity: "medium",
      status: "open",
      title: "Broken deploy step",
      detail: "Deployment verification is incomplete.",
      source: "qa-review",
    });

    const afterFinding = repository.getProjectSnapshot(created.projectId);

    expect(initial?.gateStatus.deployStatus).toBe("pending");
    expect(afterLaunch?.gateStatus.deployStatus).toBe("pending");
    expect(afterFinding?.gateStatus.deployStatus).toBe("fail");
    expect(afterFinding?.gateStatus.releaseStatus).toBe("fail");
  });
});
