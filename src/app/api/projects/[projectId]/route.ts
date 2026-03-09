export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appendAuditEvent,
  deleteProject,
  updateProjectName,
} from "@/lib/server/repository";

const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
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
    const project = updateProjectName(projectId, parsed.name);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    appendAuditEvent({
      projectId,
      actor: "control-plane",
      action: "project.renamed",
      detail: `Project renamed to ${project.name}.`,
      payload: {
        name: project.name,
      },
    });

    return NextResponse.json({
      ok: true,
      projectId,
      name: project.name,
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
