export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { createFinding } from "@/lib/server/repository";

const createFindingSchema = z.object({
  category: z.enum(["qa", "security", "deploy"]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  title: z.string().trim().min(3).max(160),
  detail: z.string().trim().min(3).max(4000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = createFindingSchema.parse(await request.json());
    const findingId = createFinding({
      projectId,
      category: parsed.category,
      severity: parsed.severity,
      status: "open",
      title: parsed.title,
      detail: parsed.detail,
      source: "manual",
      metadata: {
        createdVia: "project-ui",
      },
    });

    return NextResponse.json(
      {
        ok: true,
        findingId,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create the finding.",
      },
      { status: 400 },
    );
  }
}
