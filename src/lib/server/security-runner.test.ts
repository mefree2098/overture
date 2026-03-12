import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("runProjectSecurityReview", () => {
  const originalEnv = { ...process.env };
  let runtimeRoot = "";
  let sourceRoot = "";

  beforeEach(() => {
    vi.resetModules();
    runtimeRoot = mkdtempSync(path.join(tmpdir(), "overture-security-runtime-"));
    sourceRoot = mkdtempSync(path.join(tmpdir(), "overture-security-source-"));
    process.env.OVERTURE_ROOT = runtimeRoot;
    process.env.OVERTURE_DB_PATH = path.join(runtimeRoot, "db", "overture.test.db");
    process.env.OVERTURE_SECURITY_SKIP_EXTERNAL = "1";
    mkdirSync(path.join(runtimeRoot, "db"), { recursive: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(runtimeRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("writes security evidence and reconciles generated findings against the current workspace", async () => {
    const repository = await import("@/lib/server/repository");
    const { runProjectSecurityReview } = await import("@/lib/server/security-runner");

    mkdirSync(path.join(sourceRoot, "config"), { recursive: true });
    mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    writeFileSync(path.join(sourceRoot, ".env"), "OPENAI_API_KEY=sk-live-abcdefghijklmnopqrstuvwxyz\n");
    writeFileSync(path.join(sourceRoot, "config", "prod.pem"), "-----BEGIN PRIVATE KEY-----\n");
    writeFileSync(
      path.join(sourceRoot, "src", "app.ts"),
      'export const leakedToken = "ghp_abcdefghijklmnopqrstuvwxyz123456";\n',
    );

    const created = repository.createDraftProject({
      name: "Security Review",
      repoSource: sourceRoot,
      executionMode: "local_chatgpt",
    });

    const firstRun = await runProjectSecurityReview({
      projectId: created.projectId,
    });
    const firstSnapshot = repository.getProjectSnapshot(created.projectId);

    expect(firstRun.summary).toContain("open finding");
    expect(firstSnapshot?.artifacts.some((artifact) => artifact.kind === "security-report")).toBe(true);
    expect(firstSnapshot?.gateStatus.securityStatus).toBe("fail");
    expect(
      firstSnapshot?.findings
        .filter((finding) => finding.status === "open")
        .map((finding) => finding.source),
    ).toEqual(
      expect.arrayContaining([
        "security-scan:committed-env-files",
        "security-scan:private-key-files",
        "security-scan:secret-patterns",
        "security-scan:verification-coverage",
      ]),
    );

    unlinkSync(path.join(sourceRoot, ".env"));
    unlinkSync(path.join(sourceRoot, "config", "prod.pem"));
    writeFileSync(path.join(sourceRoot, "src", "app.ts"), "export const safeValue = 'ok';\n");

    const secondRun = await runProjectSecurityReview({
      projectId: created.projectId,
    });
    const secondSnapshot = repository.getProjectSnapshot(created.projectId);
    const latestReport = secondSnapshot?.artifacts.find((artifact) => artifact.kind === "security-report");

    expect(secondRun.summary).toContain("open finding");
    expect(secondSnapshot?.gateStatus.securityStatus).toBe("pending");
    expect(
      secondSnapshot?.findings
        .filter(
          (finding) =>
            finding.source.startsWith("security-scan:") &&
            finding.source !== "security-scan:verification-coverage",
        )
        .every((finding) => ["resolved", "accepted_risk"].includes(finding.status)),
    ).toBe(true);
    expect(
      secondSnapshot?.findings.find(
        (finding) => finding.source === "security-scan:verification-coverage",
      )?.status,
    ).toBe("open");
    expect(latestReport?.metadata.coverageComplete).toBe(false);
  });
});
