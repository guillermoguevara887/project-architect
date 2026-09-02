"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";

type ArchitectProject = {
  id: string;
  projectType: "project" | "competition";
  sourceText: string | null;
  analysisStatus: "pending" | "completed" | "failed";
  createdAt: string;
};

const PROJECT_TYPE_LABELS: Record<ArchitectProject["projectType"], string> = {
  project: "Proyecto",
  competition: "Concurso",
};

const PROJECT_STATUS_LABELS: Record<ArchitectProject["analysisStatus"], string> = {
  pending: "Pendiente de análisis",
  completed: "Completado",
  failed: "Fallido",
};

const projectDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function projectTitle(project: ArchitectProject) {
  const firstLine = project.sourceText?.trim().split(/\r?\n/, 1)[0]?.trim();
  return firstLine || `${PROJECT_TYPE_LABELS[project.projectType]} sin título`;
}

export function NewProjectScreen() {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [projects, setProjects] = useState<ArchitectProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    let active = true;

    async function loadProjects() {
      try {
        const response = await fetch("/api/architect/projects", {
          cache: "no-store",
          credentials: "include",
        });

        if (response.status === 401) {
          router.replace("/");
          return;
        }

        const result = (await response.json()) as {
          projects?: ArchitectProject[];
        };

        if (!response.ok || !result.projects) {
          throw new Error("Projects unavailable");
        }

        if (active) {
          setProjects(result.projects);
        }
      } catch {
        if (active) {
          setError("No se pudieron cargar los proyectos.");
        }
      }
    }

    void loadProjects();

    return () => {
      active = false;
    };
  }, [authorized, router]);

  if (!authorized) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell">
      <section className="flow-card" aria-labelledby="new-project-title">
        <p className="brand">Proyectos</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>
        <h1 id="new-project-title">¿Qué quieres crear?</h1>

        <div className="choice-grid" aria-label="Tipo de proyecto">
          <Link className="choice-card" href="/projects/new/project">
            <strong>Proyecto</strong>
          </Link>
          <Link className="choice-card" href="/projects/new/competition">
            <strong>Concurso</strong>
          </Link>
        </div>

        <section
          className="architect-projects-section"
          aria-labelledby="architect-projects-title"
        >
          <p className="section-kicker">Contenido guardado</p>
          <h2 id="architect-projects-title">Mis proyectos</h2>

          {!projects && !error ? (
            <p className="loading-message architect-projects-message">
              Cargando proyectos…
            </p>
          ) : null}

          {error ? (
            <p className="form-error architect-projects-message" role="alert">
              {error}
            </p>
          ) : null}

          {projects?.length === 0 ? (
            <div className="empty-state architect-empty-state">
              <p>Todavía no tienes proyectos.</p>
            </div>
          ) : null}

          {projects && projects.length > 0 ? (
            <div className="architect-project-list" aria-label="Mis proyectos">
              {projects.map((project) => (
                <Link
                  className="architect-project-card"
                  href={`/projects/${project.id}`}
                  key={project.id}
                >
                  <div>
                    <strong>{projectTitle(project)}</strong>
                    <div className="architect-project-meta">
                      <span>{PROJECT_TYPE_LABELS[project.projectType]}</span>
                      <span>{PROJECT_STATUS_LABELS[project.analysisStatus]}</span>
                      <time dateTime={project.createdAt}>
                        {projectDateFormatter.format(new Date(project.createdAt))}
                      </time>
                    </div>
                  </div>
                  <span className="architect-project-open">Abrir</span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
