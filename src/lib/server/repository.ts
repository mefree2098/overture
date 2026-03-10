import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_POLICY_PROFILE } from "@/lib/constants";
import { normalizeCodexReasoningEffort } from "@/lib/codex-reasoning";
import { getAppSettings } from "@/lib/server/app-settings";
import { getDb } from "@/lib/server/db";
import { buildSpecIrWithLlm } from "@/lib/server/llm-planner";
import { generatePlanFromSpec } from "@/lib/server/plan-generator";
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
  CreateProjectInput,
  DependencyEdgeRecord,
  FindingRecord,
  GateStatusRecord,
  PlanVersionRecord,
  ProjectRecord,
  ProjectSnapshot,
  ProjectSummary,
  RunRecord,
  SpecDocumentRecord,
  TrackerIssue,
  WorkItemRecord,
  WorkItemStatus,
} from "@/lib/types";
import { slugify, tryParseJson } from "@/lib/utils";

function nowIso() {
  return new Date().toISOString();
}

function serialise(value: unknown) {
  return JSON.stringify(value);
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
    : deployTasksComplete || artifacts.some((artifact) => artifact.kind === "deploy-plan")
      ? "pass"
      : "pending";
  const releaseStatus =
    qaStatus === "pass" &&
    securityStatus === "pass" &&
    deployStatus === "pass" &&
    allTasksComplete
      ? "pass"
      : hasOpenSecurityFinding || hasOpenQaFinding
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
    symphonyMaxConcurrentAgents: Number(row.symphony_max_concurrent_agents ?? 2),
    symphonyMaxTurns: Number(row.symphony_max_turns ?? 24),
    status: String(row.status),
    health: row.health as ProjectRecord["health"],
    qaStrictness: Number(row.qa_strictness),
    securityStrictness: Number(row.security_strictness),
    deploymentTargets: tryParseJson(row.deployment_targets_json as string),
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
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const artifactId = randomUUID();
  const projectArtifactsRoot = getProjectArtifactsRoot(input.projectSlug);
  const fileName = `${artifactId}.${input.extension.replace(/^\./, "")}`;
  const filePath = path.join(projectArtifactsRoot, fileName);
  writeFileSync(filePath, input.content, "utf8");

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

export function advanceQueuedWorkItems(projectId: string) {
  const db = getDb();
  const workItems = hydrateProjectWorkItems(projectId);
  const dependencies = hydrateProjectDependencies(projectId);

  const byId = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const updateStatus = db.prepare(
    "UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?",
  );
  let changed = false;

  for (const workItem of workItems) {
    if (
      isTerminalWorkItemStatus(workItem.status) ||
      workItem.status === "in_progress" ||
      workItem.status === "verifying" ||
      workItem.status === "awaiting_review"
    ) {
      continue;
    }

    const blockers = dependencies
      .filter((edge) => edge.toWorkItemId === workItem.id)
      .map((edge) => byId.get(edge.fromWorkItemId))
      .filter(Boolean) as WorkItemRecord[];
    const isReady = blockers.every((blocker) => isTerminalWorkItemStatus(blocker.status));
    const nextStatus = isReady ? "queued" : "blocked";

    if (nextStatus !== workItem.status) {
      updateStatus.run(nextStatus, nowIso(), workItem.id);
      changed = true;
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
    planVersion: planVersion ? hydratePlanVersion(planVersion) : null,
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
  const db = getDb();
  const timestamp = nowIso();
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new Error("Project name is required.");
  }

  const existing = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Record<string, unknown> | undefined;

  if (!existing) {
    return null;
  }

  db.prepare(
    `
      UPDATE projects
      SET name = ?, updated_at = ?, last_activity_at = ?
      WHERE id = ?
    `,
  ).run(normalizedName, timestamp, timestamp, projectId);

  return hydrateProject(
    db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Record<string, unknown>,
  );
}

export async function createProjectFromSpec(input: CreateProjectInput) {
  const db = getDb();
  const appSettings = getAppSettings();
  const projectId = randomUUID();
  const specDocumentId = randomUUID();
  const planVersionId = randomUUID();
  const timestamp = nowIso();
  const repoSource = normalizeRepoSource(input.repoSource);
  const slugBase = slugify(input.name) || `project-${projectId.slice(0, 8)}`;
  let slug = slugBase;
  let counter = 2;

  while (db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug)) {
    slug = `${slugBase}-${counter++}`;
  }

  const policyProfile = {
    ...DEFAULT_POLICY_PROFILE,
    ...input.policyProfile,
    deploymentTargets:
      input.policyProfile?.deploymentTargets ?? DEFAULT_POLICY_PROFILE.deploymentTargets,
  };
  const plannerModel =
    input.plannerModel === undefined
      ? appSettings.plannerModel
      : input.plannerModel?.trim() || null;
  const executionModel =
    input.executionModel === undefined
      ? appSettings.executionModel
      : input.executionModel?.trim() || null;
  const plannerReasoningEffort =
    input.plannerReasoningEffort ?? appSettings.plannerReasoningEffort;
  const executionReasoningEffort =
    input.executionReasoningEffort ?? appSettings.executionReasoningEffort;
  const symphonyMaxConcurrentAgents =
    input.symphonyMaxConcurrentAgents ?? appSettings.symphonyMaxConcurrentAgents;
  const symphonyMaxTurns = input.symphonyMaxTurns ?? appSettings.symphonyMaxTurns;

  const specIr = await buildSpecIrWithLlm({
    name: input.name,
    executionMode: input.executionMode,
    specText: input.specText,
    plannerModel,
    plannerReasoningEffort,
  });
  const plan = generatePlanFromSpec(specIr);
  const generatedIdMap = new Map(
    plan.workItems.map((workItem) => [workItem.id, randomUUID()]),
  );
  const projectRoot = getProjectRoot(slug);
  const workspaceRoot = getProjectWorkspaceRoot(slug);
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
      `Planner model: ${plannerModel ?? "Codex default"}`,
      `Execution model: ${executionModel ?? "Codex default"}`,
      `Planning thinking level: ${plannerReasoningEffort}`,
      `Agent thinking level: ${executionReasoningEffort}`,
      `Symphony parallel agents: ${symphonyMaxConcurrentAgents}`,
      `Symphony max turns: ${symphonyMaxTurns}`,
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
        INSERT INTO projects (
          id, slug, name, repo_source, execution_mode, planner_model, execution_model, planner_reasoning_effort, execution_reasoning_effort, symphony_max_concurrent_agents, symphony_max_turns, status, health, qa_strictness, security_strictness, deployment_targets_json, created_at, updated_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      projectId,
      slug,
      input.name,
      repoSource,
      input.executionMode,
      plannerModel,
      executionModel,
      plannerReasoningEffort,
      executionReasoningEffort,
      symphonyMaxConcurrentAgents,
      symphonyMaxTurns,
      "planned",
      "on_track",
      policyProfile.qaStrictness,
      policyProfile.securityStrictness,
      serialise(policyProfile.deploymentTargets),
      timestamp,
      timestamp,
      timestamp,
    );

    db.prepare(
      `
        INSERT INTO spec_documents (
          id, project_id, filename, content_hash, metadata_json, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      specDocumentId,
      projectId,
      input.specFilename,
      contentHash,
      serialise({
        repoSource,
        outline: specIr.outline,
        plannerModel,
        executionModel,
        plannerReasoningEffort,
        executionReasoningEffort,
        symphonyMaxConcurrentAgents,
        symphonyMaxTurns,
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
      projectId,
      specDocumentId,
      "Initial imported plan",
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
        projectId,
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
        projectId,
        generatedIdMap.get(edge.fromWorkItemId),
        generatedIdMap.get(edge.toWorkItemId),
        edge.kind,
      );
    }
  })();

  writeArtifact({
    projectId,
    projectSlug: slug,
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
    projectId,
    projectSlug: slug,
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
      `- Planner model: ${plannerModel ?? "Codex default"}`,
      `- Execution model: ${executionModel ?? "Codex default"}`,
      `- Planning thinking level: ${plannerReasoningEffort}`,
      `- Agent thinking level: ${executionReasoningEffort}`,
      `- Symphony parallel agents: ${symphonyMaxConcurrentAgents}`,
      `- Symphony max turns: ${symphonyMaxTurns}`,
    ].join("\n"),
    metadata: {
      workflowPath,
      plannerModel,
      executionModel,
    },
  });

  appendAuditEvent({
    projectId,
    actor: "system",
    action: "project.created",
    detail: `Created project ${input.name} and generated the initial plan version.`,
    payload: {
      specDocumentId,
      planVersionId,
      slug,
      plannerModel,
      executionModel,
      plannerReasoningEffort,
      executionReasoningEffort,
    },
  });

  settleProjectState(projectId);

  return {
    projectId,
    slug,
    planVersionId,
    specDocumentId,
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
