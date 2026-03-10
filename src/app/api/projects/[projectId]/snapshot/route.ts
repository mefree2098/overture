export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProjectSnapshot } from "@/lib/server/repository";
import { getSymphonyRuntime } from "@/lib/server/symphony-manager";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const snapshot = getProjectSnapshot(projectId);

  if (!snapshot) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const symphony = await getSymphonyRuntime(snapshot.project.slug);
  const refreshedSnapshot = getProjectSnapshot(projectId) ?? snapshot;

  return NextResponse.json({
    ...refreshedSnapshot,
    symphony,
  });
}
