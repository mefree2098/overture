export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const runnerPath = path.join(process.cwd(), "scripts", "runner.ts");

  const child = spawn(process.execPath, ["--import", "tsx", runnerPath, projectId], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  return NextResponse.json({
    ok: true,
    projectId,
  });
}
