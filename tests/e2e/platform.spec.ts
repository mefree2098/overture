import { expect, test } from "@playwright/test";

test("creates a project and loads the project dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Build a project from a written plan/i }),
  ).toBeVisible();

  const projectName = `E2E Project ${Date.now()}`;
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Repo source").fill(".");
  await page.getByLabel("Plan content").fill(`# Example blueprint

**20) MVP scope**
- audit trail

**22) Implementation plan broken into milestones**
Milestone A: Platform skeleton
- Control plane API + UI scaffolding
`);

  await page.getByRole("button", { name: /Create project/i }).click();
  await page.waitForURL(/\/projects\//);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  await page.screenshot({
    path: "test-results/project-dashboard.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: /Launch Symphony/i }).click();
  await expect
    .poll(async () => {
      return page.getByText(/Runtime live/i).isVisible();
    })
    .toBeTruthy();
});
