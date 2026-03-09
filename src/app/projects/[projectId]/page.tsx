export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { ProjectLiveShell } from "@/components/project-live-shell";
import { getProjectSnapshot } from "@/lib/server/repository";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const snapshot = getProjectSnapshot(projectId);

  if (!snapshot) {
    notFound();
  }

  return (
    <main className="pb-8">
      <ProjectLiveShell initialSnapshot={snapshot} />
    </main>
  );
}
