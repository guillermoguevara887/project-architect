import { LanguageLessonScreen } from "@/components/language-lesson-screen";

export default async function LanguageLessonPage({ params }: { params: Promise<{ projectId: string; lessonId: string }> }) {
  const { projectId, lessonId } = await params;
  return <LanguageLessonScreen projectId={projectId} lessonId={lessonId} />;
}
