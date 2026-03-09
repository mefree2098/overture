export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { appendAuditEvent, getProjectSnapshot } from "@/lib/server/repository";
import { startSymphonyForProject } from "@/lib/server/symphony-manager";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const snapshot = getProjectSnapshot(projectId);

  if (!snapshot) {
    return NextResponse.json(
      {
        error: "Project not found.",
      },
      { status: 404 },
    );
  }

  const symphony = await startSymphonyForProject(
    snapshot.project,
    new URL(request.url).origin,
  );

  appendAuditEvent({
    projectId,
    actor: "control-plane",
    action: "symphony.started",
    detail: `Symphony attached on port ${symphony.port} for ${snapshot.project.slug}.`,
    payload: {
      port: symphony.port,
      pid: symphony.pid,
      workflowPath: symphony.workflowPath,
    },
  });

  return NextResponse.json({
    ok: true,
    projectId,
    symphony,
  });
}
