export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  appendAuditEvent,
  getProjectSnapshot,
  setProjectLifecycleStage,
} from "@/lib/server/repository";
import { getInternalControlPlaneOrigin } from "@/lib/server/runtime-config";
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

  try {
    const symphony = await startSymphonyForProject(
      snapshot.project,
      getInternalControlPlaneOrigin(new URL(request.url).origin),
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
    setProjectLifecycleStage(projectId, "executing");

    return NextResponse.json({
      ok: true,
      projectId,
      symphony,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start Symphony.";

    appendAuditEvent({
      projectId,
      actor: "control-plane",
      action: "symphony.start_failed",
      detail: message.split("\n")[0] || "Failed to start Symphony.",
      payload: {
        error: message,
      },
    });

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
