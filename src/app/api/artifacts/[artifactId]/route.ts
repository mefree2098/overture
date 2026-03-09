export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getPlatformRoot } from "@/lib/server/storage";
import { getArtifactById, resolveArtifactPath } from "@/lib/server/repository";

function sanitiseTextContent(content: string) {
  return content.replaceAll(path.join(getPlatformRoot(), "workspaces") + "/", "");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await context.params;
  const artifact = getArtifactById(artifactId);

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
  }

  try {
    const content = await readFile(resolveArtifactPath(artifact.filePath));
    const body = artifact.mimeType.startsWith("text/")
      ? sanitiseTextContent(content.toString("utf8"))
      : content;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": artifact.mimeType,
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${artifact.label.replace(/[^a-z0-9.-]+/gi, "-")}"`,
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Attempted to access a path outside the allowed root."
    ) {
      return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
    }

    console.error("Failed to stream artifact", error);
    return NextResponse.json(
      { error: "Artifact could not be loaded." },
      { status: 500 },
    );
  }
}
