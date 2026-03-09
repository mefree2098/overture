export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { createProjectFromSpec, listProjects } from "@/lib/server/repository";

const projectSchema = z.object({
  name: z.string().min(2).max(120),
  repoSource: z.string().min(1).max(500),
  executionMode: z.enum(["local_chatgpt", "hosted_api"]),
  policyProfile: z
    .object({
      qaStrictness: z.number().min(1).max(5).optional(),
      securityStrictness: z.number().min(1).max(5).optional(),
    })
    .optional(),
  plannerModel: z.string().max(120).nullable().optional(),
  executionModel: z.string().max(120).nullable().optional(),
  plannerReasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  symphonyMaxConcurrentAgents: z.number().int().min(1).max(8).optional(),
  symphonyMaxTurns: z.number().int().min(4).max(80).optional(),
  specFilename: z.string().min(1).max(240),
  specText: z.string().min(20),
});

export async function GET() {
  return NextResponse.json(listProjects());
}

export async function POST(request: Request) {
  try {
    const parsed = projectSchema.parse(await request.json());
    const project = await createProjectFromSpec(parsed);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create project.",
      },
      { status: 400 },
    );
  }
}
