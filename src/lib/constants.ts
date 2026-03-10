export const GATE_NAMES = ["qa", "security", "deploy", "release"] as const;

export const WORK_ITEM_TYPES = [
  "spec",
  "design",
  "implement",
  "qa",
  "security",
  "deploy",
  "docs",
  "release",
  "triage",
] as const;

export const WORK_ITEM_STATUSES = [
  "queued",
  "in_progress",
  "blocked",
  "awaiting_review",
  "verifying",
  "failed",
  "done",
  "waived",
] as const;

export const FINDING_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

export const FINDING_STATUSES = [
  "open",
  "fix_in_progress",
  "fixed_pending_recheck",
  "accepted_risk",
  "resolved",
] as const;

export const RUN_PHASES = [
  "preparing_workspace",
  "building_prompt",
  "streaming",
  "verifying",
  "completed",
  "failed",
] as const;

export const DEPLOYMENT_TARGETS = ["local", "jetson", "azure", "aws"] as const;
export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export const TRACKER_STATE_NAMES = [
  "Todo",
  "In Progress",
  "Review",
  "Blocked",
  "Done",
] as const;

export const DEFAULT_POLICY_PROFILE = {
  qaStrictness: 4,
  securityStrictness: 4,
  deploymentTargets: [...DEPLOYMENT_TARGETS],
};

export const DEFAULT_APP_SETTINGS = {
  plannerModel: null,
  executionModel: null,
  plannerReasoningEffort: "low",
  executionReasoningEffort: "medium",
  defaultExecutionMode: "local_chatgpt",
  defaultRepoSource: ".",
  defaultQaStrictness: 4,
  defaultSecurityStrictness: 4,
  symphonyMaxConcurrentAgents: 5,
  symphonyMaxTurns: 24,
} as const;
