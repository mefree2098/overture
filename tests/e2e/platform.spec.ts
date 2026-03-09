import { expect, test } from "@playwright/test";

test("creates a project and loads the project dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Ingest a deep research plan/i }),
  ).toBeVisible();

  const projectName = `E2E Project ${Date.now()}`;
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Repo source").fill(".");
  await page.getByRole("textbox").last().fill(`# Example blueprint

**20) MVP scope**
- audit trail

**22) Implementation plan broken into milestones**
Milestone A: Platform skeleton
- Control plane API + UI scaffolding
`);

  await page.getByRole("button", { name: /Generate project plan/i }).click();
  await page.waitForURL(/\/projects\//);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  await page.screenshot({
    path: "test-results/project-dashboard.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: /Run execution loop/i }).click();
  await expect
    .poll(async () => {
      const statuses = await page.locator("text=Succeeded").count();
      return statuses > 0;
    })
    .toBeTruthy();
});
