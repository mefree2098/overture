import type { AppSettingsRecord } from "@/lib/types";

export type EditableAppSettings = Omit<AppSettingsRecord, "createdAt" | "updatedAt" | "defaults">;
export type EditableAppSettingsPatch = Partial<EditableAppSettings>;

function normalizeOptionalModel(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRepoSource(value: string) {
  const trimmed = value.trim();
  return trimmed || ".";
}

function arraysEqual<T>(left: T[], right: T[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function editableAppSettingsFromRecord(record: EditableAppSettings) {
  return {
    plannerModel: normalizeOptionalModel(record.plannerModel),
    executionModel: normalizeOptionalModel(record.executionModel),
    plannerReasoningEffort: record.plannerReasoningEffort,
    executionReasoningEffort: record.executionReasoningEffort,
    defaultResearchProvider: record.defaultResearchProvider,
    defaultExecutionMode: record.defaultExecutionMode,
    defaultRepoSource: normalizeRepoSource(record.defaultRepoSource),
    defaultQaStrictness: record.defaultQaStrictness,
    defaultSecurityStrictness: record.defaultSecurityStrictness,
    defaultDeploymentTargets: [...record.defaultDeploymentTargets],
    symphonyMaxConcurrentAgents: record.symphonyMaxConcurrentAgents,
    symphonyMaxTurns: record.symphonyMaxTurns,
  } satisfies EditableAppSettings;
}

export function buildAppSettingsPatch(input: {
  baseline: EditableAppSettings;
  current: EditableAppSettings;
  executionModeLocked?: boolean;
}) {
  const baseline = editableAppSettingsFromRecord(input.baseline);
  const current = editableAppSettingsFromRecord(input.current);
  const patch: EditableAppSettingsPatch = {};

  if (current.plannerModel !== baseline.plannerModel) {
    patch.plannerModel = current.plannerModel;
  }

  if (current.executionModel !== baseline.executionModel) {
    patch.executionModel = current.executionModel;
  }

  if (current.plannerReasoningEffort !== baseline.plannerReasoningEffort) {
    patch.plannerReasoningEffort = current.plannerReasoningEffort;
  }

  if (current.executionReasoningEffort !== baseline.executionReasoningEffort) {
    patch.executionReasoningEffort = current.executionReasoningEffort;
  }

  if (current.defaultResearchProvider !== baseline.defaultResearchProvider) {
    patch.defaultResearchProvider = current.defaultResearchProvider;
  }

  if (!input.executionModeLocked && current.defaultExecutionMode !== baseline.defaultExecutionMode) {
    patch.defaultExecutionMode = current.defaultExecutionMode;
  }

  if (current.defaultRepoSource !== baseline.defaultRepoSource) {
    patch.defaultRepoSource = current.defaultRepoSource;
  }

  if (current.defaultQaStrictness !== baseline.defaultQaStrictness) {
    patch.defaultQaStrictness = current.defaultQaStrictness;
  }

  if (current.defaultSecurityStrictness !== baseline.defaultSecurityStrictness) {
    patch.defaultSecurityStrictness = current.defaultSecurityStrictness;
  }

  if (!arraysEqual(current.defaultDeploymentTargets, baseline.defaultDeploymentTargets)) {
    patch.defaultDeploymentTargets = current.defaultDeploymentTargets;
  }

  if (current.symphonyMaxConcurrentAgents !== baseline.symphonyMaxConcurrentAgents) {
    patch.symphonyMaxConcurrentAgents = current.symphonyMaxConcurrentAgents;
  }

  if (current.symphonyMaxTurns !== baseline.symphonyMaxTurns) {
    patch.symphonyMaxTurns = current.symphonyMaxTurns;
  }

  return patch;
}
