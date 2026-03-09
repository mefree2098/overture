export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { executeTrackerQuery } from "@/lib/server/tracker-schema";

function getTokenRole(request: Request): "symphony" | "control" | "anonymous" {
  const header = request.headers.get("authorization");
  const token = header?.replace(/^Bearer\s+/i, "");

  if (token && token === process.env.CONTROL_PLANE_TRACKER_TOKEN) {
    return "control";
  }

  if (token && token === process.env.SYMPHONY_TRACKER_TOKEN) {
    return "symphony";
  }

  return "anonymous";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: string;
      variables?: Record<string, unknown>;
    };

    if (!body.query) {
      return NextResponse.json({ errors: [{ message: "Missing GraphQL query." }] }, { status: 400 });
    }

    const result = await executeTrackerQuery({
      query: body.query,
      variables: body.variables,
      tokenRole: getTokenRole(request),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        errors: [
          {
            message: error instanceof Error ? error.message : "Tracker query failed.",
          },
        ],
      },
      { status: 400 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "POST GraphQL queries to this endpoint.",
  });
}
