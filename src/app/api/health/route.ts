export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getExecutionModeSupport, getCodexHome, resolveCodexBin } from "@/lib/server/runtime-config";

export async function GET() {
  const executionSupport = getExecutionModeSupport();

  return NextResponse.json({
    ok:
      executionSupport.codexCliAvailable &&
      (executionSupport.hostedApiAvailable || executionSupport.localChatgptAvailable),
    timestamp: new Date().toISOString(),
    codex: {
      bin: resolveCodexBin(),
      home: getCodexHome(),
      ...executionSupport,
    },
  });
}
