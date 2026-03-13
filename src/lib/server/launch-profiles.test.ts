import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

function makeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content, "utf8");
  chmodSync(filePath, 0o755);
}

describe("detectOperationalProfiles", () => {
  const originalEnv = { ...process.env };
  let repoRoot = "";

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "overture-launch-profiles-"));
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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

  it("exposes cloud deploy targets but marks them unavailable when local prerequisites are missing", () => {
    process.env.PATH = "";
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_RESOURCE_GROUP;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;

    mkdirSync(path.join(repoRoot, "infra", "aws"), { recursive: true });
    writeFileSync(path.join(repoRoot, "infra", "aws", "template.yaml"), "Resources: {}\n", "utf8");
    mkdirSync(path.join(repoRoot, "infra", "azure"), { recursive: true });
    writeFileSync(path.join(repoRoot, "infra", "azure", "main.bicep"), "param foo string\n", "utf8");
    writeFileSync(path.join(repoRoot, "deploy.sh"), "#!/usr/bin/env bash\n", "utf8");

    const detected = detectOperationalProfiles(makeProject(repoRoot));
    const awsDeploy = detected.deployProfiles.find((profile) => profile.target === "aws");
    const azureDeploy = detected.deployProfiles.find((profile) => profile.target === "azure");

    expect(awsDeploy?.command).toBe("bash deploy.sh aws");
    expect(awsDeploy?.metadata.unavailableReason).toContain("AWS CLI (`aws`) was not found on PATH.");
    expect(azureDeploy?.command).toBe("bash deploy.sh azure");
    expect(azureDeploy?.metadata.unavailableReason).toContain("Azure CLI (`az`) was not found on PATH.");
  });

  it("uses AWS CLI config for region detection and requires docker buildx specifically", () => {
    const binRoot = path.join(repoRoot, "bin");
    mkdirSync(binRoot, { recursive: true });
    makeExecutable(
      path.join(binRoot, "aws"),
      `#!/bin/sh
if [ "$1" = "configure" ] && [ "$2" = "get" ] && [ "$3" = "region" ]; then
  echo "us-west-2"
  exit 0
fi
exit 0
`,
    );
    makeExecutable(
      path.join(binRoot, "docker"),
      `#!/bin/sh
if [ "$1" = "buildx" ] && [ "$2" = "version" ]; then
  exit 1
fi
exit 0
`,
    );
    makeExecutable(path.join(binRoot, "curl"), "#!/bin/sh\nexit 0\n");
    process.env.PATH = binRoot;
    process.env.OPENAI_API_KEY = "sk-live-test";
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;

    mkdirSync(path.join(repoRoot, "infra", "aws"), { recursive: true });
    writeFileSync(path.join(repoRoot, "infra", "aws", "template.yaml"), "Resources: {}\n", "utf8");
    writeFileSync(path.join(repoRoot, "deploy.sh"), "#!/usr/bin/env bash\n", "utf8");

    const detected = detectOperationalProfiles(makeProject(repoRoot));
    const awsDeploy = detected.deployProfiles.find((profile) => profile.target === "aws");

    expect(awsDeploy?.metadata.unavailableReason).toContain("Docker buildx is required");
    expect(awsDeploy?.metadata.unavailableReason).not.toContain("AWS region was not found");
  });

  it("checks Azure login by calling az account show", () => {
    const binRoot = path.join(repoRoot, "bin");
    const sshKeyPath = path.join(repoRoot, "id_ed25519.pub");
    mkdirSync(binRoot, { recursive: true });
    makeExecutable(
      path.join(binRoot, "az"),
      `#!/bin/sh
if [ "$1" = "account" ] && [ "$2" = "show" ]; then
  exit 0
fi
exit 0
`,
    );
    makeExecutable(path.join(binRoot, "curl"), "#!/bin/sh\nexit 0\n");
    process.env.PATH = binRoot;
    process.env.OPENAI_API_KEY = "sk-live-test";
    process.env.AZURE_RESOURCE_GROUP = "overture-rg";
    process.env.AZURE_SSH_PUBLIC_KEY_FILE = sshKeyPath;
    writeFileSync(sshKeyPath, "ssh-ed25519 AAAATEST overture@test\n", "utf8");

    mkdirSync(path.join(repoRoot, "infra", "azure"), { recursive: true });
    writeFileSync(path.join(repoRoot, "infra", "azure", "main.bicep"), "param foo string\n", "utf8");
    writeFileSync(path.join(repoRoot, "deploy.sh"), "#!/usr/bin/env bash\n", "utf8");

    const detected = detectOperationalProfiles(makeProject(repoRoot));
    const azureDeploy = detected.deployProfiles.find((profile) => profile.target === "azure");

    expect(azureDeploy?.metadata.unavailableReason).toBeUndefined();
    expect(azureDeploy?.metadata.availability).toBe("ready");
  });

  it("marks AWS deploys unavailable when credentials are missing even if the CLI and region exist", () => {
    const binRoot = path.join(repoRoot, "bin");
    mkdirSync(binRoot, { recursive: true });
    makeExecutable(
      path.join(binRoot, "aws"),
      `#!/bin/sh
if [ "$1" = "configure" ] && [ "$2" = "get" ] && [ "$3" = "region" ]; then
  echo "us-west-2"
  exit 0
fi
if [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then
  exit 255
fi
exit 0
`,
    );
    makeExecutable(
      path.join(binRoot, "docker"),
      `#!/bin/sh
if [ "$1" = "buildx" ] && [ "$2" = "version" ]; then
  exit 0
fi
exit 0
`,
    );
    makeExecutable(path.join(binRoot, "curl"), "#!/bin/sh\nexit 0\n");
    process.env.PATH = binRoot;
    process.env.OPENAI_API_KEY = "sk-live-test";

    mkdirSync(path.join(repoRoot, "infra", "aws"), { recursive: true });
    writeFileSync(path.join(repoRoot, "infra", "aws", "template.yaml"), "Resources: {}\n", "utf8");
    writeFileSync(path.join(repoRoot, "deploy.sh"), "#!/usr/bin/env bash\n", "utf8");

    const detected = detectOperationalProfiles(makeProject(repoRoot));
    const awsDeploy = detected.deployProfiles.find((profile) => profile.target === "aws");

    expect(awsDeploy?.metadata.unavailableReason).toContain(
      "`aws sts get-caller-identity` did not find usable credentials.",
    );
  });

  it("uses workspace-aware xcodebuild commands when an xcworkspace is present", () => {
    mkdirSync(path.join(repoRoot, "PenPal.xcworkspace"), { recursive: true });

    const detected = detectOperationalProfiles(makeProject(repoRoot));
    const simulatorLaunch = detected.launchProfiles.find(
      (profile) => profile.target === "ios_simulator",
    );
    const testflightDeploy = detected.deployProfiles.find(
      (profile) => profile.target === "ios_testflight",
    );

    expect(simulatorLaunch?.command).toContain('-workspace "PenPal.xcworkspace"');
    expect(simulatorLaunch?.command).not.toContain("-project");
    expect(testflightDeploy?.command).toContain('-workspace "PenPal.xcworkspace"');
    expect(testflightDeploy?.command).toContain('-scheme "PenPal"');
  });

  it("uses the repository package manager for launch script commands", () => {
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: { next: "16.1.6", react: "19.0.0" },
        scripts: { dev: "next dev" },
      }),
      "utf8",
    );
    writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const detected = detectOperationalProfiles(makeProject(repoRoot));
    const webLaunch = detected.launchProfiles.find((profile) => profile.target === "web");

    expect(webLaunch?.command).toBe("pnpm run dev");
  });
});
