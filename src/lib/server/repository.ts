import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_POLICY_PROFILE } from "@/lib/constants";
import { normalizeCodexReasoningEffort } from "@/lib/codex-reasoning";
import {
  normalizeDeploymentTargets,
  normalizeLifecycleStage,
  normalizeResearchProvider,
  normalizeWorkshopSearchMode,
} from "@/lib/project-pipeline";
import { hasTokenUsage, maxTokenUsage, parseTokenUsage, subtractTokenUsage } from "@/lib/token-usage";
import { getAppSettings } from "@/lib/server/app-settings";
import { getDb } from "@/lib/server/db";
import { detectOperationalProfiles } from "@/lib/server/launch-profiles";
import { buildSpecIrWithLlm } from "@/lib/server/llm-planner";
import { generatePlanFromSpec } from "@/lib/server/plan-generator";
import {
  appendProjectTokenUsageBySlug,
  hydrateStoredProjectTokenUsage,
} from "@/lib/server/project-token-usage";
import { normalizeRepoSource } from "@/lib/server/runtime-config";
import { getContentHash } from "@/lib/server/spec-parser";
import { stopSymphonyForProject } from "@/lib/server/symphony-manager";
import {
  assertWithinRoot,
  getArtifactsRoot,
  getProjectArtifactsRoot,
  getProjectPaths,
  getProjectRoot,
  getProjectWorkspaceRoot,
} from "@/lib/server/storage";
import type {
  ArtifactRecord,
  AuditEventRecord,
  CreateDraftProjectInput,
  CreateProjectInput,
  DeployProfileRecord,
  DeployRunRecord,
  DependencyEdgeRecord,
  FindingRecord,
  GateStatusRecord,
  LaunchProfileRecord,
  LaunchRunRecord,
  PlanVersionRecord,
  ProjectRecord,
  ProjectSnapshot,
  ProjectSummary,
  ProjectLifecycleStage,
  ResearchRunRecord,
  RunRecord,
  SpecDocumentRecord,
  TrackerIssue,
  WorkItemRecord,
  WorkItemStatus,
  WorkshopMessageRecord,
  WorkshopThreadRecord,
} from "@/lib/types";
import { rewriteSummaryForProjectName, slugify, tryParseJson } from "@/lib/utils";

function nowIso() {
  return new Date().toISOString();
}

function serialise(value: unknown) {
  return JSON.stringify(value);
}

function sanitizeOptionalModel(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeExecutionMode(value: string | null | undefined): ProjectRecord["executionMode"] {
  return value === "hosted_api" ? "hosted_api" : "local_chatgpt";
}

function sanitizeBranchSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function uniqueTrackerLabels(workItem: WorkItemRecord) {
  return [
    workItem.type,
    typeof workItem.metadata.lane === "string" ? String(workItem.metadata.lane) : null,
  ]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index) as string[];
}

function hydrateProjectWorkItems(projectId: string) {
  const db = getDb();

  return db
    .prepare("SELECT * FROM work_items WHERE project_id = ? ORDER BY sort_order ASC")
    .all(projectId)
    .map((row) => hydrateWorkItem(row as Record<string, unknown>));
}

function hydrateProjectDependencies(projectId: string) {
  const db = getDb();

  return db
    .prepare("SELECT * FROM dependency_edges WHERE project_id = ?")
    .all(projectId)
    .map((row) => hydrateDependency(row as Record<string, unknown>));
}

function isTerminalWorkItemStatus(status: WorkItemStatus) {
  return status === "done" || status === "waived";
}

function workItemLane(workItem: WorkItemRecord) {
  return typeof workItem.metadata.lane === "string" ? String(workItem.metadata.lane) : null;
}

function shouldAutoAdvanceWorkItem(workItem: WorkItemRecord) {
  return workItemLane(workItem) === "epic";
}

function resolveGateSnapshot(
  workItems: WorkItemRecord[],
  findings: FindingRecord[],
  artifacts: ArtifactRecord[],
) {
  const hasOpenSecurityFinding = findings.some(
    (finding) =>
      finding.category === "security" &&
      ["critical", "high"].includes(finding.severity) &&
      !["resolved", "accepted_risk"].includes(finding.status),
  );
  const hasOpenQaFinding = findings.some(
    (finding) =>
      finding.category === "qa" &&
      !["resolved", "accepted_risk"].includes(finding.status),
  );
  const hasOpenDeployFinding = findings.some(
    (finding) =>
      finding.category === "deploy" &&
      !["resolved", "accepted_risk"].includes(finding.status),
  );
  const qaTasksComplete = workItems
    .filter((workItem) => workItem.type === "qa")
    .every((workItem) => isTerminalWorkItemStatus(workItem.status));
  const securityTasksComplete = workItems
    .filter((workItem) => workItem.type === "security")
    .every((workItem) => isTerminalWorkItemStatus(workItem.status));
  const deployTasksComplete = workItems
    .filter((workItem) => workItem.type === "deploy")
    .every((workItem) => isTerminalWorkItemStatus(workItem.status));
  const allTasksComplete = workItems.every((workItem) => isTerminalWorkItemStatus(workItem.status));

  const qaStatus = hasOpenQaFinding ? "fail" : qaTasksComplete ? "pass" : "pending";
  const securityStatus = hasOpenSecurityFinding
    ? "fail"
    : securityTasksComplete
      ? "pass"
      : "pending";
  const deployStatus = hasOpenDeployFinding
    ? "fail"
    : deployTasksComplete ||
        artifacts.some((artifact) =>
          ["deploy-plan", "deployment-report", "deployment-log"].includes(artifact.kind),
        )
      ? "pass"
      : "pending";
  const releaseStatus =
    qaStatus === "pass" &&
    securityStatus === "pass" &&
    deployStatus === "pass" &&
    allTasksComplete
      ? "pass"
      : hasOpenSecurityFinding || hasOpenQaFinding || hasOpenDeployFinding
        ? "fail"
        : "pending";

  return {
    qaStatus,
    securityStatus,
    deployStatus,
    releaseStatus,
    hasOpenQaFinding,
    hasOpenSecurityFinding,
    hasOpenDeployFinding,
  } satisfies Pick<
    GateStatusRecord,
    "qaStatus" | "securityStatus" | "deployStatus" | "releaseStatus"
  > & {
    hasOpenQaFinding: boolean;
    hasOpenSecurityFinding: boolean;
    hasOpenDeployFinding: boolean;
  };
}

function hydrateProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    repoSource: String(row.repo_source),
    executionMode: row.execution_mode as ProjectRecord["executionMode"],
    lifecycleStage: normalizeLifecycleStage(
      row.lifecycle_stage as string | null | undefined,
    ),
    researchProvider: normalizeResearchProvider(
      row.research_provider as string | null | undefined,
    ),
    plannerModel:
      typeof row.planner_model === "string" && row.planner_model.trim()
        ? row.planner_model
        : null,
    executionModel:
      typeof row.execution_model === "string" && row.execution_model.trim()
        ? row.execution_model
        : null,
    plannerReasoningEffort:
      normalizeCodexReasoningEffort(
        row.planner_reasoning_effort as string | null | undefined,
      ),
    executionReasoningEffort:
      normalizeCodexReasoningEffort(
        row.execution_reasoning_effort as string | null | undefined,
      ),
    symphonyMaxConcurrentAgents: Number(row.symphony_max_concurrent_agents ?? 5),
    symphonyMaxTurns: Number(row.symphony_max_turns ?? 24),
    status: String(row.status),
    health: row.health as ProjectRecord["health"],
    qaStrictness: Number(row.qa_strictness),
    securityStrictness: Number(row.security_strictness),
    deploymentTargets: normalizeDeploymentTargets(
      tryParseJson<string[]>(row.deployment_targets_json as string),
    ),
    cumulativeTokenUsage: hydrateStoredProjectTokenUsage(row),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastActivityAt: String(row.last_activity_at),
  };
}

function hydrateSpecDocument(row: Record<string, unknown>): SpecDocumentRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    filename: String(row.filename),
    contentHash: String(row.content_hash),
    metadata: tryParseJson(row.metadata_json as string),
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

function hydratePlanVersion(row: Record<string, unknown>): PlanVersionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    specDocumentId: String(row.spec_document_id),
    label: String(row.label),
    status: String(row.status),
    summary: tryParseJson(row.summary_json as string),
    specIr: tryParseJson(row.spec_ir_json as string),
    review: tryParseJson(row.review_json as string),
    createdAt: String(row.created_at),
  };
}

function normalizePlanVersionSummary(
  projectName: string,
  planVersion: PlanVersionRecord | null,
) {
  if (!planVersion) {
    return null;
  }

  const nextSpecSummary = rewriteSummaryForProjectName(
    planVersion.specIr.summary,
    projectName,
  );
  const nextPlanSummary =
    typeof planVersion.summary.summary === "string"
      ? rewriteSummaryForProjectName(planVersion.summary.summary, projectName)
      : planVersion.summary.summary;

  return {
    ...planVersion,
    summary: {
      ...planVersion.summary,
      ...(typeof nextPlanSummary === "string" ? { summary: nextPlanSummary } : {}),
    },
    specIr: {
      ...planVersion.specIr,
      summary: nextSpecSummary,
    },
  } satisfies PlanVersionRecord;
}

function hydrateWorkItem(row: Record<string, unknown>): WorkItemRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    planVersionId: String(row.plan_version_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    key: String(row.key),
    title: String(row.title),
    description: String(row.description),
    type: row.type as WorkItemRecord["type"],
    status: row.status as WorkItemStatus,
    priority: Number(row.priority),
    sortOrder: Number(row.sort_order),
    acceptanceCriteria: tryParseJson(row.acceptance_criteria_json as string),
    metadata: tryParseJson(row.metadata_json as string),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function hydrateDependency(row: Record<string, unknown>): DependencyEdgeRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    fromWorkItemId: String(row.from_work_item_id),
    toWorkItemId: String(row.to_work_item_id),
    kind: String(row.kind),
  };
}

function hydrateRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    workItemId: String(row.work_item_id),
    status: String(row.status),
    phase: row.phase as RunRecord["phase"],
    runnerType: String(row.runner_type),
    threadId: row.thread_id ? String(row.thread_id) : null,
    workspacePath: String(row.workspace_path),
    logPath: String(row.log_path),
    summary: String(row.summary),
    metadata: tryParseJson(row.metadata_json as string),
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function hydrateArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    workItemId: row.work_item_id ? String(row.work_item_id) : null,
    runId: row.run_id ? String(row.run_id) : null,
    kind: String(row.kind),
    label: String(row.label),
    filePath: String(row.file_path),
    mimeType: String(row.mime_type),
    metadata: tryParseJson(row.metadata_json as string),
    createdAt: String(row.created_at),
  };
}

