import { readFileSync } from "node:fs";
import path from "node:path";
import { createProjectFromSpec, listProjects } from "@/lib/server/repository";
import { recommendedExecutionMode } from "@/lib/server/runtime-config";

const planPath = path.join(process.cwd(), "plan.md");
const existingProject = listProjects().find((project) =>
  project.project.name.toLowerCase().includes("overture"),
);

if (existingProject) {
  console.log(existingProject.project.id);
  process.exit(0);
}

const specText = readFileSync(planPath, "utf8");
const project = await createProjectFromSpec({
  name: "Overture Control Plane",
  repoSource: process.cwd(),
  executionMode: recommendedExecutionMode(),
  policyProfile: {
    qaStrictness: 5,
    securityStrictness: 5,
  },
  specFilename: "plan.md",
  specText,
});

console.log(project.projectId);
