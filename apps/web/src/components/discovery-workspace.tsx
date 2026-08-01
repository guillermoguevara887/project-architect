"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DiscoveryDetailResponseSchema,
  DiscoverySessionResponseSchema,
  SaveDiscoveryAnswerResponseSchema,
  type DiscoveryAnswerValue,
  type DiscoveryDetail,
  type DiscoveryQuestion,
} from "@project-architect/contracts";
import { getApiErrorMessage } from "@/lib/api-client";
import { DiscoveryQuestionField } from "./discovery-question-field";
import { discoveryStatusLabels } from "./discovery-status";
import { projectTypeLabels } from "./project-type-label";

type WorkspaceState =
  | { status: "loading" }
  | { status: "loaded"; discovery: DiscoveryDetail }
  | { status: "error"; message: string };

type ViewMode = "form" | "review" | "completed";
type Operation =
  | "idle"
  | "saving"
  | "moving"
  | "reviewing"
  | "completing";

type AnswerDrafts = Record<string, DiscoveryAnswerValue | null>;

function createDrafts(discovery: DiscoveryDetail): AnswerDrafts {
  return Object.fromEntries(
    discovery.sections.flatMap((section) =>
      section.questions.map((question) => [
        question.id,
        question.answer?.answer ?? null,
      ]),
    ),
  );
}

function getInitialMode(discovery: DiscoveryDetail): ViewMode {
  if (discovery.session.status === "completed") {
    return "completed";
  }

  if (discovery.session.status === "ready_for_review") {
    return "review";
  }

  return "form";
}

async function fetchDiscovery(
  projectId: string,
  startWhenMissing: boolean,
) {
  let response = await fetch(`/api/projects/${projectId}/discovery`, {
    cache: "no-store",
  });

  if (response.status === 404 && startWhenMissing) {
    response = await fetch(`/api/projects/${projectId}/discovery`, {
      method: "POST",
    });
  }

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(
        response,
        "No se pudo cargar el descubrimiento.",
      ),
    );
  }

  const payload: unknown = await response.json();
  return DiscoveryDetailResponseSchema.parse(payload).discovery;
}

async function postSessionAction(projectId: string, action: string) {
  const response = await fetch(
    `/api/projects/${projectId}/discovery/${action}`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(
        response,
        "No se pudo actualizar el descubrimiento.",
      ),
    );
  }

  const payload: unknown = await response.json();
  return DiscoverySessionResponseSchema.parse(payload);
}

function formatAnswer(
  question: DiscoveryQuestion,
  value: DiscoveryAnswerValue | null,
) {
  if (
    value === null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return "Sin respuesta";
  }

  if (question.questionType === "yes_no" && typeof value === "boolean") {
    return value ? "Sí" : "No";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value);
}

type ReviewSummaryProps = {
  discovery: DiscoveryDetail;
  drafts: AnswerDrafts;
  disabled: boolean;
  completed: boolean;
  onEdit: (step: number) => void;
};

