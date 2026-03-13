export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { runProjectLaunch, stopProjectLaunchProcess } from "@/lib/server/launch-runner";

const launchSchema = z.object({
  launchProfileId: z.string().uuid(),
});

const stopLaunchSchema = z.object({
  launchRunId: z.string().uuid(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = launchSchema.parse(await request.json());
    const result = await runProjectLaunch({
      projectId,
      launchProfileId: parsed.launchProfileId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run the launch profile.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = stopLaunchSchema.parse(await request.json());
    const result = await stopProjectLaunchProcess({
      projectId,
      launchRunId: parsed.launchRunId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to stop the launch process.",
      },
      { status: 400 },
    );
  }
}
