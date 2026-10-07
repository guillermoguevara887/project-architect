import { AdminMaterialScreen } from "@/components/admin-material-screen";

export default async function MaterialLevelPage({ params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params;
  return <AdminMaterialScreen levelId={levelId} />;
}
