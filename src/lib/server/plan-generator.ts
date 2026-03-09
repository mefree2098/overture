import { DEFAULT_POLICY_PROFILE } from "@/lib/constants";
import type {
  GeneratedDependencyEdge,
  GeneratedWorkItem,
  PlanGenerationResult,
  SpecIR,
  WorkItemType,
} from "@/lib/types";

function makeId(prefix: string, index: number) {
  return `${prefix}-${String(index + 1).padStart(2, "0")}`;
}

function inferType(title: string): WorkItemType {
  const value = title.toLowerCase();
  if (
    value.includes("qa") ||
    value.includes("playwright") ||
    value.includes("test")
  ) {
    return "qa";
  }
  if (
    value.includes("security") ||
    value.includes("semgrep") ||
    value.includes("trivy") ||
    value.includes("zap")
  ) {
    return "security";
  }
  if (
    value.includes("deploy") ||
    value.includes("azure") ||
    value.includes("aws") ||
    value.includes("jetson")
  ) {
    return "deploy";
  }
  if (value.includes("docs") || value.includes("runbook")) {
    return "docs";
  }
  if (value.includes("release")) {
    return "release";
  }
  if (value.includes("plan") || value.includes("spec")) {
    return "spec";
  }
  if (value.includes("ui") || value.includes("ux") || value.includes("dashboard")) {
    return "design";
  }
  return "implement";
}

function createWorkItem(input: {
  id: string;
  key: string;
  title: string;
  description: string;
  type: WorkItemType;
  status: "queued" | "blocked";
  priority: number;
  sortOrder: number;
  parentId?: string | null;
  acceptanceCriteria?: string[];
  metadata?: Record<string, unknown>;
}): GeneratedWorkItem {
  return {
    id: input.id,
    key: input.key,
    title: input.title,
    description: input.description,
    type: input.type,
    status: input.status,
    priority: input.priority,
    sortOrder: input.sortOrder,
    parentId: input.parentId ?? null,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    metadata: input.metadata ?? {},
  };
}

function createEdge(
  index: number,
  fromWorkItemId: string,
  toWorkItemId: string,
): GeneratedDependencyEdge {
  return {
    id: makeId("edge", index),
    fromWorkItemId,
    toWorkItemId,
    kind: "blocks",
  };
}

