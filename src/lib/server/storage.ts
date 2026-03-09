import { mkdirSync } from "node:fs";
import path from "node:path";

function resolveWorkspaceRoot() {
  if (process.env.OVERTURE_ROOT) {
    return path.resolve(process.env.OVERTURE_ROOT);
  }

  const cwd = process.cwd();

  if (
    path.basename(cwd) === "standalone" &&
    path.basename(path.dirname(cwd)) === ".next"
  ) {
    return path.resolve(cwd, "../..");
  }

  return cwd;
}

const rootDir = path.join(resolveWorkspaceRoot(), ".overture");
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
  return path.dirname(rootDir);
}

export function getDatabasePath() {
  return process.env.OVERTURE_DB_PATH ?? path.join(dataDir, "overture.db");
}

export function getArtifactsRoot() {
  return artifactsDir;
}

export function getProjectRoot(projectSlug: string) {
  const projectRoot = path.join(projectsDir, projectSlug);
  mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

export function getProjectArtifactsRoot(projectSlug: string) {
  const projectArtifactsRoot = path.join(artifactsDir, projectSlug);
  mkdirSync(projectArtifactsRoot, { recursive: true });
  return projectArtifactsRoot;
}

export function getProjectWorkspaceRoot(projectSlug: string) {
  const projectWorkspaceRoot = path.join(workspacesDir, projectSlug);
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