function hydrateFinding(row: Record<string, unknown>): FindingRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    workItemId: row.work_item_id ? String(row.work_item_id) : null,
    runId: row.run_id ? String(row.run_id) : null,
    category: row.category as FindingRecord["category"],
    severity: row.severity as FindingRecord["severity"],
    status: row.status as FindingRecord["status"],
    title: String(row.title),
    detail: String(row.detail),
    source: String(row.source),
    metadata: tryParseJson(row.metadata_json as string),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function hydrateAudit(row: Record<string, unknown>): AuditEventRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    workItemId: row.work_item_id ? String(row.work_item_id) : null,
    runId: row.run_id ? String(row.run_id) : null,
    actor: String(row.actor),
    action: String(row.action),
    detail: String(row.detail),
    payload: tryParseJson(row.payload_json as string),
    createdAt: String(row.created_at),
  };
}

function hydrateGateStatus(row: Record<string, unknown> | undefined): GateStatusRecord {
  if (!row) {
    return {
      projectId: "",
      qaStatus: "pending",
      securityStatus: "pending",
      deployStatus: "pending",
      releaseStatus: "pending",
      summary: {},
      updatedAt: nowIso(),
    };
  }

  return {
    projectId: String(row.project_id),
    qaStatus: row.qa_status as GateStatusRecord["qaStatus"],
    securityStatus: row.security_status as GateStatusRecord["securityStatus"],
    deployStatus: row.deploy_status as GateStatusRecord["deployStatus"],
    releaseStatus: row.release_status as GateStatusRecord["releaseStatus"],
    summary: tryParseJson(row.summary_json as string),
    updatedAt: String(row.updated_at),
  };
}

function hydrateWorkshopThread(row: Record<string, unknown>): WorkshopThreadRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    codexThreadId: String(row.codex_thread_id),
    title: typeof row.title === "string" ? row.title : null,
    status: row.status === "archived" ? "archived" : "active",
    searchMode: normalizeWorkshopSearchMode(
      row.search_mode as string | null | undefined,
    ),
    promptDraft: String(row.prompt_draft ?? ""),
    summary: String(row.summary ?? ""),
    repoContext: typeof row.repo_context === "string" ? row.repo_context : null,
    metadata: tryParseJson(row.metadata_json as string),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function hydrateWorkshopMessage(row: Record<string, unknown>): WorkshopMessageRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    workshopThreadId: String(row.workshop_thread_id),
    role:
      row.role === "assistant" || row.role === "system" ? row.role : "user",
    content: String(row.content ?? ""),
    metadata: tryParseJson(row.metadata_json as string),
    createdAt: String(row.created_at),
  };
}

