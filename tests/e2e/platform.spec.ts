import { expect, test } from "@playwright/test";

test("creates a project and loads the project dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Choose the fast lane or let Overture build the plan with you/i,
    }),
  ).toBeVisible();

  const projectName = `E2E Project ${Date.now()}`;
  const quickPathCard = page
    .locator("button")
    .filter({ hasText: "Quick path" })
    .filter({ hasText: "I already have a finished plan" });
  await quickPathCard.click();
  await expect(page.getByLabel("Plan content")).toBeVisible();
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Plan content").fill(`# Example blueprint

**20) MVP scope**
- audit trail

**22) Implementation plan broken into milestones**
Milestone A: Platform skeleton
- Control plane API + UI scaffolding
`);

  await page.getByRole("button", { name: /Turn this plan into a project/i }).click();
  await page.waitForURL(/\/projects\//);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  await page.getByText(/Project settings and options/i).click();
  const renamedProject = `${projectName} Renamed`;
  await page.getByLabel("Rename project").fill(renamedProject);
  await page.getByRole("button", { name: /Save name/i }).click();
  await expect(page.getByRole("heading", { name: renamedProject })).toBeVisible();

  await page.screenshot({
    path: "test-results/project-dashboard.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: /Start automated run/i }).click();
  await expect
    .poll(async () => {
      return page.getByText(/Automated run is live/i).isVisible();
    })
    .toBeTruthy();
});

test("creates a guided draft project and lands in the workshop", async ({ page, request }) => {
  const projectName = `Guided Project ${Date.now()}`;
  const response = await request.post("/api/projects/drafts", {
    data: {
      name: projectName,
      repoSource: ".",
      executionMode: "local_chatgpt",
    },
  });
  const payload = (await response.json()) as { projectId: string };

  expect(response.ok()).toBeTruthy();

  await page.goto(`/projects/${payload.projectId}/workshop`);

  await expect(page.getByRole("heading", { name: /Prompt Workshop/i })).toBeVisible();
  await expect(page.getByText(/No workshop turns yet/i)).toBeVisible();
});

test("manages findings from the project overview and keeps out-of-scope cloud publish commands hidden", async ({
  page,
}) => {
  await page.goto("/");

  const projectName = `QA Project ${Date.now()}`;
  const quickPathCard = page
    .locator("button")
    .filter({ hasText: "Quick path" })
    .filter({ hasText: "I already have a finished plan" });
  await quickPathCard.click();
  await expect(page.getByLabel("Plan content")).toBeVisible();
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Plan content").fill(`# Example blueprint

**20) MVP scope**
- release evidence

**22) Implementation plan broken into milestones**
Milestone A: Control plane
- overview, findings, and handoff
`);

  await page.getByRole("button", { name: /Turn this plan into a project/i }).click();
  await page.waitForURL(/\/projects\//);
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
