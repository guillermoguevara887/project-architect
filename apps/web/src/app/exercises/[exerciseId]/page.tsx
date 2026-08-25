import { ExerciseDetailScreen } from "@/components/exercise-detail-screen";

export default async function ExercisePage({
  params,
}: {
  params: Promise<{ exerciseId: string }>;
}) {
  const { exerciseId } = await params;
  return <ExerciseDetailScreen exerciseId={exerciseId} />;
}
