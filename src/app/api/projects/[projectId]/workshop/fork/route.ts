export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { forkWorkshopThread } from "@/lib/server/prompt-workshop-service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    return NextResponse.json(forkWorkshopThread(projectId), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to fork workshop thread.",
      },
      { status: 400 },
    );
  }
}
