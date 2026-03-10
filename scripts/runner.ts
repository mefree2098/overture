import { getProjectSnapshot } from "@/lib/server/repository";
import { getInternalControlPlaneOrigin } from "@/lib/server/runtime-config";
import { startSymphonyForProject } from "@/lib/server/symphony-manager";

const projectId = process.argv[2];
const origin = getInternalControlPlaneOrigin();

if (!projectId) {
  throw new Error("Usage: tsx scripts/runner.ts <projectId>");
}

const snapshot = getProjectSnapshot(projectId);

if (!snapshot) {
  throw new Error(`Unknown project: ${projectId}`);
}

const runtime = await startSymphonyForProject(snapshot.project, origin);
console.log(JSON.stringify(runtime, null, 2));
