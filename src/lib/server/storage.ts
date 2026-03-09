import { mkdirSync } from "node:fs";
import path from "node:path";

function resolveAppRoot() {
  const cwd = process.cwd();

  if (
    path.basename(cwd) === "standalone" &&
    path.basename(path.dirname(cwd)) === ".next"
  ) {
    return path.resolve(cwd, "../..");
  }

  return cwd;
}

function resolveRuntimeBaseRoot() {
  if (process.env.OVERTURE_ROOT) {
    return path.resolve(process.env.OVERTURE_ROOT);
  }

  return resolveAppRoot();
}

const rootDir = path.join(resolveRuntimeBaseRoot(), ".overture");
const dataDir = path.join(rootDir, "data");
const artifactsDir = path.join(rootDir, "artifacts");
const projectsDir = path.join(rootDir, "projects");
const workspacesDir = path.join(rootDir, "workspaces");

for (const dir of [rootDir, dataDir, artifactsDir, projectsDir, workspacesDir]) {
  mkdirSync(dir, { recursive: true });
}

export function getPlatformRoot() {
  return rootDir;
}

export function getWorkspaceRoot() {
  return resolveAppRoot();
}

export function getRuntimeBaseRoot() {
  return resolveRuntimeBaseRoot();
}

export function getDatabasePath() {
  return process.env.OVERTURE_DB_PATH ?? path.join(dataDir, "overture.db");
}

export function getArtifactsRoot() {
  return artifactsDir;
}

export function getProjectPaths(projectSlug: string) {
  return {
    projectRoot: path.join(projectsDir, projectSlug),
    projectArtifactsRoot: path.join(artifactsDir, projectSlug),
    projectWorkspaceRoot: path.join(workspacesDir, projectSlug),
  };
}

export function getProjectRoot(projectSlug: string) {
  const { projectRoot } = getProjectPaths(projectSlug);
  mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

export function getProjectArtifactsRoot(projectSlug: string) {
  const { projectArtifactsRoot } = getProjectPaths(projectSlug);
  mkdirSync(projectArtifactsRoot, { recursive: true });
  return projectArtifactsRoot;
}

export function getProjectWorkspaceRoot(projectSlug: string) {
  const { projectWorkspaceRoot } = getProjectPaths(projectSlug);
  mkdirSync(projectWorkspaceRoot, { recursive: true });
  return projectWorkspaceRoot;
}

export function assertWithinRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);

  if (
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`) &&
    resolvedTarget !== resolvedRoot
  ) {
    throw new Error("Attempted to access a path outside the allowed root.");
  }

  return resolvedTarget;
}
