import { ProjectDetail } from "@/components/project-detail";

type ProjectPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;

  return <ProjectDetail projectId={projectId} />;
}
