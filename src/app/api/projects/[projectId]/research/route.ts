export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { runProjectResearch } from "@/lib/server/research-runner";

const researchSchema = z.object({
  searchMode: z.enum(["cached", "live"]).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = researchSchema.parse(await request.json().catch(() => ({})));
    const result = await runProjectResearch({
      projectId,
      searchMode: parsed.searchMode,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run deep research.",
      },
      { status: 400 },
    );
  }
}
