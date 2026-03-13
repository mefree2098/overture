import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

const tempRepos: string[] = [];

function makeFixtureRepo() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "overture-e2e-repo-"));
  tempRepos.push(repoRoot);
  mkdirSync(path.join(repoRoot, "infra", "aws"), { recursive: true });
  mkdirSync(path.join(repoRoot, "infra", "azure"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      name: "overture-e2e-fixture",
      private: true,
      dependencies: {
        react: "19.0.0",
      },
      scripts: {
        dev: "node server.js",
      },
    }),
    "utf8",
  );
  writeFileSync(
    path.join(repoRoot, "server.js"),
    `const fs = require("node:fs");
const http = require("node:http");

const port = Number(process.env.PORT || process.env.DEPLOY_TEST_PORT || 4100);
const readyFile = process.env.READY_FILE;
const exitAfterHealthchecks = Number(process.env.EXIT_AFTER_HEALTHCHECKS || 0);
const exitAfterMs = Number(process.env.EXIT_AFTER_MS || 0);
let healthchecks = 0;

const server = http.createServer((req, res) => {
  if (req.url === "/api/health") {
    healthchecks += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    if (exitAfterHealthchecks > 0 && healthchecks >= exitAfterHealthchecks) {
      setTimeout(() => {
        server.close(() => process.exit(0));
      }, 25);
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("fixture ready");
});

server.listen(port, "127.0.0.1", () => {
  if (readyFile) {
    fs.writeFileSync(readyFile, String(port));
  }
  process.stdout.write("READY\\n");

  if (exitAfterMs > 0) {
    setTimeout(() => {
      server.close(() => process.exit(0));
    }, exitAfterMs);
  }
});
`,
    "utf8",
  );
  writeFileSync(
    path.join(repoRoot, "deploy.sh"),
    `#!/usr/bin/env bash
set -euo pipefail

mode="\${1:-local}"
if [ "$mode" != "local" ]; then
  echo "Unsupported mode: $mode" >&2
  exit 1
fi

ready_file="$(mktemp)"
deploy_port=$((4200 + (\${RANDOM:-0} % 200)))
DEPLOY_TEST_PORT="$deploy_port" EXIT_AFTER_MS=20000 READY_FILE="$ready_file" node server.js >/tmp/overture-e2e-deploy.log 2>&1 &
server_pid=$!

for _ in $(seq 1 50); do
  if [ -f "$ready_file" ]; then
    break
  fi
  sleep 0.1
done

if [ ! -f "$ready_file" ]; then
  echo "Deploy test server did not become ready." >&2
  kill "$server_pid" >/dev/null 2>&1 || true
  exit 1
fi

rm -f "$ready_file"
echo "OVERTURE_HEALTHCHECK_URL=http://127.0.0.1:\${deploy_port}/api/health"
`,
    "utf8",
  );
  writeFileSync(
    path.join(repoRoot, ".env.example"),
    "OVERTURE_DEPLOY_HEALTHCHECK_URL=http://127.0.0.1:4150/api/health\n",
    "utf8",
  );
  writeFileSync(path.join(repoRoot, "infra", "aws", "template.yaml"), "Resources: {}\n", "utf8");
  writeFileSync(path.join(repoRoot, "infra", "azure", "main.bicep"), "param location string\n", "utf8");

  return repoRoot;
}

async function supportedRuntimeDefaults(request: APIRequestContext) {
  const response = await request.get("/api/health");
  const payload = (await response.json()) as {
    codex: {
      localChatgptAvailable: boolean;
      hostedApiAvailable: boolean;
      researchProviderAvailability: {
        codexNativeAvailable: boolean;
        openaiResponsesAvailable: boolean;
      };
    };
  };

  const executionMode = payload.codex.localChatgptAvailable ? "local_chatgpt" : "hosted_api";
  const researchProvider = payload.codex.researchProviderAvailability.codexNativeAvailable
    ? "codex_native"
    : "openai_responses";

  if (!payload.codex.localChatgptAvailable && !payload.codex.hostedApiAvailable) {
    throw new Error("No supported execution mode is available for the e2e project fixture.");
  }

  if (
    !payload.codex.researchProviderAvailability.codexNativeAvailable &&
    !payload.codex.researchProviderAvailability.openaiResponsesAvailable
  ) {
    throw new Error("No supported research provider is available for the e2e project fixture.");
  }

  return { executionMode, researchProvider };
}

