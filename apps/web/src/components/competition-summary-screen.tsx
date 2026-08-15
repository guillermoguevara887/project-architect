"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";

type CompetitionProject = {
  id: string;
  projectType: "project" | "competition";
  sourceText: string | null;
  officialUrl: string | null;
  analysisStatus: "pending" | "completed" | "failed";
};

const PROJECT_TYPE_LABELS: Record<CompetitionProject["projectType"], string> = {
  project: "Proyecto",
  competition: "Concurso",
};

const PROJECT_STATUS_LABELS: Record<
  CompetitionProject["analysisStatus"],
  string
> = {
  pending: "Pendiente de análisis",
  completed: "Completado",
  failed: "Fallido",
};

export function CompetitionSummaryScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [project, setProject] = useState<CompetitionProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    let active = true;

    async function loadProject() {
      try {
        const response = await fetch(
          `/api/architect/projects/${encodeURIComponent(projectId)}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        if (response.status === 401) {
          router.replace("/");
          return;
        }

        const result = (await response.json()) as {
          project?: CompetitionProject;
        };

        if (!response.ok || !result.project) {
          if (active) {
            setError("No se encontró el concurso.");
          }
          return;
        }

        if (active) {
          setProject(result.project);
        }
      } catch {
        if (active) {
          setError("No se pudo cargar el concurso.");
        }
      }
    }

    void loadProject();

    return () => {
      active = false;
    };
  }, [authorized, projectId, router]);

  if (!authorized || (!project && !error)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando concurso…</p>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="flow-shell">
        <section className="flow-card">
          <p className="brand">Project Architect</p>
          <p className="form-error" role="alert">
            {error}
          </p>
          <Link className="primary-link" href="/dashboard">
            Volver al Dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flow-shell">
      <article className="flow-card summary-card" aria-labelledby="summary-title">
        <p className="brand">Project Architect</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>
        <h1 id="summary-title">{PROJECT_TYPE_LABELS[project.projectType]}</h1>

        <dl className="saved-information">
          <div>
            <dt>Información proporcionada</dt>
            <dd className="source-text">
              {project.sourceText || "No proporcionada"}
            </dd>
          </div>
          <div>
            <dt>URL oficial</dt>
            <dd>
              {project.officialUrl ? (
                <a
                  className="content-link"
                  href={project.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {project.officialUrl}
                </a>
              ) : (
                "No proporcionada"
              )}
            </dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{PROJECT_STATUS_LABELS[project.analysisStatus]}</dd>
          </div>
        </dl>
      </article>
    </main>
  );
}
