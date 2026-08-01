"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DiscoveryDetailResponseSchema,
  ProjectDetailResponseSchema,
  type ProjectWithDiscovery,
} from "@project-architect/contracts";
import { getApiErrorMessage } from "@/lib/api-client";
import {
  discoveryStatusLabels,
  getDiscoveryActionLabel,
} from "./discovery-status";
import { projectTypeLabels } from "./project-type-label";

type ProjectDetailState =
  | { status: "loading" }
  | { status: "loaded"; project: ProjectWithDiscovery }
  | { status: "error"; message: string };

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ProjectDetailState>({
    status: "loading",
  });
  const [isStarting, setIsStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProject() {
      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(
            await getApiErrorMessage(
              response,
              "No se pudo cargar el proyecto.",
            ),
          );
        }

        const payload: unknown = await response.json();
        const data = ProjectDetailResponseSchema.parse(payload);

        if (isMounted) {
          setState({ status: "loaded", project: data.project });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "No se pudo cargar el proyecto.",
          });
        }
      }
    }

    void loadProject();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  async function openDiscovery(project: ProjectWithDiscovery) {
    setActionError(null);

    if (project.discovery.status !== "not_started") {
      router.push(`/projects/${project.id}/discovery`);
      return;
    }

    setIsStarting(true);

    try {
      const response = await fetch(`/api/projects/${project.id}/discovery`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(
            response,
            "No se pudo iniciar el descubrimiento.",
          ),
        );
      }

      const payload: unknown = await response.json();
      DiscoveryDetailResponseSchema.parse(payload);
      router.push(`/projects/${project.id}/discovery`);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar el descubrimiento.",
      );
      setIsStarting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-neutral-950">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-8 sm:px-6 lg:py-12">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
          >
            ← Volver al dashboard
          </Link>
          <span className="text-sm font-medium text-neutral-500">
            Project Architect
          </span>
        </header>

        {state.status === "loading" ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-neutral-600">Cargando proyecto...</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="rounded-lg border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-red-800">
              No se pudo abrir el proyecto
            </h1>
            <p className="mt-3 text-sm text-neutral-700">{state.message}</p>
          </div>
        ) : null}

        {state.status === "loaded" ? (
          <>
            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-emerald-700">
                    {projectTypeLabels[state.project.projectType]}
                  </p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950">
                    {state.project.name}
                  </h1>
                </div>
                <span className="w-fit rounded-full bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700">
                  {discoveryStatusLabels[state.project.discovery.status]}
                </span>
              </div>

              <div className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  Objetivo global
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-neutral-800">
                  {state.project.globalObjective}
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-2xl">
                  <h2 className="text-xl font-semibold text-neutral-950">
                    Descubrimiento del proyecto
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">
                    Recopila el contexto necesario antes de solicitar análisis
                    o recomendaciones a una futura integración de IA.
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-emerald-700"
                        style={{
                          width: `${state.project.discovery.percentage}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-emerald-800">
                      {state.project.discovery.percentage}%
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void openDiscovery(state.project)}
                  disabled={isStarting}
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                >
                  {isStarting
                    ? "Iniciando..."
                    : getDiscoveryActionLabel(
                        state.project.discovery.status,
                      )}
                </button>
              </div>

              {state.project.discovery.status === "completed" ? (
                <p className="mt-5 rounded-md border border-emerald-200 bg-white p-4 text-sm font-medium text-emerald-800">
                  El contexto está confirmado y preparado para una futura fase
                  de análisis con inteligencia artificial.
                </p>
              ) : null}

              {actionError ? (
                <p className="mt-4 text-sm font-medium text-red-700">
                  {actionError}
                </p>
              ) : null}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
