import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("research runner token accounting", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-research-runner-test-"));
    const dbPath = path.join(runtimeRoot, "db", "overture.test.db");
    process.env.OVERTURE_ROOT = runtimeRoot;
    process.env.OVERTURE_DB_PATH = dbPath;
    mkdirSync(path.dirname(dbPath), { recursive: true });

    vi.doMock("@/lib/server/research-provider", () => ({
      runResearchProvider: vi.fn(async () => ({
        summary: "Research complete.",
        researchReport: "# Report\n\nDetailed findings for the project.",
        planMarkdown: "# plan.md\n\n## Scope\n\n- Ship the feature\n".padEnd(220, "x"),
        architectureDecisions: null,
        citations: [],
        openQuestions: [],
        tokenUsage: {
          inputTokens: 210,
          outputTokens: 35,
          totalTokens: 245,
        },
      })),
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(runtimeRoot, { recursive: true, force: true });
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock("@/lib/server/research-provider");
  });

  it("rolls research token usage into the project totals", async () => {
    const repository = await import("@/lib/server/repository");
    const researchRunner = await import("@/lib/server/research-runner");

    const created = repository.createDraftProject({
      name: "Research Tokens",
      repoSource: ".",
      executionMode: "local_chatgpt",
    });

    repository.recordWorkshopTurn({
      projectId: created.projectId,
      codexThreadId: "thread-research-tokens",
      title: "Prompt workshop",
      searchMode: "cached",
      promptDraft: "Research the feature and return a plan.",
      summary: "Prompt is ready.",
      repoContext: ".",
      userMessage: "Prepare research.",
      assistantMessage: "Prompt is ready.",
      readyForResearch: true,
      openQuestions: [],
    });

    await researchRunner.runProjectResearch({
      projectId: created.projectId,
      searchMode: "cached",
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(snapshot?.project.cumulativeTokenUsage).toEqual({
      inputTokens: 210,
      outputTokens: 35,
      totalTokens: 245,
    });
  });
});
