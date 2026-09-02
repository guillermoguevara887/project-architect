import { redirect } from "next/navigation";

export default function PendingProjectPage() {
  redirect("/projects/new");
}
