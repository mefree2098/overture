export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { runProjectDeployment } from "@/lib/server/deploy-runner";

const deploySchema = z.object({
  deployProfileId: z.string().uuid(),
  confirmed: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = deploySchema.parse(await request.json());
    const result = await runProjectDeployment({
      projectId,
      deployProfileId: parsed.deployProfileId,
      confirmed: parsed.confirmed,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run the deployment profile.",
      },
      { status: 400 },
    );
  }
}