async function createDraftProject(request: APIRequestContext, input: {
  name: string;
  repoSource?: string;
  deploymentTargets?: string[];
}) {
  const runtime = await supportedRuntimeDefaults(request);
  const response = await request.post("/api/projects", {
    data: {
      mode: "draft",
      name: input.name,
      repoSource: input.repoSource ?? ".",
      executionMode: runtime.executionMode,
      researchProvider: runtime.researchProvider,
      policyProfile: {
        qaStrictness: 4,
        securityStrictness: 4,
        deploymentTargets: input.deploymentTargets ?? ["local"],
      },
    },
  });
  const payload = (await response.json()) as { projectId?: string; error?: string };

  expect(response.ok()).toBeTruthy();
  expect(payload.projectId).toBeTruthy();

  return payload.projectId!;
}

function refreshProjectOperationalProfiles(projectId: string) {
  execFileSync(
    "npm",
    [
      "exec",
      "--",
      "tsx",
      "-e",
      `(async () => { process.env.OVERTURE_ROOT = ${JSON.stringify(path.resolve(".overture-e2e"))}; const repositoryModule = await import(${JSON.stringify("./src/lib/server/repository.ts")}); const refreshOperationalProfiles = repositoryModule.refreshOperationalProfiles ?? repositoryModule.default?.refreshOperationalProfiles; if (typeof refreshOperationalProfiles !== "function") { throw new Error("refreshOperationalProfiles export was not available."); } refreshOperationalProfiles(${JSON.stringify(projectId)}); })().catch((error) => { console.error(error); process.exit(1); });`,
    ],
    {
      cwd: process.cwd(),
      stdio: "ignore",
    },
  );
}

async function createQuickProject(request: APIRequestContext, input: {
  name: string;
  repoSource?: string;
  deploymentTargets?: string[];
}) {
  const runtime = await supportedRuntimeDefaults(request);
  const response = await request.post("/api/projects", {
    data: {
      name: input.name,
      repoSource: input.repoSource ?? ".",
      executionMode: runtime.executionMode,
      researchProvider: runtime.researchProvider,
      policyProfile: {
        qaStrictness: 4,
        securityStrictness: 4,
        deploymentTargets: input.deploymentTargets ?? ["local"],
      },
      specFilename: "plan.md",
      specText: `# Example blueprint

**20) MVP scope**
- launch and deploy checks

**22) Implementation plan broken into milestones**
Milestone A: Delivery flow
- launch, deploy, and handoff
`,
    },
  });
  const payload = (await response.json()) as { projectId?: string; error?: string };

  if (!response.ok || !payload.projectId) {
    if (/usage limit|Codex planning failed/i.test(payload.error ?? "")) {
      return null;
    }

    return null;
  }

  return payload.projectId;
}

test.afterEach(() => {
  while (tempRepos.length) {
    const repoRoot = tempRepos.pop();

    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});

test("loads the guided project workspace", async ({ page, request }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Choose the fast lane or let Overture build the plan with you/i,
    }),
  ).toBeVisible();

  const projectName = `Draft Project ${Date.now()}`;
  const projectId = await createDraftProject(request, {
    name: projectName,
  });

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Prompt Workshop/i })).toBeVisible();
  await expect(page.getByText(/No workshop turns yet/i)).toBeVisible();

  await page.screenshot({
    path: "test-results/project-dashboard.png",
    fullPage: true,
  });
});

test("creates a guided draft project from the intake UI and lands in the workshop", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Choose the fast lane or let Overture build the plan with you/i,
    }),
  ).toBeVisible();

  const projectName = `Guided Project ${Date.now()}`;
  await page.getByLabel("Project name").fill(projectName);
  await page.getByRole("button", { name: /Start guided project/i }).click();
  await page.waitForURL(/\/projects\/.+\/workshop/);

  await expect(page.getByRole("heading", { name: /Prompt Workshop/i })).toBeVisible();
  await expect(page.getByText(/No workshop turns yet/i)).toBeVisible();
});

