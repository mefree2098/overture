import type {
  DEFAULT_POLICY_PROFILE,
  DEPLOYMENT_TARGETS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  GATE_NAMES,
  RUN_PHASES,
  TRACKER_STATE_NAMES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
} from "@/lib/constants";

export type GateName = (typeof GATE_NAMES)[number];
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type RunPhase = (typeof RUN_PHASES)[number];
export type DeploymentTarget = (typeof DEPLOYMENT_TARGETS)[number];
export type TrackerStateName = (typeof TRACKER_STATE_NAMES)[number];
export type ExecutionMode = "local_chatgpt" | "hosted_api";
export type GateVerdict = "pass" | "fail" | "pending" | "waived" | "partial";

export interface PolicyProfile {
  qaStrictness: number;
  securityStrictness: number;
  deploymentTargets: DeploymentTarget[];
}

export interface OutlineNode {
  title: string;
  level: number;
}

export interface SectionBlock {
  title: string;
  level: number;
  body: string;
  bullets: string[];
}

export interface SpecMilestone {
  name: string;
  tasks: string[];
}

export interface SpecEpic {
  name: string;
  tasks: string[];
}

export interface SpecIR {
  summary: string;
  outline: OutlineNode[];
  sections: SectionBlock[];
  features: string[];
  roles: string[];
  entities: string[];
  integrations: string[];
  constraints: string[];
  risks: string[];
  acceptanceCriteria: string[];
  deploymentTargets: DeploymentTarget[];
  milestones: SpecMilestone[];
  epics: SpecEpic[];
  openQuestions: string[];
}

export interface GeneratedWorkItem {
  id: string;
  key: string;
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: number;
  sortOrder: number;
  parentId: string | null;
  acceptanceCriteria: string[];
  metadata: Record<string, unknown>;
}

export interface GeneratedDependencyEdge {
  id: string;
  fromWorkItemId: string;
  toWorkItemId: string;
  kind: string;
}

export interface PlanGenerationResult {
  summary: {
    inferred: string[];
    injected: string[];
    risks: string[];
    openQuestions: string[];
  };
  workItems: GeneratedWorkItem[];
  dependencyEdges: GeneratedDependencyEdge[];
}

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  repoSource: string;
  executionMode: ExecutionMode;
  status: string;
  health: "on_track" | "at_risk" | "blocked";
  qaStrictness: number;
  securityStrictness: number;
  deploymentTargets: DeploymentTarget[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface SpecDocumentRecord {
  id: string;
  projectId: string;
  filename: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  content: string;
  createdAt: string;
}

export interface PlanVersionRecord {
  id: string;
  projectId: string;
  specDocumentId: string;
  label: string;
  status: string;
  summary: Record<string, unknown>;
  specIr: SpecIR;
  review: PlanGenerationResult["summary"];
  createdAt: string;
}

export interface WorkItemRecord {
  id: string;
  projectId: string;
  planVersionId: string;
  parentId: string | null;
  key: string;
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: number;
  sortOrder: number;
  acceptanceCriteria: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DependencyEdgeRecord {
  id: string;
  projectId: string;
  fromWorkItemId: string;
  toWorkItemId: string;
  kind: string;
}

export interface RunRecord {
  id: string;
  projectId: string;
  workItemId: string;
  status: string;
  phase: RunPhase;
  runnerType: string;
  threadId: string | null;
  workspacePath: string;
  logPath: string;
  summary: string;
  metadata: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

export interface ArtifactRecord {
  id: string;
  projectId: string;
  workItemId: string | null;
  runId: string | null;
  kind: string;
  label: string;
  filePath: string;
  mimeType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface FindingRecord {
  id: string;
  projectId: string;
  workItemId: string | null;
  runId: string | null;
  category: GateName;
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  detail: string;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEventRecord {
  id: string;
  projectId: string;
  workItemId: string | null;
  runId: string | null;
  actor: string;
  action: string;
  detail: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface GateStatusRecord {
  projectId: string;
  qaStatus: GateVerdict;
  securityStatus: GateVerdict;
  deployStatus: GateVerdict;
  releaseStatus: GateVerdict;
  summary: Record<string, unknown>;
  updatedAt: string;
}

export interface TrackerIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  stateName: TrackerStateName;
  stateId: string;
  projectSlug: string;
  url: string;
  updatedAt: string;
}

export interface ProjectSummary {
  project: ProjectRecord;
  gateStatus: GateStatusRecord;
  counts: Record<WorkItemStatus, number>;
  currentMilestone: string | null;
  failingGates: number;
}

export interface ProjectSnapshot extends ProjectSummary {
  specDocument: SpecDocumentRecord | null;
  planVersion: PlanVersionRecord | null;
  workItems: WorkItemRecord[];
  dependencyEdges: DependencyEdgeRecord[];
  runs: RunRecord[];
  artifacts: ArtifactRecord[];
  findings: FindingRecord[];
  auditEvents: AuditEventRecord[];
  trackerIssues: TrackerIssue[];
}

export interface CreateProjectInput {
  name: string;
  repoSource: string;
  executionMode: ExecutionMode;
  policyProfile?: Partial<typeof DEFAULT_POLICY_PROFILE>;
  specText: string;
  specFilename: string;
}
