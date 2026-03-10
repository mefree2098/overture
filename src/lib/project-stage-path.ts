import type { ProjectLifecycleStage } from "@/lib/types";

export function projectStagePath(projectId: string, lifecycleStage: ProjectLifecycleStage) {
  switch (lifecycleStage) {
    case "draft":
    case "workshop_active":
    case "research_ready":
      return `/projects/${projectId}/workshop`;
    case "research_running":
    case "plan_review":
      return `/projects/${projectId}/research`;
    default:
      return `/projects/${projectId}`;
  }
}
