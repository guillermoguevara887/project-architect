"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatLanguageDate, type LanguageProject } from "@/lib/languages";
import { useSessionGuard } from "@/lib/use-session-guard";

export function LanguageHomeScreen() {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [projects, setProjects] = useState<LanguageProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) return;
    let active = true;

    async function loadProjects() {
      try {
        const response = await fetch("/api/languages/projects", {
          cache: "no-store",
          credentials: "include",
        });
        if (response.status === 401) {
          router.replace("/");
          return;
        }
        const result = (await response.json()) as {
          projects?: LanguageProject[];
        };
        if (!response.ok || !result.projects) {
          throw new Error("Languages unavailable");
        }
        if (active) setProjects(result.projects);
      } catch {
        if (active) setError("No se pudieron cargar los idiomas.");
      }
    }

    void loadProjects();
    return () => {
      active = false;
    };
  }, [authorized, router]);

  if (!authorized || (!projects && !error)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando Idiomas…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell language-shell">
      <section className="flow-card language-card" aria-labelledby="languages-title">
        <p className="brand">MemoOS · Idiomas</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>
        <header className="language-heading">
          <h1 id="languages-title">Idiomas</h1>
          <Link className="primary-link" href="/languages/new">
            Nuevo idioma
          </Link>
        </header>
        {error ? (
          <p className="form-error language-error" role="alert">
            {error}
          </p>
        ) : null}
        {projects?.length === 0 ? (
          <div className="empty-state">
            <h2>Aún no hay idiomas</h2>
            <p>Crea tu primer espacio de aprendizaje.</p>
          </div>
        ) : (
          <div className="language-list" aria-label="Idiomas">
            {projects?.map((project) => (
              <Link
                className="language-list-card"
                href={`/languages/${project.id}`}
                key={project.id}
              >
                <div>
                  <strong>{project.language}</strong>
                  <p>{project.level}</p>
                </div>
                <time dateTime={project.createdAt}>
                  {formatLanguageDate(project.createdAt)}
                </time>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
