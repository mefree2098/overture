import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  deployProfileMatchesDeploymentScope,
  launchProfileMatchesDeploymentScope,
} from "@/lib/project-pipeline";
import { normalizeRepoSource } from "@/lib/server/runtime-config";
import { getProjectPaths } from "@/lib/server/storage";
import type {
  ArtifactRecord,
  DeployProfileRecord,
  LaunchProfileRecord,
  ProjectProductCommandRecord,
  ProjectProductDocumentRecord,
  ProjectProductGuide,
  ProjectProductLocationRecord,
  ProjectRecord,
} from "@/lib/types";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

function isRemoteRepo(value: string) {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("ssh://") ||
    value.startsWith("git@") ||
    value.startsWith("file://")
  );
}

function hasMaterializedWorkspace(root: string) {
  if (!existsSync(root)) {
    return false;
  }

  try {
    return readdirSync(root).some((entry) => entry !== ".DS_Store");
  } catch {
    return false;
  }
}

function detectPackageManager(root: string): PackageManager {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (existsSync(path.join(root, "yarn.lock"))) {
    return "yarn";
  }

  if (existsSync(path.join(root, "bun.lock")) || existsSync(path.join(root, "bun.lockb"))) {
    return "bun";
  }

  return "npm";
}

function readPackageScripts(root: string) {
  const packageJsonPath = path.join(root, "package.json");

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? null;
  } catch {
    return null;
  }
}