function ReviewSummary({
  discovery,
  drafts,
  disabled,
  completed,
  onEdit,
}: ReviewSummaryProps) {
  const missingQuestionIds = useMemo(
    () => new Set(discovery.progress.missingRequiredQuestionIds),
    [discovery.progress.missingRequiredQuestionIds],
  );

  return (
    <div className="space-y-6">
      {discovery.sections.map((section) => (
        <section
          key={section.key}
          className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Sección {section.position + 1}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-neutral-950">
                {section.title}
              </h2>
            </div>
            {!completed ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onEdit(section.position)}
                className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 disabled:cursor-not-allowed disabled:text-neutral-400"
              >
                Editar
              </button>
            ) : null}
          </div>

          <dl className="mt-6 divide-y divide-neutral-100">
            {section.questions.map((question) => {
              const isMissing = missingQuestionIds.has(question.id);

              return (
                <div
                  key={question.id}
                  className={`py-4 first:pt-0 last:pb-0 ${
                    isMissing ? "rounded-md bg-red-50 px-3" : ""
                  }`}
                >
                  <dt className="text-sm font-semibold text-neutral-900">
                    {question.questionText}
                    {question.isRequired ? (
                      <span className="ml-1 text-red-700">*</span>
                    ) : null}
                  </dt>
                  <dd
                    className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${
                      isMissing
                        ? "font-medium text-red-700"
                        : "text-neutral-700"
                    }`}
                  >
                    {formatAnswer(question, drafts[question.id] ?? null)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function DiscoveryWorkspace({ projectId }: { projectId: string }) {
  const [state, setState] = useState<WorkspaceState>({
    status: "loading",
  });
  const [drafts, setDrafts] = useState<AnswerDrafts>({});
  const [activeStep, setActiveStep] = useState(0);
  const [mode, setMode] = useState<ViewMode>("form");
  const [operation, setOperation] = useState<Operation>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  function applyDiscovery(discovery: DiscoveryDetail) {
    setState({ status: "loaded", discovery });
    setDrafts(createDrafts(discovery));
    setActiveStep(
      Math.min(
        discovery.session.currentStep,
        Math.max(discovery.sections.length - 1, 0),
      ),
    );
    setMode(getInitialMode(discovery));
  }

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const discovery = await fetchDiscovery(projectId, true);

        if (isMounted) {
          setState({ status: "loaded", discovery });
          setDrafts(createDrafts(discovery));
          setActiveStep(
            Math.min(
              discovery.session.currentStep,
              Math.max(discovery.sections.length - 1, 0),
            ),
          );
          setMode(getInitialMode(discovery));
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "No se pudo cargar el descubrimiento.",
          });
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const isBusy = operation !== "idle";

  async function persistSection(
    discovery: DiscoveryDetail,
    step: number,
  ) {
    const section = discovery.sections[step];

    if (!section) {
      throw new Error("La sección solicitada no existe.");
    }

    for (const question of section.questions) {
      const response = await fetch(
        `/api/projects/${projectId}/discovery/answers/${question.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            answer: drafts[question.id] ?? null,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(
            response,
            `No se pudo guardar la respuesta: ${question.questionText}`,
          ),
        );
      }

      const payload: unknown = await response.json();
      SaveDiscoveryAnswerResponseSchema.parse(payload);
    }

    const refreshed = await fetchDiscovery(projectId, false);
    applyDiscovery(refreshed);
    return refreshed;
  }

  async function moveToStep(step: number) {
    const response = await fetch(`/api/projects/${projectId}/discovery`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentStep: step,
      }),
    });

    if (!response.ok) {
      throw new Error(
        await getApiErrorMessage(
          response,
          "No se pudo guardar la sección actual.",
        ),
      );
    }

    const payload: unknown = await response.json();
    const data = DiscoverySessionResponseSchema.parse(payload);

    setState((current) =>
      current.status === "loaded"
        ? {
            status: "loaded",
            discovery: {
              ...current.discovery,
              session: data.session,
              progress: data.progress,
            },
          }
        : current,
    );
    setActiveStep(step);
    setMode("form");
  }

  async function handleMove(direction: "previous" | "next") {
    if (state.status !== "loaded") {
      return;
    }

    setOperation("saving");
    setFeedback(null);
    setOperationError(null);

    try {
      const refreshed = await persistSection(
        state.discovery,
        activeStep,
      );
      const isLastStep =
        activeStep === refreshed.sections.length - 1;

      if (direction === "next" && isLastStep) {
        setOperation("reviewing");
        await postSessionAction(projectId, "review");
        const reviewed = await fetchDiscovery(projectId, false);
        applyDiscovery(reviewed);
        setFeedback("Tus respuestas están guardadas y listas para revisión.");
        return;
      }

      const nextStep =
        direction === "next"
          ? Math.min(activeStep + 1, refreshed.sections.length - 1)
          : Math.max(activeStep - 1, 0);

      setOperation("moving");
      await moveToStep(nextStep);
      setFeedback("Respuestas guardadas.");
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "No se pudieron guardar las respuestas.",
      );
    } finally {
      setOperation("idle");
    }
  }

  async function handleEdit(step: number) {
    setOperation("moving");
    setFeedback(null);
    setOperationError(null);

    try {
      await moveToStep(step);
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "No se pudo abrir la sección.",
      );
    } finally {
      setOperation("idle");
    }
  }

  async function handleComplete() {
    if (state.status !== "loaded") {
      return;
    }

    setOperation("completing");
    setFeedback(null);
    setOperationError(null);

    try {
      await postSessionAction(projectId, "complete");
      const completed = await fetchDiscovery(projectId, false);
      applyDiscovery(completed);
      setFeedback(
        "Contexto confirmado. Está listo para una futura fase de análisis con IA.",
      );
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "No se pudo completar el descubrimiento.",
      );
    } finally {
      setOperation("idle");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-neutral-950">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 sm:px-6 lg:py-10">
        <header className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={`/projects/${projectId}`}
            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
          >
            ← Volver al proyecto
          </Link>
          {state.status === "loaded" ? (
            <span className="w-fit rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm">
              {discoveryStatusLabels[state.discovery.session.status]}
            </span>
          ) : null}
        </header>

        {state.status === "loading" ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-neutral-600">
              Preparando el descubrimiento...
            </p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="rounded-xl border border-red-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-red-800">
              No se pudo abrir el descubrimiento
            </h1>
            <p className="mt-3 text-sm text-neutral-700">{state.message}</p>
          </div>
        ) : null}

        {state.status === "loaded" ? (
          <>
            <section>
              <p className="text-sm font-semibold text-emerald-700">
                {projectTypeLabels[state.discovery.project.projectType]}
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">
                {state.discovery.project.name}
              </h1>
              <p className="mt-2 text-sm text-neutral-600">
                Descubrimiento y recopilación de contexto
              </p>
            </section>

            <section
              className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
              aria-label="Progreso del descubrimiento"
            >
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-semibold text-neutral-800">
                  Progreso total
                </span>
                <span className="font-semibold text-emerald-700">
                  {state.discovery.progress.percentage}%
                </span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-emerald-700 transition-all"
                  style={{
                    width: `${state.discovery.progress.percentage}%`,
                  }}
                />
              </div>
              <p className="mt-3 text-xs text-neutral-500">
                {state.discovery.progress.answeredQuestions} de{" "}
                {state.discovery.progress.totalQuestions} preguntas
                respondidas ·{" "}
                {state.discovery.progress.answeredRequiredQuestions} de{" "}
                {state.discovery.progress.requiredQuestions} obligatorias
              </p>
            </section>

            {mode === "form" ? (
              <>
                <nav aria-label="Secciones del descubrimiento">
                  <ol className="grid gap-2 sm:grid-cols-5">
                    {state.discovery.sections.map((section) => (
                      <li key={section.key}>
                        <div
                          className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                            section.position === activeStep
                              ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                              : section.position < activeStep
                                ? "border-emerald-200 bg-white text-emerald-700"
                                : "border-neutral-200 bg-white text-neutral-500"
                          }`}
                        >
                          {section.position + 1}. {section.title}
                        </div>
                      </li>
                    ))}
                  </ol>
                </nav>

                {state.discovery.sections[activeStep] ? (
                  <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
                    <div className="border-b border-neutral-100 pb-5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        Sección {activeStep + 1} de{" "}
                        {state.discovery.sections.length}
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold text-neutral-950">
                        {state.discovery.sections[activeStep].title}
                      </h2>
                      <p className="mt-2 text-sm text-neutral-600">
                        Los campos marcados con * son obligatorios. Puedes
                        guardar y volver más tarde.
                      </p>
                    </div>

                    <div className="mt-6 space-y-6">
                      {state.discovery.sections[activeStep].questions.map(
                        (question) => (
                          <DiscoveryQuestionField
                            key={question.id}
                            question={question}
                            value={drafts[question.id] ?? null}
                            disabled={isBusy}
                            onChange={(value) => {
                              setDrafts((current) => ({
                                ...current,
                                [question.id]: value,
                              }));
                              setFeedback(null);
                              setOperationError(null);
                            }}
                          />
                        ),
                      )}
                    </div>

                    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-neutral-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        disabled={isBusy || activeStep === 0}
                        onClick={() => void handleMove("previous")}
                        className="inline-flex h-11 items-center justify-center rounded-md border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-300"
                      >
                        Guardar y volver
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleMove("next")}
                        className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                      >
                        {operation === "saving"
                          ? "Guardando..."
                          : activeStep ===
                              state.discovery.sections.length - 1
                            ? "Guardar y revisar"
                            : "Guardar y continuar"}
                      </button>
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}

            {mode === "review" ? (
              <>
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
                  <h2 className="text-2xl font-semibold text-neutral-950">
                    Revisa el contexto recopilado
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">
                    Comprueba cada respuesta antes de confirmar. Puedes volver
                    a cualquier sección para editarla.
                  </p>
                  {state.discovery.progress.missingRequiredQuestionIds.length >
                  0 ? (
                    <p className="mt-4 rounded-md border border-red-200 bg-white p-3 text-sm font-medium text-red-700">
                      Faltan{" "}
                      {
                        state.discovery.progress
                          .missingRequiredQuestionIds.length
                      }{" "}
                      respuestas obligatorias. Están resaltadas abajo.
                    </p>
                  ) : (
                    <p className="mt-4 rounded-md border border-emerald-200 bg-white p-3 text-sm font-medium text-emerald-800">
                      Todas las preguntas obligatorias están respondidas.
                    </p>
                  )}
                </section>

                <ReviewSummary
                  discovery={state.discovery}
                  drafts={drafts}
                  disabled={isBusy}
                  completed={false}
                  onEdit={(step) => void handleEdit(step)}
                />

                <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-neutral-950">
                      Confirmar contexto
                    </h2>
                    <p className="mt-1 text-sm text-neutral-600">
                      La futura fase de IA utilizará este contexto confirmado.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      isBusy ||
                      state.discovery.progress.missingRequiredQuestionIds
                        .length > 0
                    }
                    onClick={() => void handleComplete()}
                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                  >
                    {operation === "completing"
                      ? "Confirmando..."
                      : "Confirmar contexto"}
                  </button>
                </section>
              </>
            ) : null}

            {mode === "completed" ? (
              <>
                <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 sm:p-8">
                  <p className="text-sm font-semibold text-emerald-800">
                    Descubrimiento completado
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-neutral-950">
                    El contexto está listo
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-700">
                    La información quedó confirmada y preparada para una futura
                    fase de análisis con inteligencia artificial. Este
                    incremento no genera propuestas ni llama a proveedores de
                    IA.
                  </p>
                </section>

                <ReviewSummary
                  discovery={state.discovery}
                  drafts={drafts}
                  disabled
                  completed
                  onEdit={() => undefined}
                />
              </>
            ) : null}

            <div aria-live="polite">
              {feedback ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
                  {feedback}
                </p>
              ) : null}
              {operationError ? (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
                  {operationError} Tus respuestas escritas permanecen en el
                  formulario.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
