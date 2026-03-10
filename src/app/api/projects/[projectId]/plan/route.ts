export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestApprovedPlan, getProjectSnapshot } from "@/lib/server/repository";

const planIngestSchema = z.object({
  planText: z.string().min(20).optional(),
  specFilename: z.string().min(1).max(240).optional(),
  planLabel: z.string().min(1).max(240).optional(),
  artifactId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const parsed = planIngestSchema.parse(await request.json().catch(() => ({})));
    const snapshot = getProjectSnapshot(projectId);

    if (!snapshot) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    let planText = parsed.planText;
    let specFilename = parsed.specFilename ?? "plan.md";

    if (!planText) {
      const artifact =
        snapshot.artifacts.find((item) => item.id === parsed.artifactId) ??
        snapshot.artifacts.find((item) => item.kind === "research-plan");

      if (!artifact) {
        throw new Error("No generated plan artifact is available to ingest.");
      }

      planText = await readFile(artifact.filePath, "utf8");
      specFilename = artifact.label.endsWith(".md") ? artifact.label : specFilename;
    }

    const result = await ingestApprovedPlan({
      projectId,
      specText: planText,
      specFilename,
      planLabel: parsed.planLabel ?? "Approved research plan",
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to ingest plan.",
      },
      { status: 400 },
    );
  }
}