function hydrateResearchRun(row: Record<string, unknown>): ResearchRunRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    provider: normalizeResearchProvider(
      row.provider as string | null | undefined,
    ),
    status:
      row.status === "running" ||
      row.status === "completed" ||
      row.status === "failed"
        ? row.status
        : "queued",
    searchMode: normalizeWorkshopSearchMode(
      row.search_mode as string | null | undefined,
    ),
    promptArtifactId: typeof row.prompt_artifact_id === "string" ? row.prompt_artifact_id : null,
    reportArtifactId:
      typeof row.report_artifact_id === "string" ? row.report_artifact_id : null,
    planArtifactId: typeof row.plan_artifact_id === "string" ? row.plan_artifact_id : null,
    citationsArtifactId:
      typeof row.citations_artifact_id === "string" ? row.citations_artifact_id : null,
    summaryArtifactId:
      typeof row.summary_artifact_id === "string" ? row.summary_artifact_id : null,
    summary: String(row.summary ?? ""),
    metadata: tryParseJson(row.metadata_json as string),
    startedAt: String(row.started_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

function hydrateLaunchProfile(row: Record<string, unknown>): LaunchProfileRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    target:
      row.target === "api" || row.target === "docker" || row.target === "ios_simulator"
        ? row.target
        : "web",
    label: String(row.label),
    command: String(row.command),
    cwd: String(row.cwd),
    healthcheckUrl:
      typeof row.healthcheck_url === "string" ? row.healthcheck_url : null,
    metadata: tryParseJson(row.metadata_json as string),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function hydrateLaunchRun(row: Record<string, unknown>): LaunchRunRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    launchProfileId: String(row.launch_profile_id),
    status:
      row.status === "running" ||
      row.status === "completed" ||
      row.status === "failed"
        ? row.status
        : "queued",
    summary: String(row.summary ?? ""),
    logPath: String(row.log_path ?? ""),
    metadata: tryParseJson(row.metadata_json as string),
    startedAt: String(row.started_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

function hydrateDeployProfile(row: Record<string, unknown>): DeployProfileRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    target:
      row.target === "jetson" ||
      row.target === "raspberry_pi" ||
      row.target === "azure" ||
      row.target === "aws" ||
      row.target === "ios_testflight" ||
      row.target === "ios_app_store"
        ? row.target
        : "local",
    label: String(row.label),
    command: String(row.command),
    cwd: String(row.cwd),
    approvalRequired: Boolean(row.approval_required),
    metadata: tryParseJson(row.metadata_json as string),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function hydrateDeployRun(row: Record<string, unknown>): DeployRunRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    deployProfileId: String(row.deploy_profile_id),
    status:
      row.status === "running" ||
      row.status === "completed" ||
      row.status === "failed"
        ? row.status
        : "queued",
    summary: String(row.summary ?? ""),
    logPath: String(row.log_path ?? ""),
    metadata: tryParseJson(row.metadata_json as string),
    startedAt: String(row.started_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

function countWorkItems(workItems: WorkItemRecord[]) {
  const counts: ProjectSummary["counts"] = {
    queued: 0,
    in_progress: 0,
    blocked: 0,
    awaiting_review: 0,
    verifying: 0,
    failed: 0,
    done: 0,
    waived: 0,
  };

  for (const workItem of workItems) {
    counts[workItem.status] += 1;
  }

  return counts;
}

function computeCurrentMilestone(workItems: WorkItemRecord[]) {
  return (
    workItems.find(
      (workItem) =>
        workItem.metadata.lane === "milestone" &&
        workItem.status !== "done" &&
        workItem.status !== "waived",
    )?.title ?? null
  );
}

function computeProjectHealth(
  gateStatus: GateStatusRecord,
  counts: ProjectSummary["counts"],
) {
  if (
    gateStatus.securityStatus === "fail" ||
    gateStatus.releaseStatus === "fail" ||
    counts.failed > 0
  ) {
    return "blocked" as const;
  }

  if (
    gateStatus.qaStatus === "fail" ||
    gateStatus.deployStatus === "fail"
  ) {
    return "at_risk" as const;
  }

  const runnableCount =
    counts.queued + counts.in_progress + counts.awaiting_review + counts.verifying;
  const terminalCount = counts.done + counts.waived;

  if (counts.blocked > 0 && runnableCount === 0 && terminalCount === 0) {
    return "blocked" as const;
  }

  if (counts.blocked > 0 && runnableCount === 0 && terminalCount > 0) {
    return "at_risk" as const;
  }

  return "on_track" as const;
}

export function appendAuditEvent(input: {
  projectId: string;
  workItemId?: string | null;
  runId?: string | null;
  actor: string;
  action: string;
  detail: string;
  payload?: Record<string, unknown>;
}) {
  const db = getDb();
  db.prepare(
    `
      INSERT INTO audit_events (
        id, project_id, work_item_id, run_id, actor, action, detail, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    randomUUID(),
    input.projectId,
    input.workItemId ?? null,
    input.runId ?? null,
    input.actor,
    input.action,
    input.detail,
    serialise(input.payload ?? {}),
    nowIso(),
  );
}

export function writeArtifact(input: {
  projectId: string;
  projectSlug: string;
  workItemId?: string | null;
  runId?: string | null;
  kind: string;
  label: string;
  extension: string;
  mimeType: string;
  content: string | Buffer;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const artifactId = randomUUID();
  const projectArtifactsRoot = getProjectArtifactsRoot(input.projectSlug);
  const fileName = `${artifactId}.${input.extension.replace(/^\./, "")}`;
  const filePath = path.join(projectArtifactsRoot, fileName);
  if (typeof input.content === "string") {
    writeFileSync(filePath, input.content, "utf8");
  } else {
    writeFileSync(filePath, input.content);
  }

  db.prepare(
    `
      INSERT INTO artifacts (
        id, project_id, work_item_id, run_id, kind, label, file_path, mime_type, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    artifactId,
    input.projectId,
    input.workItemId ?? null,
    input.runId ?? null,
    input.kind,
    input.label,
    filePath,
    input.mimeType,
    serialise(input.metadata ?? {}),
    nowIso(),
  );

  return artifactId;
}

export function createFinding(input: {
  projectId: string;
  workItemId?: string | null;
  runId?: string | null;
  category: FindingRecord["category"];
  severity: FindingRecord["severity"];
  status: FindingRecord["status"];
  title: string;
  detail: string;
  source: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();
  const id = randomUUID();

  db.prepare(
    `
      INSERT INTO findings (
        id, project_id, work_item_id, run_id, category, severity, status, title, detail, source, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    input.projectId,
    input.workItemId ?? null,
    input.runId ?? null,
    input.category,
    input.severity,
    input.status,
    input.title,
    input.detail,
    input.source,
    serialise(input.metadata ?? {}),
    timestamp,
    timestamp,
  );

  return id;
}

export function recomputeGateStatuses(projectId: string) {
  const db = getDb();
  const workItems = hydrateProjectWorkItems(projectId);
  const findings = db
    .prepare("SELECT * FROM findings WHERE project_id = ?")
    .all(projectId)
    .map((row) => hydrateFinding(row as Record<string, unknown>));
  const artifacts = db
    .prepare("SELECT * FROM artifacts WHERE project_id = ?")
    .all(projectId)
    .map((row) => hydrateArtifact(row as Record<string, unknown>));

  const {
    qaStatus,
    securityStatus,
    deployStatus,
    releaseStatus,
  } = resolveGateSnapshot(workItems, findings, artifacts);
  const summary = {
    openFindings: findings.filter(
      (finding) => !["resolved", "accepted_risk"].includes(finding.status),
    ).length,
    artifacts: artifacts.length,
    completeTasks: workItems.filter((workItem) =>
      ["done", "waived"].includes(workItem.status),
    ).length,
    totalTasks: workItems.length,
  };

  db.prepare(
    `
      INSERT INTO gate_statuses (project_id, qa_status, security_status, deploy_status, release_status, summary_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        qa_status = excluded.qa_status,
        security_status = excluded.security_status,
        deploy_status = excluded.deploy_status,
        release_status = excluded.release_status,
        summary_json = excluded.summary_json,
        updated_at = excluded.updated_at
    `,
  ).run(
    projectId,
    qaStatus,
    securityStatus,
    deployStatus,
    releaseStatus,
    serialise(summary),
    nowIso(),
  );

  return hydrateGateStatus(
    db.prepare("SELECT * FROM gate_statuses WHERE project_id = ?").get(
      projectId,
    ) as Record<string, unknown>,
  );
}

function autoCloseReviewedWorkItems(projectId: string) {
  const db = getDb();
  const workItems = hydrateProjectWorkItems(projectId);
  const dependencies = hydrateProjectDependencies(projectId);
  const findings = db
    .prepare("SELECT * FROM findings WHERE project_id = ?")
    .all(projectId)
    .map((row) => hydrateFinding(row as Record<string, unknown>));
  const artifacts = db
    .prepare("SELECT * FROM artifacts WHERE project_id = ?")
    .all(projectId)
    .map((row) => hydrateArtifact(row as Record<string, unknown>));
  const workItemsById = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const updateStatus = db.prepare(
    "UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?",
  );
  let changed = false;

  for (const workItem of workItems) {
    if (workItem.status !== "awaiting_review") {
      continue;
    }

    const blockers = dependencies
      .filter((edge) => edge.toWorkItemId === workItem.id)
      .map((edge) => workItemsById.get(edge.fromWorkItemId))
      .filter(Boolean) as WorkItemRecord[];

    if (!blockers.every((blocker) => isTerminalWorkItemStatus(blocker.status))) {
      continue;
    }

    if (workItem.type === "release") {
      const otherWorkItems = workItems.filter((candidate) => candidate.id !== workItem.id);
      const gates = resolveGateSnapshot(otherWorkItems, findings, artifacts);
      const otherTasksComplete = otherWorkItems.every((candidate) =>
        isTerminalWorkItemStatus(candidate.status),
      );

      if (
        !otherTasksComplete ||
        gates.qaStatus !== "pass" ||
        gates.securityStatus !== "pass" ||
        gates.deployStatus !== "pass"
      ) {
        continue;
      }
    }

    updateStatus.run("done", nowIso(), workItem.id);
    appendAuditEvent({
      projectId,
      workItemId: workItem.id,
      actor: "control-plane",
      action: "issue.auto.closed",
      detail: `${workItem.key} passed review and was closed by Overture gate enforcement.`,
    });
    changed = true;
  }

  return changed;
}

function settleProjectState(projectId: string) {
  let changed = false;

  for (let index = 0; index < 6; index += 1) {
    const advanced = advanceQueuedWorkItems(projectId);
    const closed = autoCloseReviewedWorkItems(projectId);
    recomputeGateStatuses(projectId);

    if (!advanced && !closed) {
      break;
    }

    changed = true;
  }

  return changed;
}

function nextProjectSlug(db: ReturnType<typeof getDb>, name: string, projectId: string) {
  const slugBase = slugify(name) || `project-${projectId.slice(0, 8)}`;
  let slug = slugBase;
  let counter = 2;

  while (db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug)) {
    slug = `${slugBase}-${counter++}`;
  }

  return slug;
}

function resolveProjectDefaults(
  input:
    | CreateDraftProjectInput
    | CreateProjectInput,
  appSettings = getAppSettings(),
) {
  const plannerModel =
    input.plannerModel === undefined
      ? appSettings.plannerModel
      : input.plannerModel?.trim() || null;
  const executionModel =
    input.executionModel === undefined
      ? appSettings.executionModel
      : input.executionModel?.trim() || null;

  return {
    repoSource: normalizeRepoSource(input.repoSource),
    researchProvider:
      input.researchProvider ?? appSettings.defaultResearchProvider,
    plannerModel,
    executionModel,
    plannerReasoningEffort:
      input.plannerReasoningEffort ?? appSettings.plannerReasoningEffort,
    executionReasoningEffort:
      input.executionReasoningEffort ?? appSettings.executionReasoningEffort,
    symphonyMaxConcurrentAgents:
      input.symphonyMaxConcurrentAgents ?? appSettings.symphonyMaxConcurrentAgents,
    symphonyMaxTurns: input.symphonyMaxTurns ?? appSettings.symphonyMaxTurns,
  };
}

function resolvePolicyProfile(
  input: Pick<CreateDraftProjectInput | CreateProjectInput, "policyProfile">,
  appSettings = getAppSettings(),
) {
  const deploymentTargets = normalizeDeploymentTargets(
    input.policyProfile?.deploymentTargets,
  );

  return {
    ...DEFAULT_POLICY_PROFILE,
    qaStrictness: clamp(
      Number(input.policyProfile?.qaStrictness ?? appSettings.defaultQaStrictness),
      1,
      5,
    ),
    securityStrictness: clamp(
      Number(
        input.policyProfile?.securityStrictness ?? appSettings.defaultSecurityStrictness,
      ),
      1,
      5,
    ),
    deploymentTargets: deploymentTargets.length
      ? deploymentTargets
      : DEFAULT_POLICY_PROFILE.deploymentTargets,
  };
}

function insertProjectRecord(input: {
  id: string;
  slug: string;
  name: string;
  repoSource: string;
  executionMode: ProjectRecord["executionMode"];
  lifecycleStage: ProjectLifecycleStage;
  researchProvider: ProjectRecord["researchProvider"];
  plannerModel: string | null;
  executionModel: string | null;
  plannerReasoningEffort: ProjectRecord["plannerReasoningEffort"];
  executionReasoningEffort: ProjectRecord["executionReasoningEffort"];
  qaStrictness: number;
  securityStrictness: number;
  deploymentTargets: ProjectRecord["deploymentTargets"];
  symphonyMaxConcurrentAgents: number;
  symphonyMaxTurns: number;
  timestamp: string;
}) {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO projects (
        id, slug, name, repo_source, execution_mode, lifecycle_stage, research_provider, planner_model, execution_model, planner_reasoning_effort, execution_reasoning_effort, symphony_max_concurrent_agents, symphony_max_turns, status, health, qa_strictness, security_strictness, deployment_targets_json, cumulative_input_tokens, cumulative_output_tokens, cumulative_total_tokens, created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.id,
    input.slug,
    input.name,
    input.repoSource,
    input.executionMode,
    input.lifecycleStage,
    input.researchProvider,
    input.plannerModel,
    input.executionModel,
    input.plannerReasoningEffort,
    input.executionReasoningEffort,
    input.symphonyMaxConcurrentAgents,
    input.symphonyMaxTurns,
    input.lifecycleStage === "draft" ? "draft" : "planned",
    "on_track",
    input.qaStrictness,
    input.securityStrictness,
    serialise(input.deploymentTargets),
    0,
    0,
    0,
    input.timestamp,
    input.timestamp,
    input.timestamp,
  );
}

export function setProjectLifecycleStage(
  projectId: string,
  lifecycleStage: ProjectLifecycleStage,
) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE projects
      SET lifecycle_stage = ?, status = ?, updated_at = ?, last_activity_at = ?
      WHERE id = ?
    `,
  ).run(
    lifecycleStage,
    lifecycleStage,
    timestamp,
    timestamp,
    projectId,
  );
}

export function createDraftProject(input: CreateDraftProjectInput) {
  const db = getDb();
  const appSettings = getAppSettings();
  const timestamp = nowIso();
  const projectId = randomUUID();
  const slug = nextProjectSlug(db, input.name, projectId);
  const defaults = resolveProjectDefaults(input, appSettings);
  const policyProfile = resolvePolicyProfile(input, appSettings);

  insertProjectRecord({
    id: projectId,
    slug,
    name: input.name.trim(),
    repoSource: defaults.repoSource,
    executionMode: input.executionMode,
    lifecycleStage: "draft",
    researchProvider: defaults.researchProvider,
    plannerModel: defaults.plannerModel,
    executionModel: defaults.executionModel,
    plannerReasoningEffort: defaults.plannerReasoningEffort,
    executionReasoningEffort: defaults.executionReasoningEffort,
    qaStrictness: policyProfile.qaStrictness,
    securityStrictness: policyProfile.securityStrictness,
    deploymentTargets: policyProfile.deploymentTargets,
    symphonyMaxConcurrentAgents: defaults.symphonyMaxConcurrentAgents,
    symphonyMaxTurns: defaults.symphonyMaxTurns,
    timestamp,
  });

  appendAuditEvent({
    projectId,
    actor: "system",
    action: "project.draft_created",
    detail: `Created draft project ${input.name.trim()}.`,
    payload: {
      slug,
      researchProvider: defaults.researchProvider,
      plannerModel: defaults.plannerModel,
      executionModel: defaults.executionModel,
      qaStrictness: policyProfile.qaStrictness,
      securityStrictness: policyProfile.securityStrictness,
      deploymentTargets: policyProfile.deploymentTargets,
    },
  });

  if (input.sourceBriefText?.trim()) {
    const sourceBriefFilename = input.sourceBriefFilename?.trim() || "source-brief.md";
    const extension =
      path.extname(sourceBriefFilename).replace(/^\./, "").trim() || "md";

    writeArtifact({
      projectId,
      projectSlug: slug,
      kind: "source-brief",
      label: sourceBriefFilename,
      extension,
      mimeType: "text/markdown",
      content: input.sourceBriefText.trim(),
      metadata: {
        filename: sourceBriefFilename,
        lifecycleStage: "draft",
      },
    });

    appendAuditEvent({
      projectId,
      actor: "system",
      action: "project.source_brief_stored",
      detail: `Stored source brief ${sourceBriefFilename} for guided planning.`,
    });
  }

  return {
    projectId,
    slug,
  };
}

export function getLatestWorkshopThread(projectId: string) {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM workshop_threads WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1",
    )
    .get(projectId) as Record<string, unknown> | undefined;

  return row ? hydrateWorkshopThread(row) : null;
}

export function createWorkshopFork(projectId: string) {
  const db = getDb();
  const latestThread = getLatestWorkshopThread(projectId);

  if (!latestThread) {
    throw new Error("No workshop thread exists for this project yet.");
  }

  const timestamp = nowIso();
  const forkId = randomUUID();
  const forkTitle = latestThread.title ? `${latestThread.title} (Fork)` : "Prompt workshop fork";

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO workshop_threads (
          id, project_id, codex_thread_id, title, status, search_mode, prompt_draft, summary, repo_context, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      forkId,
      projectId,
      "",
      forkTitle,
      "active",
      latestThread.searchMode,
      latestThread.promptDraft,
      latestThread.summary,
      latestThread.repoContext,
      serialise({
        ...latestThread.metadata,
        forkedFromWorkshopThreadId: latestThread.id,
      }),
      timestamp,
      timestamp,
    );

    db.prepare(
      `
        UPDATE projects
        SET lifecycle_stage = ?, status = ?, updated_at = ?, last_activity_at = ?
        WHERE id = ?
      `,
    ).run("workshop_active", "workshop_active", timestamp, timestamp, projectId);
  })();

  appendAuditEvent({
    projectId,
    actor: "workshop",
    action: "workshop.fork_created",
    detail: "Created a fork of the current workshop prompt.",
    payload: {
      sourceWorkshopThreadId: latestThread.id,
      forkWorkshopThreadId: forkId,
    },
  });

  return {
    workshopThreadId: forkId,
  };
}

export function listWorkshopMessages(projectId: string, workshopThreadId: string) {
  const db = getDb();

  return db
    .prepare(
      `
        SELECT * FROM workshop_messages
        WHERE project_id = ? AND workshop_thread_id = ?
        ORDER BY created_at ASC
      `,
    )
    .all(projectId, workshopThreadId)
    .map((row) => hydrateWorkshopMessage(row as Record<string, unknown>));
}

export function recordWorkshopTurn(input: {
  projectId: string;
  codexThreadId: string;
  title?: string | null;
  searchMode: WorkshopThreadRecord["searchMode"];
  promptDraft: string;
  summary: string;
  repoContext?: string | null;
  userMessage: string;
  assistantMessage: string;
  readyForResearch: boolean;
  openQuestions: string[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
}) {
  const db = getDb();
  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(input.projectId) as Record<string, unknown> | undefined;

  if (!project) {
    throw new Error("Project not found.");
  }

  const existing = db
    .prepare(
      `
        SELECT * FROM workshop_threads
        WHERE project_id = ? AND codex_thread_id = ?
        LIMIT 1
      `,
    )
    .get(input.projectId, input.codexThreadId) as Record<string, unknown> | undefined;
  const timestamp = nowIso();
  const workshopThreadId = existing ? String(existing.id) : randomUUID();
  const existingMetadata = existing
    ? tryParseJson<Record<string, unknown>>(existing.metadata_json as string)
    : null;
  const previousTokenUsage = parseTokenUsage(existingMetadata?.tokenUsageTotal);
  const latestTokenUsage = input.tokenUsage
    ? maxTokenUsage(previousTokenUsage, input.tokenUsage)
    : previousTokenUsage;
  const tokenUsageDelta = subtractTokenUsage(latestTokenUsage, previousTokenUsage);
  const metadata = {
    readyForResearch: input.readyForResearch,
    openQuestions: input.openQuestions,
    tokenUsageTotal: hasTokenUsage(latestTokenUsage) ? latestTokenUsage : null,
  };

  db.transaction(() => {
    if (existing) {
      db.prepare(
        `
          UPDATE workshop_threads
          SET title = ?, search_mode = ?, prompt_draft = ?, summary = ?, repo_context = ?, metadata_json = ?, updated_at = ?
          WHERE id = ?
        `,
      ).run(
        input.title ?? null,
        input.searchMode,
        input.promptDraft,
        input.summary,
        input.repoContext ?? null,
        serialise(metadata),
        timestamp,
        workshopThreadId,
      );
    } else {
      db.prepare(
        `
          INSERT INTO workshop_threads (
            id, project_id, codex_thread_id, title, status, search_mode, prompt_draft, summary, repo_context, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        workshopThreadId,
        input.projectId,
        input.codexThreadId,
        input.title ?? null,
        "active",
        input.searchMode,
        input.promptDraft,
        input.summary,
        input.repoContext ?? null,
        serialise(metadata),
        timestamp,
        timestamp,
      );
    }

    const insertMessage = db.prepare(
      `
        INSERT INTO workshop_messages (
          id, project_id, workshop_thread_id, role, content, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    );

    insertMessage.run(
      randomUUID(),
      input.projectId,
      workshopThreadId,
      "user",
      input.userMessage,
      serialise({}),
      timestamp,
    );

    insertMessage.run(
      randomUUID(),
      input.projectId,
      workshopThreadId,
      "assistant",
      input.assistantMessage,
      serialise({
        openQuestions: input.openQuestions,
        readyForResearch: input.readyForResearch,
        tokenUsageTotal: hasTokenUsage(latestTokenUsage) ? latestTokenUsage : null,
        tokenUsageDelta: hasTokenUsage(tokenUsageDelta) ? tokenUsageDelta : null,
      }),
      timestamp,
    );

    db.prepare(
      `
        UPDATE projects
        SET lifecycle_stage = ?, status = ?, updated_at = ?, last_activity_at = ?
        WHERE id = ?
      `,
    ).run(
      input.readyForResearch ? "research_ready" : "workshop_active",
      input.readyForResearch ? "research_ready" : "workshop_active",
      timestamp,
      timestamp,
      input.projectId,
    );
  })();

  if (hasTokenUsage(tokenUsageDelta)) {
    appendProjectTokenUsageBySlug(String(project.slug), tokenUsageDelta);
  }

  appendAuditEvent({
    projectId: input.projectId,
    actor: "workshop",
    action: "workshop.turn_recorded",
    detail: input.readyForResearch
      ? "Workshop updated and is ready for a research run."
      : "Workshop turn recorded.",
    payload: {
      codexThreadId: input.codexThreadId,
      readyForResearch: input.readyForResearch,
      openQuestions: input.openQuestions,
      tokenUsage: hasTokenUsage(tokenUsageDelta) ? tokenUsageDelta : null,
    },
  });

  return {
    workshopThreadId,
  };
}

export function lockWorkshopPrompt(projectId: string) {
  const snapshot = getProjectSnapshot(projectId);

  if (!snapshot?.workshopThread) {
    throw new Error("No workshop thread exists for this project yet.");
  }

  const openQuestions = Array.isArray(snapshot.workshopThread.metadata.openQuestions)
    ? (snapshot.workshopThread.metadata.openQuestions as unknown[])
        .map((item) => String(item).trim())
        .filter(Boolean)
    : [];
  const promptArtifactId = writeArtifact({
    projectId: snapshot.project.id,
    projectSlug: snapshot.project.slug,
    kind: "research-prompt",
    label: "Canonical research prompt",
    extension: "md",
    mimeType: "text/markdown",
    content: snapshot.workshopThread.promptDraft,
    metadata: {
      workshopThreadId: snapshot.workshopThread.id,
      codexThreadId: snapshot.workshopThread.codexThreadId,
    },
  });
  const summaryArtifactId = writeArtifact({
    projectId: snapshot.project.id,
    projectSlug: snapshot.project.slug,
    kind: "workshop-summary",
    label: "Workshop summary",
    extension: "md",
    mimeType: "text/markdown",
    content: snapshot.workshopThread.summary,
    metadata: {
      workshopThreadId: snapshot.workshopThread.id,
    },
  });
  const questionsArtifactId = writeArtifact({
    projectId: snapshot.project.id,
    projectSlug: snapshot.project.slug,
    kind: "open-questions",
    label: "Open questions",
    extension: "json",
    mimeType: "application/json",
    content: JSON.stringify(openQuestions, null, 2),
    metadata: {
      workshopThreadId: snapshot.workshopThread.id,
    },
  });

  setProjectLifecycleStage(projectId, "research_ready");
  appendAuditEvent({
    projectId,
    actor: "workshop",
    action: "workshop.prompt_locked",
    detail: "Locked a canonical research prompt for the next research run.",
    payload: {
      promptArtifactId,
      summaryArtifactId,
      questionsArtifactId,
    },
  });

  return {
    promptArtifactId,
    summaryArtifactId,
    questionsArtifactId,
  };
}

export function createResearchRunRecord(input: {
  projectId: string;
  provider: ResearchRunRecord["provider"];
  searchMode: ResearchRunRecord["searchMode"];
  promptArtifactId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const runId = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO research_runs (
        id, project_id, provider, status, search_mode, prompt_artifact_id, report_artifact_id, plan_artifact_id, citations_artifact_id, summary_artifact_id, summary, metadata_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    runId,
    input.projectId,
    input.provider,
    "running",
    input.searchMode,
    input.promptArtifactId ?? null,
    null,
    null,
    null,
    null,
    "Research run is starting.",
    serialise(input.metadata ?? {}),
    timestamp,
    null,
  );

  setProjectLifecycleStage(input.projectId, "research_running");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "research",
    action: "research.started",
    detail: `Research run started via ${input.provider}.`,
    payload: {
      researchRunId: runId,
      promptArtifactId: input.promptArtifactId ?? null,
      searchMode: input.searchMode,
    },
  });

  return runId;
}

export function completeResearchRunRecord(input: {
  researchRunId: string;
  projectId: string;
  summary: string;
  reportArtifactId?: string | null;
  planArtifactId?: string | null;
  citationsArtifactId?: string | null;
  summaryArtifactId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE research_runs
      SET
        status = 'completed',
        summary = ?,
        report_artifact_id = ?,
        plan_artifact_id = ?,
        citations_artifact_id = ?,
        summary_artifact_id = ?,
        metadata_json = ?,
        completed_at = ?
      WHERE id = ?
    `,
  ).run(
    input.summary,
    input.reportArtifactId ?? null,
    input.planArtifactId ?? null,
    input.citationsArtifactId ?? null,
    input.summaryArtifactId ?? null,
    serialise(input.metadata ?? {}),
    timestamp,
    input.researchRunId,
  );

  setProjectLifecycleStage(input.projectId, "plan_review");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "research",
    action: "research.completed",
    detail: input.summary,
    payload: {
      researchRunId: input.researchRunId,
      reportArtifactId: input.reportArtifactId ?? null,
      planArtifactId: input.planArtifactId ?? null,
    },
  });
}

export function failResearchRunRecord(input: {
  researchRunId: string;
  projectId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE research_runs
      SET status = 'failed', summary = ?, metadata_json = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(
    input.summary,
    serialise(input.metadata ?? {}),
    timestamp,
    input.researchRunId,
  );

  setProjectLifecycleStage(input.projectId, "failed");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "research",
    action: "research.failed",
    detail: input.summary,
    payload: {
      researchRunId: input.researchRunId,
      ...(input.metadata ?? {}),
    },
  });
}

export function createLaunchRunRecord(input: {
  projectId: string;
  launchProfileId: string;
  summary: string;
  logPath: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const runId = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO launch_runs (
        id, project_id, launch_profile_id, status, summary, log_path, metadata_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    runId,
    input.projectId,
    input.launchProfileId,
    "running",
    input.summary,
    input.logPath,
    serialise(input.metadata ?? {}),
    timestamp,
    null,
  );

  setProjectLifecycleStage(input.projectId, "launch_running");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "launch",
    action: "launch.started",
    detail: input.summary,
    payload: {
      launchRunId: runId,
      launchProfileId: input.launchProfileId,
      logPath: input.logPath,
      ...input.metadata,
    },
  });

  return runId;
}

export function completeLaunchRunRecord(input: {
  launchRunId: string;
  projectId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE launch_runs
      SET status = 'completed', summary = ?, metadata_json = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(input.summary, serialise(input.metadata ?? {}), timestamp, input.launchRunId);

  setProjectLifecycleStage(input.projectId, "launch_complete");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "launch",
    action: "launch.completed",
    detail: input.summary,
    payload: {
      launchRunId: input.launchRunId,
      ...(input.metadata ?? {}),
    },
  });
}

export function failLaunchRunRecord(input: {
  launchRunId: string;
  projectId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE launch_runs
      SET status = 'failed', summary = ?, metadata_json = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(input.summary, serialise(input.metadata ?? {}), timestamp, input.launchRunId);

  setProjectLifecycleStage(input.projectId, "failed");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "launch",
    action: "launch.failed",
    detail: input.summary,
    payload: {
      launchRunId: input.launchRunId,
      ...(input.metadata ?? {}),
    },
  });
}

export function createDeployRunRecord(input: {
  projectId: string;
  deployProfileId: string;
  summary: string;
  logPath: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const runId = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO deploy_runs (
        id, project_id, deploy_profile_id, status, summary, log_path, metadata_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    runId,
    input.projectId,
    input.deployProfileId,
    "running",
    input.summary,
    input.logPath,
    serialise(input.metadata ?? {}),
    timestamp,
    null,
  );

  setProjectLifecycleStage(input.projectId, "deploy_running");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "deploy",
    action: "deploy.started",
    detail: input.summary,
    payload: {
      deployRunId: runId,
      deployProfileId: input.deployProfileId,
      logPath: input.logPath,
      ...input.metadata,
    },
  });

  return runId;
}

export function completeDeployRunRecord(input: {
  deployRunId: string;
  projectId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE deploy_runs
      SET status = 'completed', summary = ?, metadata_json = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(input.summary, serialise(input.metadata ?? {}), timestamp, input.deployRunId);

  setProjectLifecycleStage(input.projectId, "deployed");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "deploy",
    action: "deploy.completed",
    detail: input.summary,
    payload: {
      deployRunId: input.deployRunId,
      ...(input.metadata ?? {}),
    },
  });
}

export function failDeployRunRecord(input: {
  deployRunId: string;
  projectId: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE deploy_runs
      SET status = 'failed', summary = ?, metadata_json = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(input.summary, serialise(input.metadata ?? {}), timestamp, input.deployRunId);

  setProjectLifecycleStage(input.projectId, "failed");
  appendAuditEvent({
    projectId: input.projectId,
    actor: "deploy",
    action: "deploy.failed",
    detail: input.summary,
    payload: {
      deployRunId: input.deployRunId,
      ...(input.metadata ?? {}),
    },
  });
}

export function refreshOperationalProfiles(projectId: string) {
  const db = getDb();
  const projectRow = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Record<string, unknown> | undefined;

  if (!projectRow) {
    throw new Error("Project not found.");
  }

  const timestamp = nowIso();
  const detected = detectOperationalProfiles(hydrateProject(projectRow));
  const existingLaunch = db
    .prepare("SELECT * FROM launch_profiles WHERE project_id = ?")
    .all(projectId) as Array<Record<string, unknown>>;
  const existingDeploy = db
    .prepare("SELECT * FROM deploy_profiles WHERE project_id = ?")
    .all(projectId) as Array<Record<string, unknown>>;
  const launchKey = (profile: {
    target: string;
    label: string;
    command: string;
    cwd: string;
  }) => `${profile.target}::${profile.label}::${profile.command}::${profile.cwd}`;
  const deployKey = (profile: {
    target: string;
    label: string;
    command: string;
    cwd: string;
  }) => `${profile.target}::${profile.label}::${profile.command}::${profile.cwd}`;
  const launchByKey = new Map(
    existingLaunch.map((row) => [
      launchKey({
        target: String(row.target),
        label: String(row.label),
        command: String(row.command),
        cwd: String(row.cwd),
      }),
      row,
    ]),
  );
  const deployByKey = new Map(
    existingDeploy.map((row) => [
      deployKey({
        target: String(row.target),
        label: String(row.label),
        command: String(row.command),
        cwd: String(row.cwd),
      }),
      row,
    ]),
  );
  const upsertLaunch = db.prepare(
    `
      INSERT INTO launch_profiles (
        id, project_id, target, label, command, cwd, healthcheck_url, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        target = excluded.target,
        label = excluded.label,
        command = excluded.command,
        cwd = excluded.cwd,
        healthcheck_url = excluded.healthcheck_url,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `,
  );
  const upsertDeploy = db.prepare(
    `
      INSERT INTO deploy_profiles (
        id, project_id, target, label, command, cwd, approval_required, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        target = excluded.target,
        label = excluded.label,
        command = excluded.command,
        cwd = excluded.cwd,
        approval_required = excluded.approval_required,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `,
  );
  const deleteLaunch = db.prepare("DELETE FROM launch_profiles WHERE id = ?");
  const deleteDeploy = db.prepare("DELETE FROM deploy_profiles WHERE id = ?");

  db.transaction(() => {
    const seenLaunchIds = new Set<string>();
    const seenDeployIds = new Set<string>();

    for (const profile of detected.launchProfiles) {
      const existing = launchByKey.get(launchKey(profile));
      const id = existing ? String(existing.id) : randomUUID();
      const createdAt = existing ? String(existing.created_at) : timestamp;
      seenLaunchIds.add(id);
      upsertLaunch.run(
        id,
        projectId,
        profile.target,
        profile.label,
        profile.command,
        profile.cwd,
        profile.healthcheckUrl,
        serialise(profile.metadata),
        createdAt,
        timestamp,
      );
    }

    for (const row of existingLaunch) {
      const id = String(row.id);
      if (!seenLaunchIds.has(id)) {
        deleteLaunch.run(id);
      }
    }

    for (const profile of detected.deployProfiles) {
      const existing = deployByKey.get(deployKey(profile));
      const id = existing ? String(existing.id) : randomUUID();
      const createdAt = existing ? String(existing.created_at) : timestamp;
      seenDeployIds.add(id);
      upsertDeploy.run(
        id,
        projectId,
        profile.target,
        profile.label,
        profile.command,
        profile.cwd,
        profile.approvalRequired ? 1 : 0,
        serialise(profile.metadata),
        createdAt,
        timestamp,
      );
    }

    for (const row of existingDeploy) {
      const id = String(row.id);
      if (!seenDeployIds.has(id)) {
        deleteDeploy.run(id);
      }
    }
  })();
}

export function advanceQueuedWorkItems(projectId: string) {
  const db = getDb();
  const workItems = hydrateProjectWorkItems(projectId);
  const dependencies = hydrateProjectDependencies(projectId);

  const byId = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const blockersByWorkItemId = new Map<string, WorkItemRecord[]>();

  for (const edge of dependencies) {
    const blocker = byId.get(edge.fromWorkItemId);
    if (!blocker) {
      continue;
    }

    const blockers = blockersByWorkItemId.get(edge.toWorkItemId) ?? [];
    blockers.push(blocker);
    blockersByWorkItemId.set(edge.toWorkItemId, blockers);
  }

  const updateStatus = db.prepare(
    "UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?",
  );
  let changed = false;
  let settled = false;

  while (!settled) {
    settled = true;

    for (const workItem of workItems) {
      const blockers = blockersByWorkItemId.get(workItem.id) ?? [];
      const isReady = blockers.every((blocker) => isTerminalWorkItemStatus(blocker.status));
      let nextStatus: WorkItemStatus | null = null;

      if (shouldAutoAdvanceWorkItem(workItem) && !isTerminalWorkItemStatus(workItem.status)) {
        nextStatus = isReady ? "done" : "blocked";
      } else if (
        !isTerminalWorkItemStatus(workItem.status) &&
        workItem.status !== "in_progress" &&
        workItem.status !== "verifying" &&
        workItem.status !== "awaiting_review"
      ) {
        nextStatus = isReady ? "queued" : "blocked";
      }

      if (nextStatus && nextStatus !== workItem.status) {
        updateStatus.run(nextStatus, nowIso(), workItem.id);
        workItem.status = nextStatus;
        changed = true;
        settled = false;
      }
    }
  }

  return changed;
}

export function listProjects(): ProjectSummary[] {
  const db = getDb();
  const projects = db
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all()
    .map((row) => hydrateProject(row as Record<string, unknown>));

  return projects.map((project) => {
    settleProjectState(project.id);
    const workItems = hydrateProjectWorkItems(project.id);
    const gateStatus = recomputeGateStatuses(project.id);
    const counts = countWorkItems(workItems);
    const currentMilestone = computeCurrentMilestone(workItems);
    const failingGates = [
      gateStatus.qaStatus,
      gateStatus.securityStatus,
      gateStatus.deployStatus,
      gateStatus.releaseStatus,
    ].filter((status) => status === "fail").length;

    return {
      project: {
        ...project,
        health: computeProjectHealth(gateStatus, counts),
      },
      gateStatus,
      counts,
      currentMilestone,
      failingGates,
    };
  });
}

export function getProjectSnapshot(projectId: string): ProjectSnapshot | null {
  const db = getDb();
  const projectRow = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Record<string, unknown> | undefined;

  if (!projectRow) {
    return null;
  }

  const project = hydrateProject(projectRow);
  refreshOperationalProfiles(projectId);
  settleProjectState(projectId);
  const specDocument = db
    .prepare(
      "SELECT * FROM spec_documents WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(projectId) as Record<string, unknown> | undefined;
  const planVersion = db
    .prepare(
      "SELECT * FROM plan_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(projectId) as Record<string, unknown> | undefined;
  const workItems = hydrateProjectWorkItems(projectId);
  const dependencyEdges = db
    .prepare("SELECT * FROM dependency_edges WHERE project_id = ? ORDER BY id ASC")
    .all(projectId)
    .map((row) => hydrateDependency(row as Record<string, unknown>));
  const runs = db
    .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC")
    .all(projectId)
    .map((row) => hydrateRun(row as Record<string, unknown>));
  const artifacts = db
    .prepare("SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId)
    .map((row) => hydrateArtifact(row as Record<string, unknown>));
  const findings = db
    .prepare("SELECT * FROM findings WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId)
    .map((row) => hydrateFinding(row as Record<string, unknown>));
  const auditEvents = db
    .prepare(
      "SELECT * FROM audit_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 80",
    )
    .all(projectId)
    .map((row) => hydrateAudit(row as Record<string, unknown>));
  const workshopThread = db
    .prepare(
      "SELECT * FROM workshop_threads WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1",
    )
    .get(projectId) as Record<string, unknown> | undefined;
  const workshopMessages = workshopThread
    ? db
        .prepare(
          `
            SELECT * FROM workshop_messages
            WHERE project_id = ? AND workshop_thread_id = ?
            ORDER BY created_at ASC
          `,
        )
        .all(projectId, workshopThread.id)
        .map((row) => hydrateWorkshopMessage(row as Record<string, unknown>))
    : [];
  const researchRuns = db
    .prepare("SELECT * FROM research_runs WHERE project_id = ? ORDER BY started_at DESC")
    .all(projectId)
    .map((row) => hydrateResearchRun(row as Record<string, unknown>));
  const launchProfiles = db
    .prepare("SELECT * FROM launch_profiles WHERE project_id = ? ORDER BY target ASC, label ASC")
    .all(projectId)
    .map((row) => hydrateLaunchProfile(row as Record<string, unknown>));
  const launchRuns = db
    .prepare("SELECT * FROM launch_runs WHERE project_id = ? ORDER BY started_at DESC")
    .all(projectId)
    .map((row) => hydrateLaunchRun(row as Record<string, unknown>));
  const deployProfiles = db
    .prepare("SELECT * FROM deploy_profiles WHERE project_id = ? ORDER BY target ASC, label ASC")
    .all(projectId)
    .map((row) => hydrateDeployProfile(row as Record<string, unknown>));
  const deployRuns = db
    .prepare("SELECT * FROM deploy_runs WHERE project_id = ? ORDER BY started_at DESC")
    .all(projectId)
    .map((row) => hydrateDeployRun(row as Record<string, unknown>));
  const gateStatus = recomputeGateStatuses(projectId);
  const counts = countWorkItems(workItems);
  const currentMilestone = computeCurrentMilestone(workItems);
  const failingGates = [
    gateStatus.qaStatus,
    gateStatus.securityStatus,
    gateStatus.deployStatus,
    gateStatus.releaseStatus,
  ].filter((status) => status === "fail").length;

  db.prepare(
    `UPDATE projects SET health = ?, updated_at = ?, last_activity_at = ? WHERE id = ?`,
  ).run(
    computeProjectHealth(gateStatus, counts),
    nowIso(),
    nowIso(),
    projectId,
  );

  return {
    project: {
      ...project,
      health: computeProjectHealth(gateStatus, counts),
    },
    specDocument: specDocument ? hydrateSpecDocument(specDocument) : null,
    planVersion: normalizePlanVersionSummary(
      project.name,
      planVersion ? hydratePlanVersion(planVersion) : null,
    ),
    workItems,
    dependencyEdges,
    runs,
    artifacts,
    findings,
    auditEvents,
    gateStatus,
    counts,
    currentMilestone,
    failingGates,
    trackerIssues: listTrackerIssuesForProject(project.slug),
    symphony: null,
    workshopThread: workshopThread ? hydrateWorkshopThread(workshopThread) : null,
    workshopMessages,
    researchRuns,
    launchProfiles,
    launchRuns,
    deployProfiles,
    deployRuns,
  };
}

export async function deleteProject(projectId: string) {
  const db = getDb();
  const projectRow = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Record<string, unknown> | undefined;

  if (!projectRow) {
    return null;
  }

  const project = hydrateProject(projectRow);
  await stopSymphonyForProject(project.slug);

  const {
    projectRoot,
    projectArtifactsRoot,
    projectWorkspaceRoot,
  } = getProjectPaths(project.slug);
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  transaction();

  for (const target of [projectRoot, projectArtifactsRoot, projectWorkspaceRoot]) {
    rmSync(target, {
      recursive: true,
      force: true,
    });
  }

  return project;
}

export function updateProjectName(projectId: string, name: string) {
  return updateProjectSettings(projectId, {
    name,
  });
}

export function updateProjectSettings(
  projectId: string,
  updates: Partial<
    Pick<
      ProjectRecord,
      | "name"
      | "repoSource"
      | "executionMode"
      | "researchProvider"
      | "plannerModel"
      | "executionModel"
      | "plannerReasoningEffort"
      | "executionReasoningEffort"
      | "symphonyMaxConcurrentAgents"
      | "symphonyMaxTurns"
    >
  >,
) {
  const db = getDb();
  const timestamp = nowIso();

  const existing = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Record<string, unknown> | undefined;

  if (!existing) {
    return null;
  }

  const current = hydrateProject(existing);
  const normalizedName = (updates.name ?? current.name).trim();

  if (!normalizedName) {
    throw new Error("Project name is required.");
  }

  const previousName = String(existing.name ?? "").trim();
  const nextRepoSource =
    typeof updates.repoSource === "string"
      ? normalizeRepoSource(updates.repoSource)
      : current.repoSource;
  const nextExecutionMode = normalizeExecutionMode(
    updates.executionMode ?? current.executionMode,
  );
  const nextResearchProvider = normalizeResearchProvider(
    updates.researchProvider ?? current.researchProvider,
  );
  const nextPlannerModel = sanitizeOptionalModel(
    updates.plannerModel ?? current.plannerModel,
  );
  const nextExecutionModel = sanitizeOptionalModel(
    updates.executionModel ?? current.executionModel,
  );
  const nextPlannerReasoningEffort = normalizeCodexReasoningEffort(
    updates.plannerReasoningEffort ?? current.plannerReasoningEffort,
  );
  const nextExecutionReasoningEffort = normalizeCodexReasoningEffort(
    updates.executionReasoningEffort ?? current.executionReasoningEffort,
  );
  const nextMaxAgents = clamp(
    Number(updates.symphonyMaxConcurrentAgents ?? current.symphonyMaxConcurrentAgents),
    1,
    8,
  );
  const nextMaxTurns = clamp(
    Number(updates.symphonyMaxTurns ?? current.symphonyMaxTurns),
    4,
    80,
  );
  const updateProject = db.prepare(
    `
      UPDATE projects
      SET
        name = ?,
        repo_source = ?,
        execution_mode = ?,
        research_provider = ?,
        planner_model = ?,
        execution_model = ?,
        planner_reasoning_effort = ?,
        execution_reasoning_effort = ?,
        symphony_max_concurrent_agents = ?,
        symphony_max_turns = ?,
        updated_at = ?,
        last_activity_at = ?
      WHERE id = ?
    `,
  );
  const updatePlanVersion = db.prepare(
    `
      UPDATE plan_versions
      SET summary_json = ?, spec_ir_json = ?
      WHERE id = ?
    `,
  );

  db.transaction(() => {
    updateProject.run(
      normalizedName,
      nextRepoSource,
      nextExecutionMode,
      nextResearchProvider,
      nextPlannerModel,
      nextExecutionModel,
      nextPlannerReasoningEffort,
      nextExecutionReasoningEffort,
      nextMaxAgents,
      nextMaxTurns,
      timestamp,
      timestamp,
      projectId,
    );

    const planVersions = db
      .prepare("SELECT id, summary_json, spec_ir_json FROM plan_versions WHERE project_id = ?")
      .all(projectId) as Array<Record<string, unknown>>;

    for (const row of planVersions) {
      const planSummary = tryParseJson<Record<string, unknown>>(row.summary_json as string);
      const specIr = tryParseJson<Record<string, unknown>>(row.spec_ir_json as string);
      const nextPlanSummary =
        typeof planSummary.summary === "string"
          ? rewriteSummaryForProjectName(planSummary.summary, normalizedName, previousName)
          : planSummary.summary;
      const nextSpecSummary =
        typeof specIr.summary === "string"
          ? rewriteSummaryForProjectName(specIr.summary, normalizedName, previousName)
          : specIr.summary;

      if (
        nextPlanSummary === planSummary.summary &&
        nextSpecSummary === specIr.summary
      ) {
        continue;
      }

      updatePlanVersion.run(
        serialise({
          ...planSummary,
          summary: nextPlanSummary,
        }),
        serialise({
          ...specIr,
          summary: nextSpecSummary,
        }),
        String(row.id),
      );
    }
  })();

  appendAuditEvent({
    projectId,
    actor: "control-plane",
    action: "project.settings.updated",
    detail:
      previousName !== normalizedName
        ? `Project renamed from ${previousName || "Untitled project"} to ${normalizedName}.`
        : `Project settings updated for ${normalizedName}.`,
    payload: {
      previousName,
      nextName: normalizedName,
      repoSource: nextRepoSource,
      executionMode: nextExecutionMode,
      researchProvider: nextResearchProvider,
      plannerModel: nextPlannerModel,
      executionModel: nextExecutionModel,
      plannerReasoningEffort: nextPlannerReasoningEffort,
      executionReasoningEffort: nextExecutionReasoningEffort,
      symphonyMaxConcurrentAgents: nextMaxAgents,
      symphonyMaxTurns: nextMaxTurns,
    },
  });

  return hydrateProject(
    db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Record<string, unknown>,
  );
}

async function ingestProjectPlan(input: {
  projectId: string;
  slug: string;
  name: string;
  executionMode: ProjectRecord["executionMode"];
  plannerModel: string | null;
  executionModel: string | null;
  plannerReasoningEffort: ProjectRecord["plannerReasoningEffort"];
  executionReasoningEffort: ProjectRecord["executionReasoningEffort"];
  qaStrictness: number;
  securityStrictness: number;
  deploymentTargets: ProjectRecord["deploymentTargets"];
  symphonyMaxConcurrentAgents: number;
  symphonyMaxTurns: number;
  repoSource: string;
  specText: string;
  specFilename: string;
  planLabel: string;
  lifecycleStage?: ProjectLifecycleStage;
}) {
  const db = getDb();
  const existingPlan = db
    .prepare("SELECT id FROM plan_versions WHERE project_id = ? LIMIT 1")
    .get(input.projectId);

  if (existingPlan) {
    throw new Error("This project already has an ingested plan.");
  }

  const specDocumentId = randomUUID();
  const planVersionId = randomUUID();
  const timestamp = nowIso();
  const { specIr, tokenUsage: plannerTokenUsage } = await buildSpecIrWithLlm({
    name: input.name,
    executionMode: input.executionMode,
    specText: input.specText,
    plannerModel: input.plannerModel,
    plannerReasoningEffort: input.plannerReasoningEffort,
    policyProfile: {
      qaStrictness: input.qaStrictness,
      securityStrictness: input.securityStrictness,
      deploymentTargets: input.deploymentTargets,
    },
  });
  const plan = generatePlanFromSpec(specIr, {
    qaStrictness: input.qaStrictness,
    securityStrictness: input.securityStrictness,
    deploymentTargets: input.deploymentTargets,
  });
  const generatedIdMap = new Map(
    plan.workItems.map((workItem) => [workItem.id, randomUUID()]),
  );
  const projectRoot = getProjectRoot(input.slug);
  const workspaceRoot = getProjectWorkspaceRoot(input.slug);
  const contentHash = getContentHash(input.specText);

  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  const workflowPath = path.join(projectRoot, "WORKFLOW.md");
  writeFileSync(
    workflowPath,
    [
      "# Overture Workflow Contract",
      "",
      `Project: ${input.name}`,
      `Execution mode: ${input.executionMode}`,
      `Planner model: ${input.plannerModel ?? "Codex default"}`,
      `Execution model: ${input.executionModel ?? "Codex default"}`,
      `Planning thinking level: ${input.plannerReasoningEffort}`,
      `Agent thinking level: ${input.executionReasoningEffort}`,
      `QA strictness: ${input.qaStrictness}/5`,
      `Security strictness: ${input.securityStrictness}/5`,
      `Deployment targets: ${input.deploymentTargets.join(", ") || "none"}`,
      `Symphony parallel agents: ${input.symphonyMaxConcurrentAgents}`,
      `Symphony max turns: ${input.symphonyMaxTurns}`,
      "",
      "Rules:",
      "- Closure is blocked until QA, security, and deployment gates pass.",
      "- All evidence is written to immutable artifacts before work items close.",
      "- Use tracker states as execution signals only; internal PM remains canonical.",
    ].join("\n"),
    "utf8",
  );

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO spec_documents (
          id, project_id, filename, content_hash, metadata_json, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      specDocumentId,
      input.projectId,
      input.specFilename,
      contentHash,
      serialise({
        repoSource: input.repoSource,
        outline: specIr.outline,
        plannerModel: input.plannerModel,
        executionModel: input.executionModel,
        plannerReasoningEffort: input.plannerReasoningEffort,
        executionReasoningEffort: input.executionReasoningEffort,
        qaStrictness: input.qaStrictness,
        securityStrictness: input.securityStrictness,
        deploymentTargets: input.deploymentTargets,
        symphonyMaxConcurrentAgents: input.symphonyMaxConcurrentAgents,
        symphonyMaxTurns: input.symphonyMaxTurns,
      }),
      input.specText,
      timestamp,
    );

    db.prepare(
      `
        INSERT INTO plan_versions (
          id, project_id, spec_document_id, label, status, summary_json, spec_ir_json, review_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      planVersionId,
      input.projectId,
      specDocumentId,
      input.planLabel,
      "approved",
      serialise({
        summary: specIr.summary,
      }),
      serialise(specIr),
      serialise(plan.summary),
      timestamp,
    );

    const insertWorkItem = db.prepare(
      `
        INSERT INTO work_items (
          id, project_id, plan_version_id, parent_id, key, title, description, type, status, priority, sort_order, acceptance_criteria_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const workItem of plan.workItems) {
      insertWorkItem.run(
        generatedIdMap.get(workItem.id),
        input.projectId,
        planVersionId,
        workItem.parentId ? generatedIdMap.get(workItem.parentId) : null,
        workItem.key,
        workItem.title,
        workItem.description,
        workItem.type,
        workItem.status,
        workItem.priority,
        workItem.sortOrder,
        serialise(workItem.acceptanceCriteria),
        serialise(workItem.metadata),
        timestamp,
        timestamp,
      );
    }

    const insertDependency = db.prepare(
      `
        INSERT INTO dependency_edges (
          id, project_id, from_work_item_id, to_work_item_id, kind
        ) VALUES (?, ?, ?, ?, ?)
      `,
    );

    for (const edge of plan.dependencyEdges) {
      insertDependency.run(
        randomUUID(),
        input.projectId,
        generatedIdMap.get(edge.fromWorkItemId),
        generatedIdMap.get(edge.toWorkItemId),
        edge.kind,
      );
    }

    db.prepare(
      `
        UPDATE projects
        SET lifecycle_stage = ?, status = ?, updated_at = ?, last_activity_at = ?
        WHERE id = ?
      `,
    ).run(
      input.lifecycleStage ?? "plan_ingested",
      input.lifecycleStage ?? "plan_ingested",
      timestamp,
      timestamp,
      input.projectId,
    );
  })();

  writeArtifact({
    projectId: input.projectId,
    projectSlug: input.slug,
    kind: "spec",
    label: "Ingested source spec",
    extension: "md",
    mimeType: "text/markdown",
    content: input.specText,
    metadata: {
      sourceFile: input.specFilename,
      contentHash,
    },
  });

  writeArtifact({
    projectId: input.projectId,
    projectSlug: input.slug,
    kind: "plan-review",
    label: "Plan review synthesis",
    extension: "md",
    mimeType: "text/markdown",
    content: [
      `# ${input.name} plan review`,
      "",
      "## Inferred",
      ...plan.summary.inferred.map((item) => `- ${item}`),
      "",
      "## Injected",
      ...plan.summary.injected.map((item) => `- ${item}`),
      "",
      "## Risks",
      ...plan.summary.risks.map((item) => `- ${item}`),
      "",
      "## Open questions",
      ...plan.summary.openQuestions.map((item) => `- ${item}`),
      "",
      "## Workflow roots",
      `- Workspace root: ${workspaceRoot}`,
      `- Workflow contract: ${workflowPath}`,
      `- Planner model: ${input.plannerModel ?? "Codex default"}`,
      `- Execution model: ${input.executionModel ?? "Codex default"}`,
      `- Planning thinking level: ${input.plannerReasoningEffort}`,
      `- Agent thinking level: ${input.executionReasoningEffort}`,
      `- Symphony parallel agents: ${input.symphonyMaxConcurrentAgents}`,
      `- Symphony max turns: ${input.symphonyMaxTurns}`,
    ].join("\n"),
    metadata: {
      workflowPath,
      plannerModel: input.plannerModel,
      executionModel: input.executionModel,
    },
  });

  appendAuditEvent({
    projectId: input.projectId,
    actor: "system",
    action: "plan.ingested",
    detail: `Ingested ${input.specFilename} into ${input.name}.`,
    payload: {
      specDocumentId,
      planVersionId,
      slug: input.slug,
      plannerModel: input.plannerModel,
      executionModel: input.executionModel,
      plannerReasoningEffort: input.plannerReasoningEffort,
      executionReasoningEffort: input.executionReasoningEffort,
    },
  });

  if (plannerTokenUsage) {
    appendProjectTokenUsageBySlug(input.slug, plannerTokenUsage);
  }

  refreshOperationalProfiles(input.projectId);
  settleProjectState(input.projectId);

  return {
    planVersionId,
    specDocumentId,
  };
}

export async function ingestApprovedPlan(input: {
  projectId: string;
  specText: string;
  specFilename?: string;
  planLabel?: string;
}) {
  const snapshot = getProjectSnapshot(input.projectId);

  if (!snapshot) {
    throw new Error("Project not found.");
  }

  const result = await ingestProjectPlan({
    projectId: snapshot.project.id,
    slug: snapshot.project.slug,
    name: snapshot.project.name,
    executionMode: snapshot.project.executionMode,
    plannerModel: snapshot.project.plannerModel,
    executionModel: snapshot.project.executionModel,
    plannerReasoningEffort: snapshot.project.plannerReasoningEffort,
    executionReasoningEffort: snapshot.project.executionReasoningEffort,
    qaStrictness: snapshot.project.qaStrictness,
    securityStrictness: snapshot.project.securityStrictness,
    deploymentTargets: snapshot.project.deploymentTargets,
    symphonyMaxConcurrentAgents: snapshot.project.symphonyMaxConcurrentAgents,
    symphonyMaxTurns: snapshot.project.symphonyMaxTurns,
    repoSource: snapshot.project.repoSource,
    specText: input.specText,
    specFilename: input.specFilename ?? "plan.md",
    planLabel: input.planLabel ?? "Approved research plan",
    lifecycleStage: "execution_ready",
  });

  return {
    projectId: snapshot.project.id,
    slug: snapshot.project.slug,
    ...result,
  };
}

export async function createProjectFromSpec(input: CreateProjectInput) {
  const db = getDb();
  const appSettings = getAppSettings();
  const timestamp = nowIso();
  const projectId = randomUUID();
  const slug = nextProjectSlug(db, input.name, projectId);
  const defaults = resolveProjectDefaults(input, appSettings);
  const policyProfile = resolvePolicyProfile(input, appSettings);

  insertProjectRecord({
    id: projectId,
    slug,
    name: input.name.trim(),
    repoSource: defaults.repoSource,
    executionMode: input.executionMode,
    lifecycleStage: "draft",
    researchProvider: defaults.researchProvider,
    plannerModel: defaults.plannerModel,
    executionModel: defaults.executionModel,
    plannerReasoningEffort: defaults.plannerReasoningEffort,
    executionReasoningEffort: defaults.executionReasoningEffort,
    qaStrictness: policyProfile.qaStrictness,
    securityStrictness: policyProfile.securityStrictness,
    deploymentTargets: policyProfile.deploymentTargets,
    symphonyMaxConcurrentAgents: defaults.symphonyMaxConcurrentAgents,
    symphonyMaxTurns: defaults.symphonyMaxTurns,
    timestamp,
  });

  const result = await ingestProjectPlan({
    projectId,
    slug,
    name: input.name.trim(),
    executionMode: input.executionMode,
    plannerModel: defaults.plannerModel,
    executionModel: defaults.executionModel,
    plannerReasoningEffort: defaults.plannerReasoningEffort,
    executionReasoningEffort: defaults.executionReasoningEffort,
    qaStrictness: policyProfile.qaStrictness,
    securityStrictness: policyProfile.securityStrictness,
    deploymentTargets: policyProfile.deploymentTargets,
    symphonyMaxConcurrentAgents: defaults.symphonyMaxConcurrentAgents,
    symphonyMaxTurns: defaults.symphonyMaxTurns,
    repoSource: defaults.repoSource,
    specText: input.specText,
    specFilename: input.specFilename,
    planLabel: "Initial imported plan",
    lifecycleStage: "execution_ready",
  });

  appendAuditEvent({
    projectId,
    actor: "system",
    action: "project.created",
    detail: `Created project ${input.name.trim()} and generated the initial plan version.`,
    payload: {
      slug,
      ...result,
      plannerModel: defaults.plannerModel,
      executionModel: defaults.executionModel,
      plannerReasoningEffort: defaults.plannerReasoningEffort,
      executionReasoningEffort: defaults.executionReasoningEffort,
      qaStrictness: policyProfile.qaStrictness,
      securityStrictness: policyProfile.securityStrictness,
      deploymentTargets: policyProfile.deploymentTargets,
    },
  });

  return {
    projectId,
    slug,
    ...result,
  };
}

export function getArtifactById(artifactId: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM artifacts WHERE id = ?")
    .get(artifactId) as Record<string, unknown> | undefined;
  return row ? hydrateArtifact(row) : null;
}

export function getExecutableWorkItems(projectId: string) {
  const db = getDb();
  settleProjectState(projectId);

  return db
    .prepare(
      `
        SELECT * FROM work_items
        WHERE project_id = ? AND status = 'queued'
        ORDER BY priority ASC, sort_order ASC
      `,
    )
    .all(projectId)
    .map((row) => hydrateWorkItem(row as Record<string, unknown>));
}

export function createRun(input: {
  projectId: string;
  workItemId: string;
  runnerType: string;
  workspacePath: string;
  logPath: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const runId = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO runs (
        id, project_id, work_item_id, status, phase, runner_type, thread_id, workspace_path, log_path, summary, metadata_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    runId,
    input.projectId,
    input.workItemId,
    "running",
    "preparing_workspace",
    input.runnerType,
    null,
    input.workspacePath,
    input.logPath,
    input.summary,
    serialise(input.metadata ?? {}),
    timestamp,
    null,
  );

  db.prepare("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?").run(
    "in_progress",
    timestamp,
    input.workItemId,
  );

  appendAuditEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId,
    actor: "runner",
    action: "run.started",
    detail: `Run started via ${input.runnerType}.`,
  });

  return runId;
}

export function updateRunPhase(
  runId: string,
  phase: RunRecord["phase"],
  summary?: string,
) {
  const db = getDb();
  db.prepare("UPDATE runs SET phase = ?, summary = COALESCE(?, summary) WHERE id = ?").run(
    phase,
    summary ?? null,
    runId,
  );
}

export function completeRun(input: {
  runId: string;
  projectId: string;
  workItemId: string;
  summary: string;
  succeeded: boolean;
}) {
  const db = getDb();
  const timestamp = nowIso();
  const workItemStatus = input.succeeded ? "done" : "failed";

  db.prepare(
    `
      UPDATE runs SET status = ?, phase = ?, summary = ?, completed_at = ?
      WHERE id = ?
    `,
  ).run(
    input.succeeded ? "succeeded" : "failed",
    input.succeeded ? "completed" : "failed",
    input.summary,
    timestamp,
    input.runId,
  );

  db.prepare("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?").run(
    workItemStatus,
    timestamp,
    input.workItemId,
  );

  appendAuditEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    actor: "runner",
    action: input.succeeded ? "run.completed" : "run.failed",
    detail: input.summary,
  });

  settleProjectState(input.projectId);
}

function trackerStateFromStatus(status: WorkItemStatus) {
  switch (status) {
    case "queued":
      return {
        name: "Todo" as const,
        id: "state-todo",
      };
    case "in_progress":
    case "verifying":
      return {
        name: "In Progress" as const,
        id: "state-in-progress",
      };
    case "awaiting_review":
      return {
        name: "Review" as const,
        id: "state-review",
      };
    case "failed":
    case "blocked":
      return {
        name: "Blocked" as const,
        id: "state-blocked",
      };
    case "done":
    case "waived":
      return {
        name: "Done" as const,
        id: "state-done",
      };
  }
}

export function listTrackerIssuesForProject(projectSlug: string, states?: string[]) {
  const db = getDb();
  const projectRow = db
    .prepare("SELECT * FROM projects WHERE slug = ?")
    .get(projectSlug) as Record<string, unknown> | undefined;

  if (!projectRow) {
    return [] as TrackerIssue[];
  }

  const project = hydrateProject(projectRow);
  const workItems = db
    .prepare("SELECT * FROM work_items WHERE project_id = ? ORDER BY sort_order ASC")
    .all(project.id)
    .map((row) => hydrateWorkItem(row as Record<string, unknown>));
  const blockersByWorkItemId = new Map<
    string,
    Array<{ id: string; identifier: string; stateName: string | null }>
  >();

  const blockerRows = db
    .prepare(
      `
        SELECT dependency_edges.to_work_item_id, work_items.id, work_items.key, work_items.status
        FROM dependency_edges
        JOIN work_items ON work_items.id = dependency_edges.from_work_item_id
        WHERE dependency_edges.project_id = ?
      `,
    )
    .all(project.id) as Array<Record<string, unknown>>;

  blockerRows.forEach((row) => {
    const blockerState = trackerStateFromStatus(row.status as WorkItemStatus);
    const blockers = blockersByWorkItemId.get(String(row.to_work_item_id)) ?? [];
    blockers.push({
      id: String(row.id),
      identifier: String(row.key),
      stateName: blockerState.name,
    });
    blockersByWorkItemId.set(String(row.to_work_item_id), blockers);
  });

  return workItems
    .map((workItem) => {
      const state = trackerStateFromStatus(workItem.status);
      return {
        id: workItem.id,
        identifier: workItem.key,
        title: workItem.title,
        description: workItem.description,
        priority: workItem.priority,
        stateName: state.name,
        stateId: state.id,
        branchName: `feature/${sanitizeBranchSegment(`${workItem.key}-${workItem.title}`)}`,
        assigneeId: null,
        labels: uniqueTrackerLabels(workItem),
        blockedBy: blockersByWorkItemId.get(workItem.id) ?? [],
        projectSlug,
        url: `/projects/${project.id}#${workItem.id}`,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt,
      } satisfies TrackerIssue;
    })
    .filter((issue) => (states?.length ? states.includes(issue.stateName) : true));
}

export function getTrackerIssueById(issueId: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM work_items WHERE id = ?")
    .get(issueId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  const workItem = hydrateWorkItem(row);
  const project = hydrateProject(
    db.prepare("SELECT * FROM projects WHERE id = ?").get(
      workItem.projectId,
    ) as Record<string, unknown>,
  );
  const state = trackerStateFromStatus(workItem.status);
  const blockers = db
    .prepare(
      `
        SELECT work_items.id, work_items.key, work_items.status
        FROM dependency_edges
        JOIN work_items ON work_items.id = dependency_edges.from_work_item_id
        WHERE dependency_edges.to_work_item_id = ?
        ORDER BY work_items.sort_order ASC
      `,
    )
    .all(workItem.id) as Array<Record<string, unknown>>;

  return {
    id: workItem.id,
    identifier: workItem.key,
    title: workItem.title,
    description: workItem.description,
    priority: workItem.priority,
    stateName: state.name,
    stateId: state.id,
    branchName: `feature/${sanitizeBranchSegment(`${workItem.key}-${workItem.title}`)}`,
    assigneeId: null,
    labels: uniqueTrackerLabels(workItem),
    blockedBy: blockers.map((blocker) => ({
      id: String(blocker.id),
      identifier: String(blocker.key),
      stateName: trackerStateFromStatus(blocker.status as WorkItemStatus).name,
    })),
    projectSlug: project.slug,
    url: `/projects/${project.id}#${workItem.id}`,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
  } satisfies TrackerIssue;
}

export function updateWorkItemFromTracker(input: {
  issueId: string;
  stateId: string;
}) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM work_items WHERE id = ?")
    .get(input.issueId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Issue not found.");
  }

  const workItem = hydrateWorkItem(row);
  const statusMap: Record<string, WorkItemStatus> = {
    "state-todo": "queued",
    "state-in-progress": "in_progress",
    "state-review": "awaiting_review",
    "state-blocked": "blocked",
    "state-done": "done",
  };
  const nextStatus = statusMap[input.stateId];

  if (!nextStatus) {
    throw new Error("Unsupported tracker state.");
  }

  db.prepare("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?").run(
    nextStatus,
    nowIso(),
    workItem.id,
  );
  appendAuditEvent({
    projectId: workItem.projectId,
    workItemId: workItem.id,
    actor: "tracker",
    action: "issue.state.updated",
    detail: `Tracker state changed to ${input.stateId}.`,
  });
  settleProjectState(workItem.projectId);
}

export function addTrackerComment(input: { issueId: string; body: string }) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM work_items WHERE id = ?")
    .get(input.issueId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Issue not found.");
  }

  const workItem = hydrateWorkItem(row);
  appendAuditEvent({
    projectId: workItem.projectId,
    workItemId: workItem.id,
    actor: "tracker",
    action: "issue.comment.created",
    detail: input.body,
  });
}

export function resolveArtifactPath(filePath: string) {
  return assertWithinRoot(getArtifactsRoot(), filePath);
}
