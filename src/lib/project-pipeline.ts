import { DEPLOYMENT_TARGETS } from "@/lib/constants";
import type {
  DeploymentTarget,
  ProjectLifecycleStage,
  ResearchProvider,
  WorkshopSearchMode,
} from "@/lib/types";

export function normalizeLifecycleStage(
  value: string | null | undefined,
): ProjectLifecycleStage {
  switch (value) {
    case "draft":
    case "workshop_active":
    case "research_ready":
    case "research_running":
    case "research_complete":
    case "plan_review":
    case "plan_ingested":
    case "execution_ready":
    case "executing":
    case "launch_ready":
    case "launch_running":
    case "launch_complete":
    case "deploy_ready":
    case "deploy_running":
    case "deployed":
    case "failed":
      return value;
    default:
      return "plan_ingested";
  }
}

export function normalizeResearchProvider(
  value: string | null | undefined,
): ResearchProvider {
  switch (value) {
    case "openai_responses":
      return value;
    default:
      return "codex_native";
  }
}

export function normalizeDeploymentTargets(
  value: string[] | null | undefined,
): DeploymentTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value.filter(
      (target): target is DeploymentTarget =>
        typeof target === "string" &&
        DEPLOYMENT_TARGETS.includes(target as DeploymentTarget),
    ),
  )];
}

export function deploymentTargetLabel(target: DeploymentTarget) {
  switch (target) {
    case "jetson":
      return "Jetson Orin";
    case "raspberry_pi":
      return "Raspberry Pi";
    case "ios_testflight":
      return "iOS TestFlight";
    case "ios_app_store":
      return "iOS App Store";
    case "aws":
      return "AWS";
    case "azure":
      return "Azure";
    default:
      return "Local";
  }
}

export function toggleDeploymentTargetSelection(
  selectedTargets: DeploymentTarget[],
  target: DeploymentTarget,
) {
  const selected = new Set(normalizeDeploymentTargets(selectedTargets));

  if (selected.has(target)) {
    if (selected.size === 1) {
      return DEPLOYMENT_TARGETS.filter((candidate) =>
        selected.has(candidate as DeploymentTarget),
      ) as DeploymentTarget[];
    }

    selected.delete(target);
  } else {
    selected.add(target);
  }

  return DEPLOYMENT_TARGETS.filter((candidate) =>
    selected.has(candidate as DeploymentTarget),
  ) as DeploymentTarget[];
}

export function normalizeWorkshopSearchMode(
  value: string | null | undefined,
): WorkshopSearchMode {
  switch (value) {
    case "live":
      return value;
    case "provider_fallback":
      return "live";
    default:
      return "cached";
  }
}

export function lifecycleDisplayLabel(stage: ProjectLifecycleStage) {
  switch (stage) {
    case "draft":
      return "Draft";
    case "workshop_active":
      return "Prompt workshop";
    case "research_ready":
      return "Ready for research";
    case "research_running":
      return "Research running";
    case "research_complete":
      return "Research complete";
    case "plan_review":
      return "Plan review";
    case "plan_ingested":
      return "Plan ingested";
    case "execution_ready":
      return "Ready to execute";
    case "executing":
      return "Executing";
    case "launch_ready":
      return "Ready to launch";
    case "launch_running":
      return "Launching";
    case "launch_complete":
      return "Launch complete";
    case "deploy_ready":
      return "Ready to deploy";
    case "deploy_running":
      return "Deploying";
    case "deployed":
      return "Deployed";
    case "failed":
      return "Needs attention";
  }
}

export function researchProviderLabel(provider: ResearchProvider) {
  switch (provider) {
    case "openai_responses":
      return "OpenAI Responses";
    default:
      return "Codex native";
  }
}
