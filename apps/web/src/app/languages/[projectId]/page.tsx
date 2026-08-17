import { LanguageProjectScreen } from "@/components/language-project-screen";

export default async function LanguageProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <LanguageProjectScreen projectId={projectId} />;
}
