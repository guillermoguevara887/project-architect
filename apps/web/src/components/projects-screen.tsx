"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PROJECT_FILTERS,
  PROJECT_STATUS_LABELS,
  type Project,
  type ProjectStatus,
} from "@/lib/projects";
import { useSessionGuard } from "@/lib/use-session-guard";

type ProjectFilter = "all" | ProjectStatus;

const projectDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function ProjectsScreen() {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) return;
    let active = true;

    async function loadProjects() {
      setProjects(null);
      setError(null);
      const query = filter === "all" ? "" : `?status=${filter}`;

      try {
        const response = await fetch(`/api/architect/projects${query}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (response.status === 401) {
          router.replace("/");
          return;
        }

        const result = (await response.json()) as { projects?: Project[] };
        if (!response.ok || !result.projects) {
          throw new Error("Projects unavailable");
        }

        if (active) setProjects(result.projects);
      } catch {
        if (active) setError("No se pudieron cargar los proyectos.");
      }
    }

    void loadProjects();
    return () => {
      active = false;
    };
  }, [authorized, filter, router]);

  if (!authorized) {
    return (
      <main className="flow-shell projects-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell projects-shell">
      <section className="flow-card projects-card" aria-labelledby="projects-title">
        <header className="projects-heading">
          <div>
            <p className="brand">MemoOS</p>
            <Link className="back-link" href="/dashboard">
              Volver al Dashboard
            </Link>
            <h1 id="projects-title">Proyectos</h1>
          </div>
          <Link className="primary-link" href="/projects/new">
            + Nuevo proyecto
          </Link>
        </header>

        <nav className="project-filters" aria-label="Filtrar proyectos">
          {PROJECT_FILTERS.map((option) => (
            <button
              className="project-filter-button"
              type="button"
              aria-pressed={filter === option.value}
              key={option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </nav>

        {!projects && !error ? (
          <p className="loading-message projects-message">Cargando proyectos…</p>
        ) : null}
        {error ? (
          <p className="form-error projects-message" role="alert">
            {error}
          </p>
        ) : null}
        {projects?.length === 0 ? (
          <div className="empty-state projects-empty-state">
            <p>No hay proyectos en este estado.</p>
          </div>
        ) : null}

        {projects && projects.length > 0 ? (
          <div className="project-feed" aria-label="Lista de proyectos">
            {projects.map((project) => {
              const toolNames = project.links.map((link) => link.name);
              if (project.officialUrl) toolNames.push("Sitio oficial");

              return (
                <Link
                  className="project-feed-card"
                  href={`/projects/${project.id}`}
                  key={project.id}
                >
                  <div className="project-card-heading">
                    <h2>{project.name}</h2>
                    <span className={`project-status project-status-${project.status}`}>
                      {PROJECT_STATUS_LABELS[project.status]}
                    </span>
                  </div>
                  <p className="project-card-description">
                    {project.description || "Sin descripción todavía."}
                  </p>
                  <footer className="project-card-footer">
                    <span>
                      {toolNames.length > 0
                        ? toolNames.join(" · ")
                        : "Sin herramientas asociadas"}
                    </span>
                    <time dateTime={project.updatedAt}>
                      Actualizado {projectDateFormatter.format(new Date(project.updatedAt))}
                    </time>
                  </footer>
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