test("manages findings from the project overview and keeps out-of-scope cloud publish commands hidden", async ({
  page,
  request,
}) => {
  const projectName = `QA Project ${Date.now()}`;
  const projectId = await createQuickProject(request, {
    name: projectName,
  });

  if (!projectId) {
    test.skip(true, "Codex planner credits are unavailable for the live-shell smoke.");
    return;
  }

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  await page.getByRole("button", { name: "Final product", exact: true }).last().click();
  await expect(page.getByText("Source repository", { exact: true })).toBeVisible();
  await expect(page.getByText(/AWS deployment/i)).toHaveCount(0);
  await expect(page.getByText(/Azure deployment/i)).toHaveCount(0);

  await page.getByRole("button", { name: /Overview/i }).click();
  await page.getByLabel("Finding title").fill("Release notes are incomplete");
  await page.getByLabel("Finding detail").fill("Manual QA review found the release notes are missing rollback guidance.");
  await page.getByRole("button", { name: /Add finding/i }).click();
  await expect(page.getByText(/Release notes are incomplete/i)).toBeVisible();

  await page
    .locator("div")
    .filter({ hasText: /Release notes are incomplete/ })
    .getByRole("button", { name: /Mark resolved/i })
    .click();

  await expect(page.getByText(/No open findings right now\./i)).toBeVisible();
});

test("saves settings from the operator UI", async ({ page }) => {
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", {
      name: /Choose how Overture plans and runs projects/i,
    }),
  ).toBeVisible();

  const maxTurnsInput = page.getByRole("spinbutton", { name: /Max turns per ticket/i });
  await maxTurnsInput.fill("26");
  await page.getByRole("button", { name: /Save settings/i }).click();
  await expect(page.getByText(/Settings saved|Settings already match/i)).toBeVisible();
});

test("runs and stops a launch profile from the launch page", async ({ page, request }) => {
  const repoRoot = makeFixtureRepo();
  const projectId = await createDraftProject(request, {
    name: `Launch Fixture ${Date.now()}`,
    repoSource: repoRoot,
  });
  refreshProjectOperationalProfiles(projectId);

  await page.goto(`/projects/${projectId}/launch`);
  await expect(page.getByText(/Web app dev server/i)).toBeVisible();
  await page.getByRole("button", { name: /Launch this profile/i }).first().click();

  await expect(page.getByText(/Launched Web app dev server and verified/i).last()).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("link", { name: /Web app dev server launch report/i })).toBeVisible({
    timeout: 60000,
  });

  await page.getByRole("button", { name: /Stop process/i }).click();
  await expect(page.getByText(/Process stopped/i)).toBeVisible({
    timeout: 15000,
  });
});

test("runs a local deploy and surfaces cloud prereq warnings on the deploy page", async ({
  page,
  request,
}) => {
  const repoRoot = makeFixtureRepo();
  const projectId = await createDraftProject(request, {
    name: `Deploy Fixture ${Date.now()}`,
    repoSource: repoRoot,
  });
  refreshProjectOperationalProfiles(projectId);

  await page.goto(`/projects/${projectId}/deploy`);
  await expect(page.getByText(/Local container release/i)).toBeVisible();
  await page.getByRole("button", { name: /Run deployment/i }).click();

  await expect(page.getByText(/Deployment completed for Local container release/i).last()).toBeVisible({
    timeout: 90000,
  });
  await expect(page.getByRole("link", { name: /Local container release deployment report/i })).toBeVisible({
    timeout: 90000,
  });

  const supplementalProfiles = page.getByText(/Additional detected profiles/i);
  await expect(supplementalProfiles).toBeVisible();

  const awsCard = page.locator("div").filter({ hasText: /AWS EC2 deployment/i }).first();
  const azureCard = page.locator("div").filter({ hasText: /Azure VM deployment/i }).first();
  await expect(awsCard).toBeVisible();
  await expect(azureCard).toBeVisible();

  const warningPattern =
    /OPENAI_API_KEY|AWS CLI|Docker buildx|usable credentials|AWS region|Azure CLI|AZURE_RESOURCE_GROUP|active login|SSH public key/;

  if (await awsCard.getByText(warningPattern).count()) {
    await expect(awsCard.getByRole("button", { name: /Deploy anyway/i })).toBeDisabled();
  }

  if (await azureCard.getByText(warningPattern).count()) {
    await expect(azureCard.getByRole("button", { name: /Deploy anyway/i })).toBeDisabled();
  }
});
