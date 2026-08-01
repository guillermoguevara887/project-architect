"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ProjectsListResponseSchema,
  type ProjectListItem,
} from "@project-architect/contracts";
import { getApiErrorMessage } from "@/lib/api-client";
import {
  discoveryStatusLabels,
  getDiscoveryActionLabel,
} from "./discovery-status";
import { projectTypeLabels } from "./project-type-label";

type DashboardState =
  | { status: "loading" }
  | { status: "loaded"; projects: ProjectListItem[] }
  | { status: "error"; message: string };

const dateFormatter = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(value: string) {
  return dateFormatter.format(new Date(value));
}

export function ProjectsDashboard() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    async function loadProjects() {
      try {
        const response = await fetch("/api/projects", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(
            await getApiErrorMessage(
              response,
              "No se pudieron cargar los proyectos.",
            ),
          );
        }

        const payload: unknown = await response.json();
        const data = ProjectsListResponseSchema.parse(payload);

        if (isMounted) {
          setState({ status: "loaded", projects: data.projects });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los proyectos.";

        if (isMounted) {
          setState({ status: "error", message });
        }
      }
    }

    void loadProjects();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-neutral-950">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-8 sm:px-6 lg:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">
              Dashboard
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950 sm:text-4xl">
              Project Architect
            </h1>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Nuevo proyecto
          </Link>
        </header>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-950">
              Proyectos guardados
            </h2>
          </div>

          {state.status === "loading" ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-neutral-600">Cargando proyectos...</p>
            </div>
          ) : null}

          {state.status === "error" ? (
            <div className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-red-700">
                Error al cargar proyectos
              </p>
              <p className="mt-2 text-sm text-neutral-600">{state.message}</p>
            </div>
          ) : null}

          {state.status === "loaded" && state.projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center shadow-sm">
              <p className="text-base font-medium text-neutral-950">
                Todavía no existen proyectos.
              </p>
              <p className="mt-2 text-sm text-neutral-600">
                Crea el primero para empezar a capturar una idea u objetivo.
              </p>
            </div>
          ) : null}

          {state.status === "loaded" && state.projects.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {state.projects.map((project) => (
                <article
                  key={project.id}
                  className="rounded-lg border border-neutral-200 bg-white shadow-sm transition hover:border-emerald-300 hover:shadow-md"
                >
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex h-full flex-col gap-4 p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-neutral-950">
                          {project.name}
                        </h3>
                        <p className="mt-1 text-sm font-medium text-emerald-700">
                          {projectTypeLabels[project.projectType]}
                        </p>
                      </div>
                      <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
                        {discoveryStatusLabels[project.discovery.status]}
                      </span>
                    </div>

                    <p className="line-clamp-4 text-sm leading-6 text-neutral-700">
                      {project.globalObjective}
                    </p>

                    <div className="mt-auto space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium text-neutral-500">
                        <span>Descubrimiento</span>
                        <span>{project.discovery.percentage}%</span>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-neutral-100"
                        aria-label={`Progreso de descubrimiento: ${project.discovery.percentage}%`}
                      >
                        <div
                          className="h-full rounded-full bg-emerald-600 transition-all"
                          style={{
                            width: `${project.discovery.percentage}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <p className="text-xs font-medium text-neutral-500">
                        Creado: {formatCreatedAt(project.createdAt)}
                      </p>
                      <span className="text-sm font-semibold text-emerald-700">
                        {getDiscoveryActionLabel(project.discovery.status)}
                      </span>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
