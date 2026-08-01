import Link from "next/link";
import { NewProjectForm } from "@/components/new-project-form";

export default function NewProjectPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-neutral-950">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:px-6 lg:py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">
              Project Architect
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950">
              Nuevo proyecto
            </h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
          >
            Volver al dashboard
          </Link>
        </div>

        <NewProjectForm />
      </section>
    </main>
  );
}
