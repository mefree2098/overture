import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectOperationalProfiles } from "@/lib/server/launch-profiles";
import type { ProjectRecord } from "@/lib/types";

function makeProject(repoSource: string): ProjectRecord {
  const timestamp = new Date().toISOString();

  return {
    id: "project-id",
    slug: "project-slug",
    name: "Project",
    repoSource,
    executionMode: "local_chatgpt",
    lifecycleStage: "draft",
    researchProvider: "codex_native",
    plannerModel: "gpt-5.4",
    executionModel: "gpt-5.4",
    plannerReasoningEffort: "low",
    executionReasoningEffort: "low",
    symphonyMaxConcurrentAgents: 5,
    symphonyMaxTurns: 24,
    status: "draft",
    health: "on_track",
    qaStrictness: 5,
    securityStrictness: 5,
    deploymentTargets: ["local"],
    cumulativeTokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  };
}

describe("detectOperationalProfiles", () => {
  let repoRoot = "";

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "overture-launch-profiles-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("uses repo-defined healthcheck URLs for docker launch and local deploy profiles", () => {
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: { next: "16.1.6", react: "19.0.0" },
        scripts: { dev: "next dev" },
      }),
      "utf8",
    );
    writeFileSync(path.join(repoRoot, "docker-compose.yml"), "services: {}\n", "utf8");
    writeFileSync(path.join(repoRoot, "deploy.sh"), "#!/usr/bin/env bash\n", "utf8");
    writeFileSync(
      path.join(repoRoot, ".env.example"),
      "OVERTURE_DOCKER_HEALTHCHECK_URL=http://host.docker.internal:4020/ready\nOVERTURE_DEPLOY_HEALTHCHECK_URL=http://host.docker.internal:4020/api/health\n",
      "utf8",
    );
    mkdirSync(path.join(repoRoot, "infra", "azure"), { recursive: true });
    writeFileSync(path.join(repoRoot, "infra", "azure", "main.bicep"), "param foo string\n", "utf8");

    const detected = detectOperationalProfiles(makeProject(repoRoot));
    const dockerLaunch = detected.launchProfiles.find((profile) => profile.target === "docker");
    const localDeploy = detected.deployProfiles.find((profile) => profile.target === "local");

    expect(dockerLaunch?.healthcheckUrl).toBe("http://host.docker.internal:4020/ready");
    expect(localDeploy?.metadata.healthcheckUrl).toBe(
      "http://host.docker.internal:4020/api/health",
    );
  });
});
