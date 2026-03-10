export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { ProjectPipelineShell } from "@/components/project-pipeline-shell";
import { getProjectPipelineViewData } from "@/lib/server/project-pipeline-view";

export default async function ProjectResearchPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const data = await getProjectPipelineViewData(projectId);

  if (!data) {
    notFound();
  }

  return (
    <main className="pb-8">
      <ProjectPipelineShell
        initialSnapshot={data.snapshot}
        view="research"
        initialPlanMarkdown={data.initialPlanMarkdown}
        initialResearchReport={data.initialResearchReport}
      />
    </main>
  );
}
