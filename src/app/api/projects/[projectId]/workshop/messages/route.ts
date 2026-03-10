export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { sendWorkshopMessage } from "@/lib/server/prompt-workshop-service";

const workshopMessageSchema = z.object({
  message: z.string().min(1).max(8000),
  searchMode: z.enum(["cached", "live", "provider_fallback"]).optional(),
  repoContext: z.string().max(2000).nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = workshopMessageSchema.parse(await request.json());
    const result = await sendWorkshopMessage({
      projectId,
      message: parsed.message,
      searchMode: parsed.searchMode,
      repoContext: parsed.repoContext ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to send workshop message.",
      },
      { status: 400 },
    );
  }
}
