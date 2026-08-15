import { CompetitionSummaryScreen } from "@/components/competition-summary-screen";

export default async function CompetitionSummaryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <CompetitionSummaryScreen projectId={projectId} />;
}
