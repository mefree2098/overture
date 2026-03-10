import { expect, test } from "@playwright/test";

test("creates a project and loads the project dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Choose the fast lane or let Overture build the plan with you/i,
    }),
  ).toBeVisible();

  const projectName = `E2E Project ${Date.now()}`;
  await page.getByRole("button", { name: /I already have a finished plan/i }).click();
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

test("creates a guided draft project and lands in the workshop", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Start from notes, goals, or rough ideas/i }),
  ).toBeVisible();

  const projectName = `Guided Project ${Date.now()}`;
  await page.getByLabel("Project name").fill(projectName);
  await page.getByRole("button", { name: /Start guided project/i }).click();
  await page.waitForURL(/\/projects\/.+\/workshop/);

  await expect(page.getByRole("heading", { name: /Prompt Workshop/i })).toBeVisible();
  await expect(page.getByText(/No workshop turns yet/i)).toBeVisible();
});
