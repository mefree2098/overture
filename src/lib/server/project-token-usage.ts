import { getDb } from "@/lib/server/db";
import { EMPTY_TOKEN_USAGE, hasTokenUsage, type TokenUsage } from "@/lib/token-usage";

function nowIso() {
  return new Date().toISOString();
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim()
      ? Math.max(0, Number(value) || 0)
      : 0;
}

export function hydrateStoredProjectTokenUsage(row: Record<string, unknown>): TokenUsage {
  return {
    inputTokens: asCount(row.cumulative_input_tokens),
    outputTokens: asCount(row.cumulative_output_tokens),
    totalTokens: asCount(row.cumulative_total_tokens),
  };
}

export function appendProjectTokenUsageBySlug(projectSlug: string, usage: TokenUsage) {
  if (!hasTokenUsage(usage)) {
    return EMPTY_TOKEN_USAGE;
  }

  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE projects
      SET
        cumulative_input_tokens = COALESCE(cumulative_input_tokens, 0) + ?,
        cumulative_output_tokens = COALESCE(cumulative_output_tokens, 0) + ?,
        cumulative_total_tokens = COALESCE(cumulative_total_tokens, 0) + ?,
        updated_at = ?,
        last_activity_at = ?
      WHERE slug = ?
    `,
  ).run(
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
    timestamp,
    timestamp,
    projectSlug,
  );

  const row = db
    .prepare("SELECT cumulative_input_tokens, cumulative_output_tokens, cumulative_total_tokens FROM projects WHERE slug = ?")
    .get(projectSlug) as Record<string, unknown> | undefined;

  return row ? hydrateStoredProjectTokenUsage(row) : EMPTY_TOKEN_USAGE;
}
