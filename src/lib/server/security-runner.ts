import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendAuditEvent,
  getProjectSnapshot,
  reconcileFindingSource,
  resolveFindingSource,
  writeArtifact,
} from "@/lib/server/repository";
import { normalizeRepoSource } from "@/lib/server/runtime-config";
import { getProjectRoot, getProjectWorkspaceRoot, getWorkspaceRoot } from "@/lib/server/storage";
import type { FindingRecord, ProjectRecord } from "@/lib/types";

const GENERATED_FINDING_SOURCES = [
  "security-scan:committed-env-files",
  "security-scan:private-key-files",
  "security-scan:secret-patterns",
  "security-scan:semgrep",
  "security-scan:trivy",
  "security-scan:zap",
  "security-scan:verification-coverage",
] as const;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".overture",
  ".overture-e2e",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".env",
  ".go",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".cjs",
  ".kt",
  ".md",
  ".php",
  ".py",
  ".rb",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const PRIVATE_KEY_NAMES = new Set([
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

function hasMaterializedWorkspace(root: string) {
  if (!existsSync(root)) {
    return false;
  }

  try {
    return readdirSync(root).some((entry) => entry !== ".DS_Store");
  } catch {
    return false;
  }
}

function resolveScanRoot(project: ProjectRecord) {
  const workspaceRoot = getProjectWorkspaceRoot(project.slug);

  if (hasMaterializedWorkspace(workspaceRoot)) {
    return workspaceRoot;
  }

  const sourceRoot = normalizeRepoSource(project.repoSource);
  return existsSync(sourceRoot) ? sourceRoot : workspaceRoot;
}

function walkFiles(root: string, maxFiles = 5000) {
  const queue = [root];
  const files: string[] = [];
  let truncated = false;

  while (queue.length && files.length < maxFiles) {
    const current = queue.pop()!;
    let entries: ReturnType<typeof readdirSync>;

    try {
      entries = readdirSync(current, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;

      if (entry.name === ".DS_Store") {
        continue;
      }

      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        queue.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push(absolutePath);
      }

      if (files.length >= maxFiles) {
        truncated = index < entries.length - 1 || queue.length > 0;
        break;
      }
    }
  }

  return {
    files,
    truncated,
    maxFiles,
  };
}

function relativeFiles(root: string, files: string[]) {
  return files.map((filePath) => path.relative(root, filePath)).sort();
}

function fileLooksText(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  return path.basename(filePath).startsWith(".env");
}

function firstExistingFile(paths: string[]) {
  return paths.find((filePath) => existsSync(filePath)) ?? null;
}

function probableSecretMatches(root: string, files: string[]) {
  const results: Array<{ file: string; line: number; label: string }> = [];
  const patterns: Array<[RegExp, string]> = [
    [/(?:OPENAI|ANTHROPIC|ELEVENLABS|SUPABASE|STRIPE|SLACK|GITHUB|AZURE|AWS)[A-Z0-9_]*\s*=\s*['"]?[A-Za-z0-9_\/+\-=]{16,}/, "credential assignment"],
    [/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9]{16,}\b/, "OpenAI-style API key"],
    [/\bghp_[A-Za-z0-9]{20,}\b/, "GitHub personal access token"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub fine-grained token"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "private key block"],
  ];

  for (const filePath of files) {
    if (!fileLooksText(filePath)) {
      continue;
    }

    let content: string;

    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;

      for (const [pattern, label] of patterns) {
        if (!pattern.test(line)) {
          continue;
        }

        results.push({
          file: path.relative(root, filePath),
          line: index + 1,
          label,
        });
        break;
      }
    }
  }

  return results;
}

function committedEnvFiles(root: string, files: string[]) {
  return relativeFiles(
    root,
    files.filter((filePath) => {
      const basename = path.basename(filePath).toLowerCase();

      if (!basename.startsWith(".env")) {
        return false;
      }

      return ![
        ".env.example",
        ".env.sample",
        ".env.template",
        ".env.local.example",
        ".env.local.sample",
      ].includes(basename);
    }),
  );
}

function committedPrivateKeyFiles(root: string, files: string[]) {
  return relativeFiles(
    root,
    files.filter((filePath) => {
      const basename = path.basename(filePath);
      const extension = path.extname(filePath).toLowerCase();

      return (
        PRIVATE_KEY_NAMES.has(basename) ||
        [".key", ".pem", ".p12", ".pfx", ".mobileprovision"].includes(extension)
      );
    }),
  );
}

function preflightUrl(url: string | null) {
  if (!url) {
    return false;
  }

  try {
    const response = spawnSync("curl", ["-fsS", "-o", "/dev/null", url], {
      timeout: 15000,
      stdio: "ignore",
    });
    return response.status === 0;
  } catch {
    return false;
  }
}

function scriptResultStatus(result: ReturnType<typeof spawnSync>) {
  if (result.status === 0) {
    return "completed" as const;
  }

  if (result.status === 2) {
    return "skipped" as const;
  }

  return "failed" as const;
}

function runSecurityScript(input: {
  scriptName: "run-semgrep.sh" | "run-trivy.sh" | "run-zap.sh";
  outputDir: string;
  scanRoot: string;
  zapTargetUrl?: string | null;
}) {
  if (process.env.OVERTURE_SECURITY_SKIP_EXTERNAL === "1") {
    return {
      status: "skipped" as const,
      stdout: "",
      stderr: "",
      error: null,
      detail: "External security tools were skipped because OVERTURE_SECURITY_SKIP_EXTERNAL=1.",
    };
  }

  const scriptPath = path.join(getWorkspaceRoot(), "scripts", "security", input.scriptName);
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    OUTPUT_DIR: input.outputDir,
    SCAN_ROOT: input.scanRoot,
  } as NodeJS.ProcessEnv;

  if (input.zapTargetUrl) {
    env.ZAP_TARGET_URL = input.zapTargetUrl;
  }

  const result = spawnSync("bash", [scriptPath], {
    env,
    encoding: "utf8",
    timeout: input.scriptName === "run-zap.sh" ? 10 * 60_000 : 5 * 60_000,
  });

  return {
    status: scriptResultStatus(result),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
    detail: null,
  };
}

function coverageWarningForTool(input: {
  label: string;
  status: "completed" | "failed" | "skipped";
  error: string | null;
  stderr: string;
  detail: string | null;
}) {
  if (input.status === "completed") {
    return null;
  }

  const detail =
    input.detail ??
    input.error ??
    input.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ??
    "The tool did not finish successfully.";

  return `${input.label} ended as ${input.status}. ${detail}`;
}

function severityRank(severity: FindingRecord["severity"]) {
  switch (severity) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    default:
      return 1;
  }
}

function pickHigherSeverity(
  left: FindingRecord["severity"],
  right: FindingRecord["severity"],
): FindingRecord["severity"] {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function semgrepSeverity(value: unknown): FindingRecord["severity"] {
  const normalized = String(value ?? "").toLowerCase();

  switch (normalized) {
    case "error":
    case "critical":
      return "high";
    case "warning":
    case "medium":
      return "medium";
    case "info":
      return "low";
    default:
      return "medium";
  }
}

function parseSemgrepSummary(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      results?: Array<{
        path?: string;
        start?: { line?: number };
        check_id?: string;
        extra?: {
          severity?: string;
          message?: string;
        };
      }>;
    };
    const results = parsed.results ?? [];

    if (!results.length) {
      return {
        count: 0,
        severity: "low" as const,
        detail: "Semgrep completed without reporting any findings.",
      };
    }

    const highest = results.reduce<FindingRecord["severity"]>(
      (current, result) => pickHigherSeverity(current, semgrepSeverity(result.extra?.severity)),
      "low",
    );
    const preview = results
      .slice(0, 3)
      .map((result) => {
        const location = [
          result.path ?? "unknown file",
          typeof result.start?.line === "number" ? `:${result.start.line}` : "",
        ].join("");
        const message = result.extra?.message ?? result.check_id ?? "Semgrep finding";

        return `- ${location}: ${message}`;
      })
      .join("\n");

    return {
      count: results.length,
      severity: highest,
      detail: [`Semgrep reported ${results.length} issue(s).`, "", preview].join("\n"),
    };
  } catch (error) {
    return {
      count: 1,
      severity: "medium" as const,
      detail: `Semgrep output could not be parsed: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

function parseTrivySummary(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      Results?: Array<{
        Target?: string;
        Vulnerabilities?: Array<{ Severity?: string; Title?: string; VulnerabilityID?: string }>;
        Misconfigurations?: Array<{ Severity?: string; Title?: string; ID?: string }>;
        Secrets?: Array<{ Severity?: string; RuleID?: string; Title?: string }>;
      }>;
    };
    const results = parsed.Results ?? [];
    let count = 0;
    let highest: FindingRecord["severity"] = "low";
    const preview: string[] = [];

    for (const result of results) {
      const target = result.Target ?? "unknown target";
      const items = [
        ...(result.Vulnerabilities ?? []).map((item) => ({
          severity: semgrepSeverity(item.Severity),
          label: item.Title ?? item.VulnerabilityID ?? "Vulnerability",
        })),
        ...(result.Misconfigurations ?? []).map((item) => ({
          severity: semgrepSeverity(item.Severity),
          label: item.Title ?? item.ID ?? "Misconfiguration",
        })),
        ...(result.Secrets ?? []).map((item) => ({
          severity: semgrepSeverity(item.Severity),
          label: item.Title ?? item.RuleID ?? "Secret exposure",
        })),
      ];

      count += items.length;

      for (const item of items) {
        highest = pickHigherSeverity(highest, item.severity);

        if (preview.length < 3) {
          preview.push(`- ${target}: ${item.label}`);
        }
      }
    }

    if (!count) {
      return {
        count: 0,
        severity: "low" as const,
        detail: "Trivy completed without reporting any findings.",
      };
    }

    return {
      count,
      severity: highest,
      detail: [`Trivy reported ${count} issue(s).`, "", ...preview].join("\n"),
    };
  } catch (error) {
    return {
      count: 1,
      severity: "medium" as const,
      detail: `Trivy output could not be parsed: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

function parseZapSummary(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      site?: Array<{
        alerts?: Array<{
          riskcode?: string;
          alert?: string;
          name?: string;
        }>;
      }>;
    };
    const alerts = (parsed.site ?? []).flatMap((site) => site.alerts ?? []);

    if (!alerts.length) {
      return {
        count: 0,
        severity: "low" as const,
        detail: "ZAP completed without reporting any alerts.",
      };
    }

    let highest: FindingRecord["severity"] = "low";

    for (const alert of alerts) {
      const severity =
        alert.riskcode === "3"
          ? "high"
          : alert.riskcode === "2"
            ? "medium"
            : "low";
      highest = pickHigherSeverity(highest, severity);
    }

    return {
      count: alerts.length,
      severity: highest,
      detail: [
        `ZAP reported ${alerts.length} alert(s).`,
        "",
        ...alerts.slice(0, 3).map((alert) => `- ${alert.alert ?? alert.name ?? "ZAP alert"}`),
      ].join("\n"),
    };
  } catch (error) {
    return {
      count: 1,
      severity: "medium" as const,
      detail: `ZAP output could not be parsed: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

function latestHealthcheckUrl(project: ReturnType<typeof getProjectSnapshot>) {
  if (!project) {
    return null;
  }

  const deployProfilesById = new Map(project.deployProfiles.map((profile) => [profile.id, profile]));
  const latestDeployWithUrl = project.deployRuns.find((run) => {
    const profile = deployProfilesById.get(run.deployProfileId);
    return typeof profile?.metadata.healthcheckUrl === "string";
  });

  if (latestDeployWithUrl) {
    const profile = deployProfilesById.get(latestDeployWithUrl.deployProfileId);
    return typeof profile?.metadata.healthcheckUrl === "string"
      ? String(profile.metadata.healthcheckUrl)
      : null;
  }

  return (
    project.launchProfiles.find((profile) => typeof profile.healthcheckUrl === "string")
      ?.healthcheckUrl ?? null
  );
}

function reportLines(title: string, body: string[]) {
  return [`## ${title}`, "", ...body, ""];
}

export async function runProjectSecurityReview(input: { projectId: string }) {
  const snapshot = getProjectSnapshot(input.projectId);

  if (!snapshot) {
    throw new Error("Project not found.");
  }

  const scanRoot = resolveScanRoot(snapshot.project);

  if (!existsSync(scanRoot)) {
    throw new Error("No workspace or source directory is available for this project yet.");
  }

  const scanId = randomUUID();
  const scanOutputRoot = path.join(getProjectRoot(snapshot.project.slug), "security", scanId);
  mkdirSync(scanOutputRoot, { recursive: true });

  appendAuditEvent({
    projectId: snapshot.project.id,
    actor: "security",
    action: "security.scan_started",
    detail: "Started a project security review.",
    payload: {
      scanId,
      scanRoot,
    },
  });

  const fileWalk = walkFiles(scanRoot);
  const files = fileWalk.files;
  const envFiles = committedEnvFiles(scanRoot, files);
  const keyFiles = committedPrivateKeyFiles(scanRoot, files);
  const secretMatches = probableSecretMatches(scanRoot, files);
  const semgrepRun = runSecurityScript({
    scriptName: "run-semgrep.sh",
    outputDir: scanOutputRoot,
    scanRoot,
  });
  const trivyRun = runSecurityScript({
    scriptName: "run-trivy.sh",
    outputDir: scanOutputRoot,
    scanRoot,
  });
  const zapTargetUrl = latestHealthcheckUrl(snapshot);
  const zapRun =
    zapTargetUrl && preflightUrl(zapTargetUrl)
      ? runSecurityScript({
          scriptName: "run-zap.sh",
          outputDir: scanOutputRoot,
          scanRoot,
          zapTargetUrl,
        })
      : null;
  const coverageWarnings = [
    coverageWarningForTool({
      label: "Semgrep",
      status: semgrepRun.status,
      error: semgrepRun.error,
      stderr: semgrepRun.stderr,
      detail: semgrepRun.detail,
    }),
    coverageWarningForTool({
      label: "Trivy",
      status: trivyRun.status,
      error: trivyRun.error,
      stderr: trivyRun.stderr,
      detail: trivyRun.detail,
    }),
    zapRun
      ? coverageWarningForTool({
          label: "ZAP",
          status: zapRun.status,
          error: zapRun.error,
          stderr: zapRun.stderr,
          detail: zapRun.detail,
        })
      : null,
    fileWalk.truncated
      ? `Workspace heuristics sampled only the first ${fileWalk.maxFiles} files, so this review is partial for larger repositories.`
      : null,
  ].filter((warning): warning is string => Boolean(warning));
  const coverageComplete = coverageWarnings.length === 0;

  if (!coverageComplete) {
    reconcileFindingSource({
      projectId: snapshot.project.id,
      category: "security",
      source: "security-scan:verification-coverage",
      severity: "medium",
      title: "Security verification coverage is incomplete",
      detail: [
        "One or more security verification steps did not complete, so Overture cannot mark this security review fully verified yet.",
        "",
        ...coverageWarnings.map((warning) => `- ${warning}`),
      ].join("\n"),
      metadata: {
        scanId,
        coverageWarnings,
        coverageComplete,
        toolStatuses: {
          semgrep: semgrepRun.status,
          trivy: trivyRun.status,
          zap: zapRun?.status ?? (zapTargetUrl ? "skipped" : "not_requested"),
        },
        fileSampleTruncated: fileWalk.truncated,
        fileSampleLimit: fileWalk.maxFiles,
      },
    });
  } else {
    resolveFindingSource({
      projectId: snapshot.project.id,
      source: "security-scan:verification-coverage",
    });
  }

  if (envFiles.length) {
    reconcileFindingSource({
      projectId: snapshot.project.id,
      category: "security",
      source: "security-scan:committed-env-files",
      severity: "high",
      title: `Committed environment files detected (${envFiles.length})`,
      detail: [
        "Non-example environment files were found in the project workspace.",
        "",
        ...envFiles.slice(0, 8).map((filePath) => `- ${filePath}`),
      ].join("\n"),
      metadata: {
        scanId,
        files: envFiles,
      },
    });
  } else {
    resolveFindingSource({
      projectId: snapshot.project.id,
      source: "security-scan:committed-env-files",
    });
  }

  if (keyFiles.length) {
    reconcileFindingSource({
      projectId: snapshot.project.id,
      category: "security",
      source: "security-scan:private-key-files",
      severity: "critical",
      title: `Private key material detected (${keyFiles.length})`,
      detail: [
        "Files that look like private keys or signing credentials were found in the project workspace.",
        "",
        ...keyFiles.slice(0, 8).map((filePath) => `- ${filePath}`),
      ].join("\n"),
      metadata: {
        scanId,
        files: keyFiles,
      },
    });
  } else {
    resolveFindingSource({
      projectId: snapshot.project.id,
      source: "security-scan:private-key-files",
    });
  }

  if (secretMatches.length) {
    reconcileFindingSource({
      projectId: snapshot.project.id,
      category: "security",
      source: "security-scan:secret-patterns",
      severity: "critical",
      title: `Probable hard-coded secrets detected (${secretMatches.length})`,
      detail: [
        "The review found secret-like values or key material patterns in tracked files.",
        "",
        ...secretMatches
          .slice(0, 8)
          .map((match) => `- ${match.file}:${match.line} (${match.label})`),
      ].join("\n"),
      metadata: {
        scanId,
        matches: secretMatches,
      },
    });
  } else {
    resolveFindingSource({
      projectId: snapshot.project.id,
      source: "security-scan:secret-patterns",
    });
  }

  const semgrepSummary = parseSemgrepSummary(path.join(scanOutputRoot, "semgrep.json"));

  if (semgrepRun.status === "completed" && semgrepSummary?.count) {
    reconcileFindingSource({
      projectId: snapshot.project.id,
      category: "security",
      source: "security-scan:semgrep",
      severity: semgrepSummary.severity,
      title: `Semgrep reported ${semgrepSummary.count} issue(s)`,
      detail: semgrepSummary.detail,
      metadata: {
        scanId,
        count: semgrepSummary.count,
      },
    });
  } else if (semgrepRun.status === "completed") {
    resolveFindingSource({
      projectId: snapshot.project.id,
      source: "security-scan:semgrep",
    });
  }

  const trivySummary = parseTrivySummary(path.join(scanOutputRoot, "trivy.json"));

  if (trivyRun.status === "completed" && trivySummary?.count) {
    reconcileFindingSource({
      projectId: snapshot.project.id,
      category: "security",
      source: "security-scan:trivy",
      severity: trivySummary.severity,
      title: `Trivy reported ${trivySummary.count} issue(s)`,
      detail: trivySummary.detail,
      metadata: {
        scanId,
        count: trivySummary.count,
      },
    });
  } else if (trivyRun.status === "completed") {
    resolveFindingSource({
      projectId: snapshot.project.id,
      source: "security-scan:trivy",
    });
  }

  const zapSummary = parseZapSummary(path.join(scanOutputRoot, "zap-report.json"));

  if (zapRun?.status === "completed" && zapSummary?.count) {
    reconcileFindingSource({
      projectId: snapshot.project.id,
      category: "security",
      source: "security-scan:zap",
      severity: zapSummary.severity,
      title: `ZAP reported ${zapSummary.count} alert(s)`,
      detail: zapSummary.detail,
      metadata: {
        scanId,
        count: zapSummary.count,
        targetUrl: zapTargetUrl,
      },
    });
  } else if (zapRun?.status === "completed") {
    resolveFindingSource({
      projectId: snapshot.project.id,
      source: "security-scan:zap",
    });
  }

  const rawArtifactInputs = [
    {
      filePath: firstExistingFile([path.join(scanOutputRoot, "semgrep.json")]),
      kind: "security-scan-semgrep",
      label: "Semgrep scan results",
      mimeType: "application/json",
      extension: "json",
    },
    {
      filePath: firstExistingFile([path.join(scanOutputRoot, "trivy.json")]),
      kind: "security-scan-trivy",
      label: "Trivy scan results",
      mimeType: "application/json",
      extension: "json",
    },
    {
      filePath: firstExistingFile([path.join(scanOutputRoot, "zap-report.json")]),
      kind: "security-scan-zap",
      label: "ZAP scan results",
      mimeType: "application/json",
      extension: "json",
    },
  ];

  for (const artifactInput of rawArtifactInputs) {
    if (!artifactInput.filePath) {
      continue;
    }

    writeArtifact({
      projectId: snapshot.project.id,
      projectSlug: snapshot.project.slug,
      kind: artifactInput.kind,
      label: artifactInput.label,
      extension: artifactInput.extension,
      mimeType: artifactInput.mimeType,
      content: readFileSync(artifactInput.filePath, "utf8"),
      metadata: {
        scanId,
        scanRoot,
      },
    });
  }

  const report = [
    `# Security review for ${snapshot.project.name}`,
    "",
    `- Scan root: \`${scanRoot}\``,
    `- Files sampled: ${files.length}${fileWalk.truncated ? ` (truncated at ${fileWalk.maxFiles})` : ""}`,
    `- Scan id: \`${scanId}\``,
    "",
    ...reportLines("Workspace heuristics", [
      `- Committed env files: ${envFiles.length}`,
      `- Private key files: ${keyFiles.length}`,
      `- Probable secret matches: ${secretMatches.length}`,
    ]),
    ...reportLines("Tool execution", [
      `- Semgrep: ${semgrepRun.status}`,
      `- Trivy: ${trivyRun.status}`,
      `- ZAP: ${zapRun ? zapRun.status : zapTargetUrl ? "skipped (healthcheck unavailable)" : "skipped (no target url)"}`,
    ]),
  ];

  if (!coverageComplete) {
    report.push(...reportLines("Coverage warnings", coverageWarnings.map((warning) => `- ${warning}`)));
  }

  if (semgrepRun.error || trivyRun.error || zapRun?.error) {
    report.push(
      ...reportLines("Tool errors", [
        ...(semgrepRun.error ? [`- Semgrep: ${semgrepRun.error}`] : []),
        ...(trivyRun.error ? [`- Trivy: ${trivyRun.error}`] : []),
        ...(zapRun?.error ? [`- ZAP: ${zapRun.error}`] : []),
      ]),
    );
  }

  const activeGeneratedFindings = getProjectSnapshot(snapshot.project.id)?.findings.filter(
    (finding) =>
      GENERATED_FINDING_SOURCES.includes(finding.source as (typeof GENERATED_FINDING_SOURCES)[number]) &&
      !["resolved", "accepted_risk"].includes(finding.status),
  ) ?? [];
  const openGeneratedFindingLines = activeGeneratedFindings.length
    ? activeGeneratedFindings.map(
        (finding) => `- ${finding.severity.toUpperCase()} ${finding.title} (${finding.status})`,
      )
    : ["- None"];

  const reportArtifactId = writeArtifact({
    projectId: snapshot.project.id,
    projectSlug: snapshot.project.slug,
    kind: "security-report",
    label: "Security review report",
    extension: "md",
    mimeType: "text/markdown",
    content: [
      ...report,
      ...reportLines("Open generated findings", openGeneratedFindingLines),
    ].join("\n"),
    metadata: {
      scanId,
      scanRoot,
      generatedFindingCount: activeGeneratedFindings.length,
      coverageComplete,
      coverageWarnings,
      toolStatuses: {
        semgrep: semgrepRun.status,
        trivy: trivyRun.status,
        zap: zapRun?.status ?? (zapTargetUrl ? "skipped" : "not_requested"),
      },
      fileSampledCount: files.length,
      fileSampleLimit: fileWalk.maxFiles,
      fileSampleTruncated: fileWalk.truncated,
    },
  });

  const summary =
    activeGeneratedFindings.length > 0
      ? `Security review completed with ${activeGeneratedFindings.length} open finding(s).`
      : "Security review completed without open generated findings.";

  appendAuditEvent({
    projectId: snapshot.project.id,
    actor: "security",
    action: "security.scan_completed",
    detail: summary,
    payload: {
      scanId,
      reportArtifactId,
      generatedFindingCount: activeGeneratedFindings.length,
      semgrep: semgrepRun.status,
      trivy: trivyRun.status,
      zap: zapRun?.status ?? "skipped",
    },
  });

  return {
    scanId,
    reportArtifactId,
    summary,
  };
}
