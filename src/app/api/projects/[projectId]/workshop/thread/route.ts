export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getLatestWorkshopThread,
  getProjectSnapshot,
  listWorkshopMessages,
} from "@/lib/server/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const snapshot = getProjectSnapshot(projectId);

  if (!snapshot) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const thread = getLatestWorkshopThread(projectId);

  return NextResponse.json({
    thread,
    messages: thread ? listWorkshopMessages(projectId, thread.id) : [],
  });
}
