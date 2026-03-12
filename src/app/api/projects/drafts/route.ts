export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { createDraftProject } from "@/lib/server/repository";

const draftProjectSchema = z.object({
  name: z.string().min(2).max(120),
  repoSource: z.string().min(1).max(500),
  executionMode: z.enum(["local_chatgpt", "hosted_api"]),
  policyProfile: z
    .object({
      qaStrictness: z.number().min(1).max(5).optional(),
      securityStrictness: z.number().min(1).max(5).optional(),
      deploymentTargets: z
        .array(
          z.enum([
            "local",
            "jetson",
            "raspberry_pi",
            "azure",
            "aws",
            "ios_testflight",
            "ios_app_store",
          ]),
        )
        .optional(),
    })
    .optional(),
  sourceBriefText: z.string().min(20).nullable().optional(),
  sourceBriefFilename: z.string().min(1).max(240).nullable().optional(),
  researchProvider: z.enum(["codex_native", "openai_responses"]).optional(),
  plannerModel: z.string().max(120).nullable().optional(),
  executionModel: z.string().max(120).nullable().optional(),
  plannerReasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  executionReasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  symphonyMaxConcurrentAgents: z.number().int().min(1).max(8).optional(),
  symphonyMaxTurns: z.number().int().min(4).max(80).optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = draftProjectSchema.parse(await request.json());
    const project = createDraftProject(parsed);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create draft project.",
      },
      { status: 400 },
    );
  }
}
