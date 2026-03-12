import { DEPLOYMENT_TARGETS } from "@/lib/constants";
import { deploymentTargetLabel } from "@/lib/project-pipeline";
import type {
  DeployProfileRecord,
  DeployRunRecord,
  DeploymentTarget,
  GateVerdict,
  LaunchProfileRecord,
  LaunchRunRecord,
} from "@/lib/types";

export interface OperationalProofRow {
  target: DeploymentTarget;
  label: string;
  profiles: GateVerdict;
  launch: GateVerdict;
  deploy: GateVerdict;
  health: GateVerdict;
  perf: GateVerdict;
}

function latestRun<T extends { startedAt: string }>(runs: T[]) {
  return [...runs].sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
  )[0] ?? null;
}

function verdictFromRunStatus(
  status: LaunchRunRecord["status"] | DeployRunRecord["status"],
): GateVerdict {
  switch (status) {
    case "completed":
      return "pass";
    case "failed":
      return "fail";
    case "running":
      return "partial";
    default:
      return "pending";
  }
}

function hasDeployHealthcheck(profile: DeployProfileRecord) {
  return (
    typeof profile.metadata.healthcheckUrl === "string" && profile.metadata.healthcheckUrl.trim()
  );
}

export function buildOperationalProofRows(input: {
  projectDeploymentTargets: DeploymentTarget[];
  launchProfiles: LaunchProfileRecord[];
  launchRuns: LaunchRunRecord[];
  deployProfiles: DeployProfileRecord[];
  deployRuns: DeployRunRecord[];
}): OperationalProofRow[] {
  const launchProfilesById = new Map(input.launchProfiles.map((profile) => [profile.id, profile]));
  const targetSet = new Set<DeploymentTarget>(input.projectDeploymentTargets);

  if (input.launchProfiles.length || input.launchRuns.length) {
    targetSet.add("local");
  }

  for (const profile of input.deployProfiles) {
    targetSet.add(profile.target);
  }

  return DEPLOYMENT_TARGETS.filter((target) => targetSet.has(target)).map((target) => {
    const configured = input.projectDeploymentTargets.includes(target);
    const targetLaunchProfiles = target === "local" ? input.launchProfiles : [];
    const targetLaunchRuns =
      target === "local"
        ? input.launchRuns.filter((run) => launchProfilesById.has(run.launchProfileId))
        : [];
    const targetDeployProfiles = input.deployProfiles.filter((profile) => profile.target === target);
    const targetDeployProfileIds = new Set(targetDeployProfiles.map((profile) => profile.id));
    const targetDeployRuns = input.deployRuns.filter((run) =>
      targetDeployProfileIds.has(run.deployProfileId),
    );
    const hasLaunchHealthcheckProfile =
      target === "local" && targetLaunchProfiles.some((profile) => profile.healthcheckUrl);
    const hasDeployHealthcheckProfile = targetDeployProfiles.some(hasDeployHealthcheck);
    const latestLaunch = latestRun(targetLaunchRuns);
    const latestDeploy = latestRun(targetDeployRuns);
    const launchHealthRuns = hasLaunchHealthcheckProfile ? targetLaunchRuns : [];
    const deployHealthRuns = hasDeployHealthcheckProfile ? targetDeployRuns : [];
    const latestHealthRun = latestRun([...launchHealthRuns, ...deployHealthRuns]);
    const profiles =
      targetLaunchProfiles.length || targetDeployProfiles.length
        ? "pass"
        : configured
          ? "partial"
          : "waived";
    const launch =
      target !== "local"
        ? "waived"
        : latestLaunch
          ? verdictFromRunStatus(latestLaunch.status)
          : targetLaunchProfiles.length
            ? "pending"
            : configured && !targetDeployProfiles.length
              ? "partial"
              : "waived";
    const deploy = latestDeploy
      ? verdictFromRunStatus(latestDeploy.status)
      : targetDeployProfiles.length
        ? "pending"
        : configured
          ? "partial"
          : "waived";
    const health = latestHealthRun
      ? verdictFromRunStatus(latestHealthRun.status)
      : hasLaunchHealthcheckProfile || hasDeployHealthcheckProfile
        ? "pending"
        : "waived";

    return {
      target,
      label: deploymentTargetLabel(target),
      profiles,
      launch,
      deploy,
      health,
      perf: "waived",
    };
  });
}