function packageManagerRunCommand(packageManager: PackageManager, scriptName: string) {
  switch (packageManager) {
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return scriptName === "test" ? "yarn test" : `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    default:
      return scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
  }
}

function displayScriptLabel(scriptName: string) {
  switch (scriptName) {
    case "test":
      return "Run tests";
    case "lint":
      return "Run lint";
    case "build":
      return "Build production bundle";
    case "typecheck":
      return "Run typecheck";
    case "check":
      return "Run checks";
    case "verify":
      return "Run verification";
    default:
      return `Run ${scriptName}`;
  }
}

function selectTestCommands(root: string): ProjectProductCommandRecord[] {
  const scripts = readPackageScripts(root);

  if (!scripts) {
    return [];
  }

  const packageManager = detectPackageManager(root);
  const candidateScripts = [
    "test",
    "lint",
    "build",
    "typecheck",
    "check",
    "verify",
    "test:unit",
    "test:integration",
    "test:e2e",
    "e2e",
  ];

  return candidateScripts
    .filter((scriptName, index, values) => values.indexOf(scriptName) === index && scripts[scriptName])
    .slice(0, 6)
    .map((scriptName) => ({
      id: `test:${scriptName}`,
      label: displayScriptLabel(scriptName),
      command: packageManagerRunCommand(packageManager, scriptName),
      cwd: root,
      detail: scripts[scriptName] ?? "",
      category: "test",
    }));
}

function toAccessCommand(input: {
  id: string;
  label: string;
  path: string;
  detail: string;
}): ProjectProductCommandRecord {
  return {
    id: input.id,
    label: input.label,
    command: `cd ${JSON.stringify(input.path)}`,
    cwd: input.path,
    detail: input.detail,
    category: "access",
  };
}

function dedupeLocations(locations: ProjectProductLocationRecord[]) {
  const seen = new Set<string>();

  return locations.filter((location) => {
    if (seen.has(location.path)) {
      return false;
    }

    seen.add(location.path);
    return true;
  });
}

function preferredReadmePath(root: string) {
  const names = ["README.md", "README.mdx", "README.txt", "Readme.md"];

  for (const name of names) {
    const filePath = path.join(root, name);

    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function artifactDocument(
  artifact: ArtifactRecord | undefined,
  label: string,
  detail: string,
): ProjectProductDocumentRecord | null {
  if (!artifact) {
    return null;
  }

  return {
    id: `artifact:${artifact.id}`,
    label,
    detail,
    path: artifact.filePath,
    href: `/api/artifacts/${artifact.id}`,
  };
}

function latestArtifact(artifacts: ArtifactRecord[], kind: string) {
  return artifacts.find((artifact) => artifact.kind === kind);
}

function resolveCommandCwd(input: {
  cwd: string;
  sourceRoot: string;
  primaryPath: string;
  sourceIsRemote: boolean;
  usePrimaryWorkspace: boolean;
}) {
  if (!input.usePrimaryWorkspace) {
    return input.cwd;
  }

  if (input.sourceIsRemote) {
    return input.primaryPath;
  }

  const relative = path.relative(input.sourceRoot, input.cwd);

  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return path.join(input.primaryPath, relative);
  }

  return input.cwd;
}

export function buildProjectProductGuide(input: {
  project: ProjectRecord;
  artifacts: ArtifactRecord[];
  launchProfiles: LaunchProfileRecord[];
  deployProfiles: DeployProfileRecord[];
}) {
  const { projectRoot, projectArtifactsRoot, projectWorkspaceRoot } = getProjectPaths(
    input.project.slug,
  );
  const runtimeRoot = path.join(projectRoot, "symphony");
  const projectWorkflowPath = path.join(projectRoot, "WORKFLOW.md");
  const runtimeWorkflowPath = path.join(runtimeRoot, "WORKFLOW.md");
  const sourceRoot = normalizeRepoSource(input.project.repoSource);
  const sourceIsRemote = isRemoteRepo(sourceRoot);
  const workspaceReady = hasMaterializedWorkspace(projectWorkspaceRoot);
  const usePrimaryWorkspace = workspaceReady || sourceIsRemote;
  const primaryPath =
    usePrimaryWorkspace ? projectWorkspaceRoot : sourceRoot;
  const inspectionRoot =
    existsSync(primaryPath) && hasMaterializedWorkspace(primaryPath)
      ? primaryPath
      : !sourceIsRemote && existsSync(sourceRoot)
        ? sourceRoot
        : projectWorkspaceRoot;
  const readmePath = preferredReadmePath(inspectionRoot);
  const azureRunbookPath = path.join(inspectionRoot, "infra", "azure", "README.md");
  const awsRunbookPath = path.join(inspectionRoot, "infra", "aws", "README.md");
  const accessCommands: ProjectProductCommandRecord[] = [
    toAccessCommand({
      id: "access:workspace",
      label: workspaceReady ? "Open final workspace" : "Open working copy root",
      path: projectWorkspaceRoot,
      detail:
        "Symphony executes in this copied workspace. This is the best place to inspect the final code Overture produced.",
    }),
  ];

  if (!sourceIsRemote) {
    accessCommands.push(
      toAccessCommand({
        id: "access:source",
        label: "Open original source repo",
        path: sourceRoot,
        detail:
          "This is the original repo or folder Overture started from before execution created a working copy.",
      }),
    );
  }

  const scopedLaunchProfiles = input.launchProfiles.filter((profile) =>
    launchProfileMatchesDeploymentScope(profile.target, input.project.deploymentTargets),
  );
  const scopedDeployProfiles = input.deployProfiles.filter((profile) =>
    deployProfileMatchesDeploymentScope(profile.target, input.project.deploymentTargets),
  );

  const runCommands = scopedLaunchProfiles.map((profile) => ({
    id: `run:${profile.id}`,
    label: profile.label,
    command: profile.command,
    cwd: resolveCommandCwd({
      cwd: profile.cwd,
      sourceRoot,
      primaryPath,
      sourceIsRemote,
      usePrimaryWorkspace,
    }),
    detail:
      profile.healthcheckUrl
        ? `Launch target ${profile.target}. Healthcheck: ${profile.healthcheckUrl}`
        : `Launch target ${profile.target}.`,
    category: "run" as const,
  }));
  const publishCommands = scopedDeployProfiles.map((profile) => ({
    id: `publish:${profile.id}`,
    label: profile.label,
    command: profile.command,
    cwd: resolveCommandCwd({
      cwd: profile.cwd,
      sourceRoot,
      primaryPath,
      sourceIsRemote,
      usePrimaryWorkspace,
    }),
    detail:
      typeof profile.metadata.unavailableReason === "string"
        ? `Publishes to ${profile.target}. Local prerequisites are still missing: ${profile.metadata.unavailableReason}`
        : profile.approvalRequired
          ? `Publishes to ${profile.target}. Operator confirmation is required.`
          : `Publishes to ${profile.target}.`,
    category: "publish" as const,
  }));
  const testCommands = selectTestCommands(inspectionRoot);
  const locations = dedupeLocations([
    {
      id: "primary",
      label: workspaceReady || sourceIsRemote ? "Final product workspace" : "Source repository",
      path: primaryPath,
      detail:
        workspaceReady || sourceIsRemote
          ? "Use this path first when you want to inspect the final code or continue working on the generated product."
          : "No copied workspace is populated yet, so the source repository is currently the canonical code location.",
      primary: true,
    },
    {
      id: "workspace",
      label: "Symphony working copy",
      path: projectWorkspaceRoot,
      detail:
        "Automated execution clones or copies the source here before making changes.",
      primary: primaryPath === projectWorkspaceRoot,
    },
    !sourceIsRemote
      ? {
          id: "source",
          label: "Original repo source",
          path: sourceRoot,
          detail: "The original local repo or folder that seeded this project.",
          primary: primaryPath === sourceRoot,
        }
      : {
          id: "source-remote",
          label: "Original repo source",
          path: sourceRoot,
          detail: "The remote repo URL Overture cloned into the working copy.",
          primary: false,
        },
    {
      id: "runtime",
      label: "Project runtime files",
      path: runtimeRoot,
      detail: "Symphony runtime state, logs, and workflow files live here.",
      primary: false,
    },
    {
      id: "artifacts",
      label: "Artifacts and evidence",
      path: projectArtifactsRoot,
      detail: "Reports, screenshots, logs, and generated evidence are stored here.",
      primary: false,
    },
  ]);
  const documents = [
    readmePath
      ? {
          id: "doc:readme",
          label: "README",
          detail: "Primary project documentation in the final code location.",
          path: readmePath,
          href: null,
        }
      : null,
    existsSync(projectWorkflowPath)
      ? {
          id: "doc:project-workflow",
          label: "Project workflow contract",
          detail: "The project-level workflow record Overture created during plan ingestion.",
          path: projectWorkflowPath,
          href: null,
        }
      : null,
    existsSync(runtimeWorkflowPath)
      ? {
          id: "doc:runtime-workflow",
          label: "Symphony runtime workflow",
          detail: "The workflow file currently used by the Symphony runtime.",
          path: runtimeWorkflowPath,
          href: null,
        }
      : null,
    input.project.deploymentTargets.includes("azure") && existsSync(azureRunbookPath)
      ? {
          id: "doc:azure-runbook",
          label: "Azure deploy runbook",
          detail: "Instructions and required inputs for the generated Azure deploy.sh flow.",
          path: azureRunbookPath,
          href: null,
        }
      : null,
    input.project.deploymentTargets.includes("aws") && existsSync(awsRunbookPath)
      ? {
          id: "doc:aws-runbook",
          label: "AWS deploy runbook",
          detail: "Instructions and required inputs for the generated AWS deploy.sh flow.",
          path: awsRunbookPath,
          href: null,
        }
      : null,
    artifactDocument(
      latestArtifact(input.artifacts, "launch-report"),
      "Latest launch report",
      "Most recent local launch evidence captured by Overture.",
    ),
    artifactDocument(
      latestArtifact(input.artifacts, "deployment-report"),
      "Latest deployment report",
      "Most recent deployment evidence captured by Overture.",
    ),
    artifactDocument(
      latestArtifact(input.artifacts, "research-plan"),
      "Latest generated plan",
      "The most recent plan artifact produced during research.",
    ),
    artifactDocument(
      latestArtifact(input.artifacts, "plan-review"),
      "Approved plan review",
      "The approved plan Overture handed into execution.",
    ),
  ].filter((document): document is ProjectProductDocumentRecord => Boolean(document));

  const notes = [
    workspaceReady
      ? "Overture executes against a copied workspace, so the final code usually lives in the Symphony working copy rather than the original source path."
      : "The working copy has not been populated yet. Start or rerun automation if you want Overture to materialize a final-code workspace.",
    input.project.deploymentTargets.some((target) => target === "aws" || target === "azure")
      ? "AWS and Azure rely on repo-level deploy.sh flows for one-command publishing. Overture can surface those commands when the repo includes them, but final cloud validation still stays operator-owned."
      : null,
  ].filter(Boolean);

  return {
    primaryPath,
    primaryLabel:
      workspaceReady || sourceIsRemote ? "Final product workspace" : "Source repository",
    locations,
    accessCommands,
    runCommands,
    testCommands,
    publishCommands,
    documents,
    notes,
  } satisfies ProjectProductGuide;
}
