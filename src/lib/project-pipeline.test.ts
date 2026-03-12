import {
  deployProfileMatchesDeploymentScope,
  deploymentTargetScopeNote,
  isPlanningOnlyDeploymentTarget,
  launchProfileMatchesDeploymentScope,
} from "@/lib/project-pipeline";

describe("project pipeline helpers", () => {
  it("marks AWS and Azure as cloud deployment targets with an operator note", () => {
    expect(isPlanningOnlyDeploymentTarget("aws")).toBe(true);
    expect(isPlanningOnlyDeploymentTarget("azure")).toBe(true);
    expect(isPlanningOnlyDeploymentTarget("local")).toBe(false);
    expect(deploymentTargetScopeNote("aws")).toContain("deploy.sh");
    expect(deploymentTargetScopeNote("local")).toBeNull();
  });

  it("matches launch profiles against the selected deployment scope", () => {
    expect(launchProfileMatchesDeploymentScope("web", ["local"])).toBe(true);
    expect(launchProfileMatchesDeploymentScope("docker", ["aws"])).toBe(false);
    expect(launchProfileMatchesDeploymentScope("ios_simulator", ["ios_testflight"])).toBe(true);
    expect(launchProfileMatchesDeploymentScope("ios_simulator", ["local"])).toBe(false);
  });

  it("matches deploy profiles only when they are in the selected deployment scope", () => {
    expect(deployProfileMatchesDeploymentScope("local", ["local", "aws"])).toBe(true);
    expect(deployProfileMatchesDeploymentScope("jetson", ["local", "aws"])).toBe(false);
  });
});
