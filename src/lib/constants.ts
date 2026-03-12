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

export const PROJECT_LIFECYCLE_STAGES = [
  "draft",
  "workshop_active",
  "research_ready",
  "research_running",
  "research_complete",
  "plan_review",
  "plan_ingested",
  "execution_ready",
  "executing",
  "launch_ready",
  "launch_running",
  "launch_complete",
  "deploy_ready",
  "deploy_running",
  "deployed",
  "failed",
] as const;

export const RESEARCH_PROVIDERS = [
  "codex_native",
  "openai_responses",
] as const;

export const LAUNCH_TARGETS = ["web", "api", "docker", "ios_simulator"] as const;

export const DEPLOYMENT_TARGETS = [
  "local",
  "jetson",
  "raspberry_pi",
  "azure",
  "aws",
  "ios_testflight",
  "ios_app_store",
] as const;
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
  deploymentTargets: ["local"],
} satisfies {
  qaStrictness: number;
  securityStrictness: number;
  deploymentTargets: Array<(typeof DEPLOYMENT_TARGETS)[number]>;
};

export const DEFAULT_APP_SETTINGS = {
  plannerModel: null,
  executionModel: null,
  plannerReasoningEffort: "low",
  executionReasoningEffort: "medium",
  defaultResearchProvider: "codex_native",
  defaultExecutionMode: "local_chatgpt",
  defaultRepoSource: ".",
  defaultQaStrictness: 4,
  defaultSecurityStrictness: 4,
  defaultDeploymentTargets: ["local"],
  symphonyMaxConcurrentAgents: 5,
  symphonyMaxTurns: 24,
} as const;