export function generatePlanFromSpec(specIr: SpecIR): PlanGenerationResult {
  const workItems: GeneratedWorkItem[] = [];
  const dependencyEdges: GeneratedDependencyEdge[] = [];
  const milestoneIdsByName = new Map<string, string>();
  const epicNamesByMilestone = new Map<string, Set<string>>();
  let sortOrder = 0;
  let edgeOrder = 0;
  let previousMilestoneId: string | null = null;

  specIr.epics.forEach((epic) => {
    if (!epic.milestoneName) {
      return;
    }

    const names = epicNamesByMilestone.get(epic.milestoneName) ?? new Set<string>();
    names.add(epic.name);
    epicNamesByMilestone.set(epic.milestoneName, names);
  });

  specIr.milestones.forEach((milestone, milestoneIndex) => {
    const milestoneId = makeId("milestone", milestoneIndex);
    const attachedEpicNames = epicNamesByMilestone.get(milestone.name) ?? new Set<string>();
    workItems.push(
      createWorkItem({
        id: milestoneId,
        key: `M${milestoneIndex + 1}`,
        title: milestone.name,
        description: `Execution bundle for ${milestone.name}.`,
        type: inferType(milestone.name),
        status: previousMilestoneId ? "blocked" : "queued",
        priority: 1,
        sortOrder: sortOrder++,
        acceptanceCriteria: milestone.tasks.slice(0, 3),
        metadata: {
          lane: "milestone",
          injected: false,
        },
      }),
    );
    milestoneIdsByName.set(milestone.name, milestoneId);

    if (previousMilestoneId) {
      dependencyEdges.push(createEdge(edgeOrder++, previousMilestoneId, milestoneId));
    }

    let previousTaskId: string | null = milestoneId;
    milestone.tasks
      .filter((taskTitle) => !attachedEpicNames.has(taskTitle))
      .forEach((taskTitle, taskIndex) => {
      const taskId = makeId(`milestone-${milestoneIndex + 1}-task`, taskIndex);
      workItems.push(
        createWorkItem({
          id: taskId,
          key: `M${milestoneIndex + 1}.${taskIndex + 1}`,
          title: taskTitle,
          description: `${taskTitle} originated from ${milestone.name} during plan decomposition.`,
          type: inferType(taskTitle),
          status: "blocked",
          priority: 2,
          sortOrder: sortOrder++,
          parentId: milestoneId,
          acceptanceCriteria: specIr.acceptanceCriteria.slice(0, 4),
          metadata: {
            lane: "task",
            injected: false,
          },
        }),
      );

      if (previousTaskId) {
        dependencyEdges.push(createEdge(edgeOrder++, previousTaskId, taskId));
      }
      previousTaskId = taskId;
      });

    previousMilestoneId = milestoneId;
  });

  specIr.epics.forEach((epic, epicIndex) => {
    const epicId = makeId("epic", epicIndex);
    const milestoneParentId = epic.milestoneName
      ? milestoneIdsByName.get(epic.milestoneName) ?? null
      : null;

    workItems.push(
      createWorkItem({
        id: epicId,
        key: `E${epicIndex + 1}`,
        title: epic.name,
        description: `Canonical backlog epic derived from the plan: ${epic.name}.`,
        type: inferType(epic.name),
        status: "blocked",
        priority: 3,
        sortOrder: sortOrder++,
        parentId: milestoneParentId,
        acceptanceCriteria: epic.tasks.slice(0, 4),
        metadata: {
          lane: "epic",
          injected: false,
          milestoneName: epic.milestoneName ?? null,
        },
      }),
    );

    if (milestoneParentId) {
      dependencyEdges.push(createEdge(edgeOrder++, milestoneParentId, epicId));
    }

    epic.tasks.forEach((taskTitle, taskIndex) => {
      const taskId = makeId(`epic-${epicIndex + 1}-task`, taskIndex);
      workItems.push(
        createWorkItem({
          id: taskId,
          key: `E${epicIndex + 1}.${taskIndex + 1}`,
          title: taskTitle,
          description: `${taskTitle} is tracked under ${epic.name}.`,
          type: inferType(taskTitle),
          status: "blocked",
          priority: 4,
          sortOrder: sortOrder++,
          parentId: epicId,
          acceptanceCriteria: specIr.acceptanceCriteria.slice(0, 3),
          metadata: {
            lane: "epic-task",
            injected: false,
          },
        }),
      );

      dependencyEdges.push(createEdge(edgeOrder++, epicId, taskId));
      if (!milestoneParentId && previousMilestoneId) {
        dependencyEdges.push(createEdge(edgeOrder++, previousMilestoneId, epicId));
      }
    });
  });

  const injectedWorkstreams = [
    {
      key: "QA",
      title: "Mandatory QA gate stack",
      description:
        "Run unit, integration, e2e, lint, build, screenshot capture, and smoke flows before closure.",
      type: "qa" as const,
      acceptanceCriteria: [
        "Playwright evidence captured",
        "All required tests passing",
        "Warnings triaged or removed",
      ],
    },
    {
      key: "SEC",
      title: "Mandatory security loop",
      description:
        "Threat notes, SAST, dependency scan, secrets scan, and DAST baseline with remediation tracking.",
      type: "security" as const,
      acceptanceCriteria: [
        "No unresolved high or critical findings",
        "Waivers include owner and expiry",
      ],
    },
    {
      key: "DEP",
      title: "Deployment verification matrix",
      description:
        "Local, Jetson, Azure, and AWS deployment planning with attached evidence and smoke status.",
      type: "deploy" as const,
      acceptanceCriteria: [
        "Local deployment is smoke tested",
        "Jetson/Azure/AWS plans are generated and linked",
      ],
    },
    {
      key: "OBS",
      title: "Observability baseline",
      description:
        "Structured logs, correlated IDs, and evidence-friendly telemetry outputs are always injected.",
      type: "implement" as const,
      acceptanceCriteria: ["Project emits structured audit and runtime events"],
    },
    {
      key: "DOC",
      title: "Runbooks and operator docs",
      description: "Document deployment, rollback, and operator workflows.",
      type: "docs" as const,
      acceptanceCriteria: [
        "Runbook covers deploy, smoke, rollback, and evidence lookup",
      ],
    },
    {
      key: "REL",
      title: "Release readiness gate",
      description:
        "Project closure is blocked until QA, security, and deployment gates are green.",
      type: "release" as const,
      acceptanceCriteria: ["Release gate is pass or explicitly waived"],
    },
  ];

  injectedWorkstreams.forEach((workstream, index) => {
    const id = makeId("policy", index);
    workItems.push(
      createWorkItem({
        id,
        key: workstream.key,
        title: workstream.title,
        description: workstream.description,
        type: workstream.type,
        status: "blocked",
        priority: 1,
        sortOrder: sortOrder++,
        acceptanceCriteria: workstream.acceptanceCriteria,
        metadata: {
          lane: "policy",
          injected: true,
          defaultProfile: DEFAULT_POLICY_PROFILE,
        },
      }),
    );

    if (previousMilestoneId) {
      dependencyEdges.push(createEdge(edgeOrder++, previousMilestoneId, id));
    }
  });

  specIr.openQuestions.slice(0, 6).forEach((question, index) => {
    const id = makeId("decision", index);
    workItems.push(
      createWorkItem({
        id,
        key: `D${index + 1}`,
        title: question,
        description:
          "Clarification task raised by ambiguity detection during plan ingestion.",
        type: "triage",
        status: "blocked",
        priority: 2,
        sortOrder: sortOrder++,
        acceptanceCriteria: ["Decision captured with explicit rationale"],
        metadata: {
          lane: "decision",
          injected: true,
        },
      }),
    );
  });

  return {
    summary: {
      inferred: specIr.features.slice(0, 10),
      injected: [
        "QA stack",
        "Security loop",
        "Deployment planning for local, Jetson, Azure, AWS",
        "Observability baseline",
        "Release readiness gate",
      ],
      risks: specIr.risks.slice(0, 8),
      openQuestions: specIr.openQuestions.slice(0, 8),
    },
    workItems,
    dependencyEdges,
  };
}
