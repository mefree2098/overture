import { DEFAULT_APP_SETTINGS } from "@/lib/constants";
import { normalizeCodexReasoningEffort } from "@/lib/codex-reasoning";
import { normalizeDeploymentTargets, normalizeResearchProvider } from "@/lib/project-pipeline";
import {
  assertExecutionModeAvailable,
  assertResearchProviderAvailable,
} from "@/lib/server/runtime-config";
import { getDb } from "@/lib/server/db";
import type { AppSettingsRecord, ExecutionMode } from "@/lib/types";

const SETTINGS_ROW_ID = "default";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeOptionalModel(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeExecutionMode(value: string | null | undefined): ExecutionMode {
  return value === "hosted_api" ? "hosted_api" : "local_chatgpt";
}

function parseDeploymentTargets(value: unknown) {
  if (Array.isArray(value)) {
    return normalizeDeploymentTargets(value);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    return normalizeDeploymentTargets(JSON.parse(value) as string[]);
  } catch {
    return [];
  }
}

function envOverrideExecutionMode() {
  const configured = process.env.OVERTURE_DEFAULT_EXECUTION_MODE?.trim();
  return configured ? normalizeExecutionMode(configured) : null;
}

export function getExecutionModeEnvOverride() {
  return envOverrideExecutionMode();
}

function hydrateSettings(row: Record<string, unknown>): AppSettingsRecord {
  return {
    plannerModel: sanitizeOptionalModel(row.planner_model as string | null | undefined),
    executionModel: sanitizeOptionalModel(row.execution_model as string | null | undefined),
    plannerReasoningEffort: normalizeCodexReasoningEffort(
      row.planner_reasoning_effort as string | null | undefined,
    ),
    executionReasoningEffort: normalizeCodexReasoningEffort(
      row.execution_reasoning_effort as string | null | undefined,
    ),
    defaultResearchProvider: normalizeResearchProvider(
      row.default_research_provider as string | null | undefined,
    ),
    defaultExecutionMode: normalizeExecutionMode(
      envOverrideExecutionMode() ?? (row.default_execution_mode as string | null | undefined),
    ),
    defaultRepoSource:
      String(row.default_repo_source ?? DEFAULT_APP_SETTINGS.defaultRepoSource).trim() || ".",
    defaultQaStrictness: clamp(
      Number(row.default_qa_strictness ?? DEFAULT_APP_SETTINGS.defaultQaStrictness),
      1,
      5,
    ),
    defaultSecurityStrictness: clamp(
      Number(
        row.default_security_strictness ?? DEFAULT_APP_SETTINGS.defaultSecurityStrictness,
      ),
      1,
      5,
    ),
    defaultDeploymentTargets: (() => {
      const normalized = parseDeploymentTargets(
        row.default_deployment_targets_json ??
          JSON.stringify(DEFAULT_APP_SETTINGS.defaultDeploymentTargets),
      );

      return normalized.length
        ? normalized
        : [...DEFAULT_APP_SETTINGS.defaultDeploymentTargets];
    })(),
    symphonyMaxConcurrentAgents: clamp(
      Number(
        row.symphony_max_concurrent_agents ??
          DEFAULT_APP_SETTINGS.symphonyMaxConcurrentAgents,
      ),
      1,
      8,
    ),
    symphonyMaxTurns: clamp(
      Number(row.symphony_max_turns ?? DEFAULT_APP_SETTINGS.symphonyMaxTurns),
      4,
      80,
    ),
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
    defaults: DEFAULT_APP_SETTINGS,
  };
}

function ensureRow() {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM app_settings WHERE id = ?")
    .get(SETTINGS_ROW_ID) as Record<string, unknown> | undefined;

  if (existing) {
    return hydrateSettings(existing);
  }

  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO app_settings (
        id,
        planner_model,
        execution_model,
        planner_reasoning_effort,
        execution_reasoning_effort,
        default_research_provider,
        default_execution_mode,
        default_repo_source,
        default_qa_strictness,
        default_security_strictness,
        default_deployment_targets_json,
        symphony_max_concurrent_agents,
        symphony_max_turns,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    SETTINGS_ROW_ID,
    DEFAULT_APP_SETTINGS.plannerModel,
    DEFAULT_APP_SETTINGS.executionModel,
    DEFAULT_APP_SETTINGS.plannerReasoningEffort,
    DEFAULT_APP_SETTINGS.executionReasoningEffort,
    DEFAULT_APP_SETTINGS.defaultResearchProvider,
    DEFAULT_APP_SETTINGS.defaultExecutionMode,
    DEFAULT_APP_SETTINGS.defaultRepoSource,
    DEFAULT_APP_SETTINGS.defaultQaStrictness,
    DEFAULT_APP_SETTINGS.defaultSecurityStrictness,
    JSON.stringify(DEFAULT_APP_SETTINGS.defaultDeploymentTargets),
    DEFAULT_APP_SETTINGS.symphonyMaxConcurrentAgents,
    DEFAULT_APP_SETTINGS.symphonyMaxTurns,
    timestamp,
    timestamp,
  );

  return hydrateSettings(
    db.prepare("SELECT * FROM app_settings WHERE id = ?").get(SETTINGS_ROW_ID) as Record<
      string,
      unknown
    >,
  );
}

export function getAppSettings() {
  return ensureRow();
}

export function updateAppSettings(
  updates: Partial<
    Omit<AppSettingsRecord, "createdAt" | "updatedAt" | "defaults">
  >,
) {
  const current = ensureRow();
  const db = getDb();
  const next = {
    plannerModel: sanitizeOptionalModel(updates.plannerModel ?? current.plannerModel),
    executionModel: sanitizeOptionalModel(updates.executionModel ?? current.executionModel),
    plannerReasoningEffort: normalizeCodexReasoningEffort(
      updates.plannerReasoningEffort ?? current.plannerReasoningEffort,
    ),
    executionReasoningEffort: normalizeCodexReasoningEffort(
      updates.executionReasoningEffort ?? current.executionReasoningEffort,
    ),
    defaultResearchProvider: normalizeResearchProvider(
      updates.defaultResearchProvider ?? current.defaultResearchProvider,
    ),
    defaultExecutionMode: normalizeExecutionMode(
      updates.defaultExecutionMode ?? current.defaultExecutionMode,
    ),
    defaultRepoSource:
      String(updates.defaultRepoSource ?? current.defaultRepoSource).trim() || ".",
    defaultQaStrictness: clamp(
      Number(updates.defaultQaStrictness ?? current.defaultQaStrictness),
      1,
      5,
    ),
    defaultSecurityStrictness: clamp(
      Number(updates.defaultSecurityStrictness ?? current.defaultSecurityStrictness),
      1,
      5,
    ),
    defaultDeploymentTargets: (() => {
      const normalized = normalizeDeploymentTargets(
        updates.defaultDeploymentTargets ?? current.defaultDeploymentTargets,
      );

      return normalized.length
        ? normalized
        : [...DEFAULT_APP_SETTINGS.defaultDeploymentTargets];
    })(),
    symphonyMaxConcurrentAgents: clamp(
      Number(
        updates.symphonyMaxConcurrentAgents ?? current.symphonyMaxConcurrentAgents,
      ),
      1,
      8,
    ),
    symphonyMaxTurns: clamp(
      Number(updates.symphonyMaxTurns ?? current.symphonyMaxTurns),
      4,
      80,
    ),
  } satisfies Omit<AppSettingsRecord, "createdAt" | "updatedAt" | "defaults">;

  if (updates.defaultExecutionMode !== undefined) {
    assertExecutionModeAvailable(next.defaultExecutionMode);
  }

  if (updates.defaultResearchProvider !== undefined) {
    assertResearchProviderAvailable(next.defaultResearchProvider);
  }

  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE app_settings
      SET
        planner_model = ?,
        execution_model = ?,
        planner_reasoning_effort = ?,
        execution_reasoning_effort = ?,
        default_research_provider = ?,
        default_execution_mode = ?,
        default_repo_source = ?,
        default_qa_strictness = ?,
        default_security_strictness = ?,
        default_deployment_targets_json = ?,
        symphony_max_concurrent_agents = ?,
        symphony_max_turns = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(
    next.plannerModel,
    next.executionModel,
    next.plannerReasoningEffort,
    next.executionReasoningEffort,
    next.defaultResearchProvider,
    next.defaultExecutionMode,
    next.defaultRepoSource,
    next.defaultQaStrictness,
    next.defaultSecurityStrictness,
    JSON.stringify(next.defaultDeploymentTargets),
    next.symphonyMaxConcurrentAgents,
    next.symphonyMaxTurns,
    timestamp,
    SETTINGS_ROW_ID,
  );

  return getAppSettings();
}
