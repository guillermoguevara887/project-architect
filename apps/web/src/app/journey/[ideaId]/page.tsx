import { JourneyIdeaScreen } from "@/components/journey-idea-screen";

export default async function JourneyIdeaPage({
  params,
}: {
  params: Promise<{ ideaId: string }>;
}) {
  const { ideaId } = await params;
  return <JourneyIdeaScreen ideaId={ideaId} />;
}
