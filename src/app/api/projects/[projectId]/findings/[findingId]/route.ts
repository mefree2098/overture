export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { updateFindingStatus } from "@/lib/server/repository";

const updateFindingSchema = z.object({
  status: z.enum([
    "open",
    "fix_in_progress",
    "fixed_pending_recheck",
    "accepted_risk",
    "resolved",
  ]),
  note: z.string().trim().max(500).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; findingId: string }> },
) {
  try {
    const { projectId, findingId } = await context.params;
    const parsed = updateFindingSchema.parse(await request.json());
    const finding = updateFindingStatus({
      projectId,
      findingId,
      status: parsed.status,
      note: parsed.note,
    });

    if (!finding) {
      return NextResponse.json({ error: "Finding not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      finding,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update the finding.",
      },
      { status: 400 },
    );
  }
}
