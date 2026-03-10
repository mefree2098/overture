export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSettings, updateAppSettings } from "@/lib/server/app-settings";

const settingsPatchSchema = z.object({
  plannerModel: z.string().max(120).nullable().optional(),
  executionModel: z.string().max(120).nullable().optional(),
  plannerReasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  executionReasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  defaultResearchProvider: z
    .enum(["codex_native", "openai_responses", "tavily_mcp", "brave_mcp"])
    .optional(),
  defaultExecutionMode: z.enum(["local_chatgpt", "hosted_api"]).optional(),
  defaultRepoSource: z.string().min(1).max(500).optional(),
  defaultQaStrictness: z.number().int().min(1).max(5).optional(),
  defaultSecurityStrictness: z.number().int().min(1).max(5).optional(),
  symphonyMaxConcurrentAgents: z.number().int().min(1).max(8).optional(),
  symphonyMaxTurns: z.number().int().min(4).max(80).optional(),
});

export async function GET() {
  return NextResponse.json(getAppSettings());
}

export async function PATCH(request: Request) {
  try {
    const updates = settingsPatchSchema.parse(await request.json());
    return NextResponse.json(updateAppSettings(updates));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update settings.",
      },
      { status: 400 },
    );
  }
}
