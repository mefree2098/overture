import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { normalizeRepoSource } from "@/lib/server/runtime-config";
import type {
  DeployProfileRecord,
  LaunchProfileRecord,
  ProjectRecord,
} from "@/lib/types";

type DraftLaunchProfile = Omit<
  LaunchProfileRecord,
  "id" | "projectId" | "createdAt" | "updatedAt"
>;
type DraftDeployProfile = Omit<
  DeployProfileRecord,
  "id" | "projectId" | "createdAt" | "updatedAt"
>;

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

function isExecutable(filePath: string) {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(commandName: string) {
  const pathValue = process.env.PATH ?? "";

  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .some((directory) => {
      const candidate = path.join(directory, commandName);
      return existsSync(candidate) && isExecutable(candidate);
    });
}

function defaultAzureSshPublicKeyPath() {
  const configured = process.env.AZURE_SSH_PUBLIC_KEY_FILE?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  const homeDirectory = homedir();
  const candidates = [
    path.join(homeDirectory, ".ssh", "id_ed25519.pub"),
    path.join(homeDirectory, ".ssh", "id_rsa.pub"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function configuredAwsRegion() {
  const explicit = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();

  if (explicit) {
    return explicit;
  }

  if (!commandExists("aws")) {
    return null;
  }

  const probe = spawnSync("aws", ["configure", "get", "region"], {
    encoding: "utf8",
    env: {
      ...process.env,
      AWS_PAGER: "",
    },
    timeout: 2000,
  });

  return probe.status === 0 ? probe.stdout?.trim() || null : null;
}

function cloudCommandSucceeds(command: string, args: string[]) {
  if (!commandExists(command)) {
    return false;
  }

  const probe = spawnSync(command, args, {
    stdio: "ignore",
    env: {
      ...process.env,
      AWS_PAGER: "",
    },
    timeout: 4000,
  });

  return probe.status === 0;
}

function dockerBuildxAvailable() {
  return cloudCommandSucceeds("docker", ["buildx", "version"]);
}

function awsCredentialsAvailable(region: string) {
  return cloudCommandSucceeds("aws", [
    "sts",
    "get-caller-identity",
    "--region",
    region,
    "--query",
    "Account",
    "-o",
    "text",
  ]);
}

function azureLoginAvailable() {
  return cloudCommandSucceeds("az", ["account", "show"]);
}

function cloudDeployAvailabilityIssues(target: DraftDeployProfile["target"]) {
  const issues: string[] = [];

  switch (target) {
    case "azure": {
      if (!process.env.OPENAI_API_KEY?.trim()) {
        issues.push("OPENAI_API_KEY must be present in the Overture process environment.");
      }

      if (!commandExists("az")) {
        issues.push("Azure CLI (`az`) was not found on PATH.");
      }

      if (!commandExists("curl")) {
        issues.push("curl is required because deploy.sh uses it for Azure health checks.");
      }

      if (!process.env.AZURE_RESOURCE_GROUP?.trim()) {
        issues.push("AZURE_RESOURCE_GROUP must be set before Overture can run the Azure deploy.");
      }

      if (commandExists("az") && !azureLoginAvailable()) {
        issues.push("Azure CLI is installed, but `az account show` did not find an active login.");
      }

      if (!defaultAzureSshPublicKeyPath()) {
        issues.push(
          "AZURE_SSH_PUBLIC_KEY_FILE or a default SSH public key under ~/.ssh is required.",
        );
      }

      return issues;
    }
    case "aws": {
      const region = configuredAwsRegion();

      if (!process.env.OPENAI_API_KEY?.trim()) {
        issues.push("OPENAI_API_KEY must be present in the Overture process environment.");
      }

      if (!commandExists("aws")) {
        issues.push("AWS CLI (`aws`) was not found on PATH.");
      }

      if (!commandExists("curl")) {
        issues.push("curl is required because deploy.sh uses it for AWS health checks.");
      }

      if (!commandExists("docker")) {
        issues.push("Docker CLI is required because the AWS deploy builds and pushes the image locally.");
      } else if (!dockerBuildxAvailable()) {
        issues.push("Docker buildx is required because the AWS deploy builds and pushes the image locally.");
      }

      if (!region) {
        issues.push("AWS region was not found in env vars or AWS CLI config.");
      } else if (commandExists("aws") && !awsCredentialsAvailable(region)) {
        issues.push(
          "AWS CLI is installed, but `aws sts get-caller-identity` did not find usable credentials.",
        );
      }

      return issues;
    }
    default:
      return issues;
  }
}

function readPackageJson(repoRoot: string) {
  const packageJsonPath = path.join(repoRoot, "package.json");

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function readEnvFile(repoRoot: string, fileName: string) {
  const filePath = path.join(repoRoot, fileName);

  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .reduce<Record<string, string>>((env, line) => {
        const separatorIndex = line.indexOf("=");
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

        if (key) {
          env[key] = value;
        }

        return env;
      }, {});
  } catch {
    return {};
  }
}

function detectPackageManager(repoRoot: string): PackageManager {
  if (existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (existsSync(path.join(repoRoot, "yarn.lock"))) {
    return "yarn";
  }

  if (existsSync(path.join(repoRoot, "bun.lock")) || existsSync(path.join(repoRoot, "bun.lockb"))) {
    return "bun";
  }

  return "npm";
}

function packageManagerScriptCommand(packageManager: PackageManager, scriptName: string) {
  switch (packageManager) {
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

function findXcodeContainer(repoRoot: string) {
  const entries = readdirSync(repoRoot);
  const workspace = entries.find((entry) => entry.endsWith(".xcworkspace"));

  if (workspace) {
    return {
      kind: "workspace" as const,
      path: workspace,
    };
  }

  const project = entries.find((entry) => entry.endsWith(".xcodeproj"));

  if (!project) {
    return null;
  }

  return {
    kind: "project" as const,
    path: project,
  };
}

function xcodebuildContainerArgs(container: { kind: "workspace" | "project"; path: string }) {
  if (container.kind === "workspace") {
    return `-workspace ${JSON.stringify(container.path)}`;
  }

  return `-project ${JSON.stringify(container.path)}`;
}

export function detectOperationalProfiles(project: ProjectRecord) {
  const repoRoot = normalizeRepoSource(project.repoSource);
  const packageJson = readPackageJson(repoRoot);
  const packageManager = detectPackageManager(repoRoot);
  const dockerComposeFile = ["docker-compose.yml", "compose.yml"].find((candidate) =>
    existsSync(path.join(repoRoot, candidate)),
  );
  const envConfig = {
    ...readEnvFile(repoRoot, ".env"),
    ...readEnvFile(repoRoot, ".env.example"),
  };
  const xcodeContainer = existsSync(repoRoot) ? findXcodeContainer(repoRoot) : null;
  const xcodeScheme = xcodeContainer
    ? path.basename(xcodeContainer.path, path.extname(xcodeContainer.path))
    : null;
  const deployScriptExists = existsSync(path.join(repoRoot, "deploy.sh"));
  const launchProfiles: DraftLaunchProfile[] = [];
  const deployProfiles: DraftDeployProfile[] = [];
  const scripts = packageJson?.scripts ?? {};
  const hasNextStyleApp = Boolean(
    packageJson?.dependencies?.next ||
      packageJson?.devDependencies?.vite ||
      packageJson?.dependencies?.react,
  );

  if (hasNextStyleApp && scripts.dev) {
    launchProfiles.push({
      target: "web",
      label: "Web app dev server",
      command: packageManagerScriptCommand(packageManager, "dev"),
      cwd: repoRoot,
      healthcheckUrl:
        envConfig.OVERTURE_LAUNCH_HEALTHCHECK_URL ||
        envConfig.OVERTURE_HEALTHCHECK_URL ||
        "http://127.0.0.1:3000",
      metadata: {
        source: "package.json",
        script: "dev",
      },
    });
  } else if (scripts.start) {
    launchProfiles.push({
      target: "api",
      label: "Application start command",
      command: packageManagerScriptCommand(packageManager, "start"),
      cwd: repoRoot,
      healthcheckUrl:
        envConfig.OVERTURE_LAUNCH_HEALTHCHECK_URL ||
        envConfig.OVERTURE_HEALTHCHECK_URL ||
        "http://127.0.0.1:3000",
      metadata: {
        source: "package.json",
        script: "start",
      },
    });
  }

  if (dockerComposeFile) {
    launchProfiles.push({
      target: "docker",
      label: "Docker Compose stack",
      command: "docker compose up -d --build",
      cwd: repoRoot,
      healthcheckUrl:
        envConfig.OVERTURE_DOCKER_HEALTHCHECK_URL ||
        envConfig.OVERTURE_DEPLOY_HEALTHCHECK_URL ||
        envConfig.OVERTURE_HEALTHCHECK_URL ||
        "http://host.docker.internal:3000/api/health",
      metadata: {
        file: dockerComposeFile,
      },
    });
  }

  if (xcodeContainer) {
    launchProfiles.push({
      target: "ios_simulator",
      label: "iOS Simulator",
      command: `xcodebuild ${xcodebuildContainerArgs(xcodeContainer)} -scheme ${JSON.stringify(
        xcodeScheme,
      )} -destination 'platform=iOS Simulator,name=iPhone 16' build`,
      cwd: repoRoot,
      healthcheckUrl: null,
      metadata: {
        xcodeContainer: xcodeContainer.path,
        xcodeContainerKind: xcodeContainer.kind,
      },
    });
  }

  if (deployScriptExists) {
    deployProfiles.push({
      target: "local",
      label: "Local container release",
      command: "bash deploy.sh local",
      cwd: repoRoot,
      approvalRequired: false,
      metadata: {
        script: "deploy.sh",
        healthcheckUrl:
          envConfig.OVERTURE_DEPLOY_HEALTHCHECK_URL ||
          envConfig.OVERTURE_HEALTHCHECK_URL ||
          "http://host.docker.internal:3000/api/health",
      },
    });
  } else if (dockerComposeFile) {
    deployProfiles.push({
      target: "local",
      label: "Local Docker Compose release",
      command: "docker compose up -d --build",
      cwd: repoRoot,
      approvalRequired: false,
      metadata: {
        file: dockerComposeFile,
        healthcheckUrl:
          envConfig.OVERTURE_DEPLOY_HEALTHCHECK_URL ||
          envConfig.OVERTURE_HEALTHCHECK_URL ||
          "http://host.docker.internal:3000/api/health",
      },
    });
  }

  const targetFiles: Array<
    [
      DraftDeployProfile["target"],
      string,
      string,
      string | null,
    ]
  > = [
    ["jetson", "infra/jetson/README.md", "Jetson Orin deployment", null],
    ["raspberry_pi", "infra/raspberry-pi/README.md", "Raspberry Pi deployment", null],
    [
      "azure",
      "infra/azure/main.bicep",
      "Azure VM deployment",
      envConfig.OVERTURE_AZURE_HEALTHCHECK_URL || envConfig.OVERTURE_AZURE_APP_URL || null,
    ],
    [
      "aws",
      "infra/aws/template.yaml",
      "AWS EC2 deployment",
      envConfig.OVERTURE_AWS_HEALTHCHECK_URL || envConfig.OVERTURE_AWS_APP_URL || null,
    ],
  ];

  for (const [target, relativePath, label, configuredHealthUrl] of targetFiles) {
    if (!deployScriptExists || !existsSync(path.join(repoRoot, relativePath))) {
      continue;
    }

    const availabilityIssues = cloudDeployAvailabilityIssues(target);

    deployProfiles.push({
      target,
      label,
      command: `bash deploy.sh ${target}`,
      cwd: repoRoot,
      approvalRequired: target !== "local",
      metadata: {
        source: relativePath,
        ...(configuredHealthUrl
          ? {
              healthcheckUrl: configuredHealthUrl.endsWith("/api/health")
                ? configuredHealthUrl
                : `${configuredHealthUrl.replace(/\/$/, "")}/api/health`,
            }
          : {}),
        ...(availabilityIssues.length
          ? {
              availability: "unavailable",
              unavailableReason: availabilityIssues.join(" "),
              prerequisiteIssues: availabilityIssues,
            }
          : {
              availability: "ready",
            }),
      },
    });
  }

  if (xcodeContainer) {
    deployProfiles.push({
      target: "ios_testflight",
      label: "iOS TestFlight upload",
      command: `xcodebuild ${xcodebuildContainerArgs(xcodeContainer)} -scheme ${JSON.stringify(
        xcodeScheme,
      )} archive`,
      cwd: repoRoot,
      approvalRequired: true,
      metadata: {
        xcodeContainer: xcodeContainer.path,
        xcodeContainerKind: xcodeContainer.kind,
      },
    });
    deployProfiles.push({
      target: "ios_app_store",
      label: "iOS App Store submission prep",
      command: `xcodebuild ${xcodebuildContainerArgs(xcodeContainer)} -scheme ${JSON.stringify(
        xcodeScheme,
      )} archive`,
      cwd: repoRoot,
      approvalRequired: true,
      metadata: {
        xcodeContainer: xcodeContainer.path,
        xcodeContainerKind: xcodeContainer.kind,
      },
    });
  }

  return {
    repoRoot,
    launchProfiles,
    deployProfiles,
  };
}
