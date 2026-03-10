import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SpecIR } from "@/lib/types";

const SPEC_IR: SpecIR = {
  summary: "A blueprint for validating cumulative project token accounting.",
  outline: [
    {
      title: "Blueprint",
      level: 1,
    },
  ],
  sections: [],
  features: ["Token accounting"],
  roles: ["Operator"],
  entities: ["Project"],
  integrations: ["Symphony"],
  constraints: [],
  risks: [],
  acceptanceCriteria: ["Project token totals accumulate across runs."],
  deploymentTargets: ["local"],
  milestones: [
    {
      name: "Accounting",
      tasks: ["Persist total project token use"],
    },
  ],
  epics: [
    {
      name: "Metrics",
      milestoneName: "Accounting",
      tasks: ["Record project token totals"],
    },
  ],
  openQuestions: [],
};

describe("project token usage storage", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-project-tokens-test-"));
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

  it("appends cumulative token totals by project slug", async () => {
    const repository = await import("@/lib/server/repository");
    const tokenUsage = await import("@/lib/server/project-token-usage");

    const created = await repository.createProjectFromSpec({
      name: "Token Totals",
      repoSource: ".",
      executionMode: "local_chatgpt",
      specFilename: "plan.md",
      specText: "# Blueprint\n\n## Goal\nPersist project token totals across multiple runs",
    });

    tokenUsage.appendProjectTokenUsageBySlug(created.slug, {
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
    });
    tokenUsage.appendProjectTokenUsageBySlug(created.slug, {
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
    });

    const snapshot = repository.getProjectSnapshot(created.projectId);

    expect(snapshot?.project.cumulativeTokenUsage).toEqual({
      inputTokens: 140,
      outputTokens: 35,
      totalTokens: 175,
    });
  });
});
