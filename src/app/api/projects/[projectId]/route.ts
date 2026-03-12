export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteProject,
  updateProjectSettings,
} from "@/lib/server/repository";

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    repoSource: z.string().trim().min(1).max(500).optional(),
    executionMode: z.enum(["local_chatgpt", "hosted_api"]).optional(),
    researchProvider: z.enum(["codex_native", "openai_responses"]).optional(),
    plannerModel: z.string().max(120).nullable().optional(),
    executionModel: z.string().max(120).nullable().optional(),
    plannerReasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    executionReasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    symphonyMaxConcurrentAgents: z.number().int().min(1).max(8).optional(),
    symphonyMaxTurns: z.number().int().min(4).max(80).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one project setting must be provided.",
  });

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const project = await deleteProject(projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    projectId,
    slug: project.slug,
    name: project.name,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = updateProjectSchema.parse(await request.json());
    const project = updateProjectSettings(projectId, parsed);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      projectId,
      project,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update project.",
      },
      { status: 400 },
    );
  }
}
