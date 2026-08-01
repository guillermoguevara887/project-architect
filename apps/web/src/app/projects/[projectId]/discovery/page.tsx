import { DiscoveryWorkspace } from "@/components/discovery-workspace";

type DiscoveryPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function DiscoveryPage({
  params,
}: DiscoveryPageProps) {
  const { projectId } = await params;

  return <DiscoveryWorkspace projectId={projectId} />;
}
