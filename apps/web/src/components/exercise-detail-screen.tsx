"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  EXERCISE_STATUSES,
  EXERCISE_STATUS_LABELS,
  EXERCISE_WORKSPACE_LABELS,
  EXERCISE_WORKSPACE_TYPES,
  type Exercise,
  type ExerciseStatus,
  type ExerciseWorkspaceType,
} from "@/lib/exercises";
import { useSessionGuard } from "@/lib/use-session-guard";
import { ExerciseGuide } from "./exercise-guide";

type ExerciseTab = "exercise" | "guide" | "steps";

const tabs: Array<{ id: ExerciseTab; label: string }> = [
  { id: "exercise", label: "Ejercicio" },
  { id: "guide", label: "Guía" },
  { id: "steps", label: "Pasos sugeridos" },
];

export function ExerciseDetailScreen({ exerciseId }: { exerciseId: string }) {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ExerciseTab>("exercise");
  const [editing, setEditing] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [generating, setGenerating] = useState<"guide" | "steps" | null>(null);
  const [workspaceType, setWorkspaceType] = useState<
    ExerciseWorkspaceType | ""
  >("");
  const [workspaceValue, setWorkspaceValue] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    let active = true;

    async function loadExercise() {
      try {
        const response = await fetch(
          `/api/exercises/${encodeURIComponent(exerciseId)}`,
          { cache: "no-store", credentials: "include" },
        );

        if (response.status === 401) {
          router.replace("/");
          return;
        }

        const result = (await response.json()) as {
          exercise?: Exercise;
        };

        if (!response.ok || !result.exercise) {
          throw new Error("Exercise unavailable");
        }

        if (active) {
          setExercise(result.exercise);
          setWorkspaceType(result.exercise.workspaceType ?? "");
          setWorkspaceValue(result.exercise.workspaceValue ?? "");
        }
      } catch {
        if (active) {
          setLoadError("No se pudo cargar el ejercicio.");
        }
      }
    }

    void loadExercise();

    return () => {
      active = false;
    };
  }, [authorized, exerciseId, router]);

  async function updateDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingDetails(true);
    setActionError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(
        `/api/exercises/${encodeURIComponent(exerciseId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: form.get("title"),
            sourceName: form.get("sourceName"),
            chapter: form.get("chapter"),
            exerciseNumber: form.get("exerciseNumber"),
            prompt: form.get("prompt"),
          }),
        },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        exercise?: Exercise;
        message?: string;
      };

      if (!response.ok || !result.exercise) {
        setActionError(result.message ?? "No se pudo actualizar el ejercicio.");
        return;
      }

      setExercise(result.exercise);
      setEditing(false);
    } catch {
      setActionError("No se pudo actualizar el ejercicio.");
    } finally {
      setSavingDetails(false);
    }
  }

  async function changeStatus(event: ChangeEvent<HTMLSelectElement>) {
    const status = event.target.value as ExerciseStatus;
    setSavingStatus(true);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/exercises/${encodeURIComponent(exerciseId)}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        exercise?: Exercise;
        message?: string;
      };

      if (!response.ok || !result.exercise) {
        setActionError(result.message ?? "No se pudo cambiar el estado.");
        return;
      }

      setExercise(result.exercise);
    } catch {
      setActionError("No se pudo cambiar el estado.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingWorkspace(true);
    setActionError(null);

    const payload = workspaceType
      ? { workspaceType, workspaceValue }
      : { workspaceType: null, workspaceValue: null };

    try {
      const response = await fetch(
        `/api/exercises/${encodeURIComponent(exerciseId)}/workspace`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        exercise?: Exercise;
        message?: string;
      };

      if (!response.ok || !result.exercise) {
        setActionError(
          result.message ?? "No se pudo guardar el espacio de trabajo.",
        );
        return;
      }

      setExercise(result.exercise);
      setWorkspaceType(result.exercise.workspaceType ?? "");
      setWorkspaceValue(result.exercise.workspaceValue ?? "");
    } catch {
      setActionError("No se pudo guardar el espacio de trabajo.");
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function generate(kind: "guide" | "steps") {
    setGenerating(kind);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/exercises/${encodeURIComponent(exerciseId)}/${kind}`,
        { method: "POST", credentials: "include" },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        error?: string;
        exercise?: Exercise;
        message?: string;
      };

      if (!response.ok || !result.exercise) {
        if (
          kind === "guide" &&
          result.error === "EXERCISE_GUIDE_LIMIT_REACHED" &&
          result.exercise
        ) {
          setExercise(result.exercise);
        }

        setActionError(
          result.message ??
            (kind === "guide"
              ? "No se pudo generar la guía."
              : "No se pudieron generar los pasos."),
        );
        return;
      }

      setExercise(result.exercise);
    } catch {
      setActionError(
        kind === "guide"
          ? "No se pudo generar la guía."
          : "No se pudieron generar los pasos.",
      );
    } finally {
      setGenerating(null);
    }
  }

  async function copyLocalPath() {
    if (!exercise?.workspaceValue) {
      return;
    }

    try {
      await navigator.clipboard.writeText(exercise.workspaceValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setActionError("No se pudo copiar la ruta.");
    }
  }

  if (!authorized || (!exercise && !loadError)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando ejercicio…</p>
      </main>
    );
  }

  if (loadError || !exercise) {
    return (
      <main className="flow-shell">
        <section className="flow-card">
          <p className="brand">MemoOS · Ejercicios</p>
          <p className="form-error" role="alert">
            {loadError}
          </p>
          <Link className="primary-link" href="/exercises">
            Volver a Ejercicios
          </Link>
        </section>
      </main>
    );
  }

  const workspacePlaceholder =
    workspaceType === "local"
      ? "C:\\Users\\usuario\\proyecto\\ejercicio.py"
      : workspaceType === "colab"
        ? "https://colab.research.google.com/drive/…"
        : "https://…";
  const hasGuide = Boolean(
    exercise.guideStructuredContent || exercise.guideContent,
  );
  const guideLimitReached = exercise.guideGenerationCount >= 2;

  return (
    <main className="flow-shell exercises-shell">
      <article
        className="flow-card exercise-detail-card"
        aria-labelledby="exercise-title"
      >
        <p className="brand">MemoOS · Ejercicios</p>
        <Link className="back-link" href="/exercises">
          Volver a Ejercicios
        </Link>

        <header className="exercise-detail-heading">
          <div>
            <p className="section-kicker">
              {exercise.sourceName ?? "Ejercicio guardado"}
            </p>
            <h1 id="exercise-title">{exercise.title}</h1>
          </div>
          <label className="exercise-status-control">
            <span>Estado</span>
            <select
              value={exercise.status}
              onChange={(event) => void changeStatus(event)}
              disabled={savingStatus}
            >
              {EXERCISE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {EXERCISE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="exercise-tabs" role="tablist" aria-label="Ejercicio">
          {tabs.map((tab) => (
            <button
              id={`exercise-tab-${tab.id}`}
              key={tab.id}
              type="button"
              role="tab"
              aria-controls={`exercise-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setActionError(null);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {actionError ? (
          <p className="form-error exercise-action-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {activeTab === "exercise" ? (
          <div
            id="exercise-panel-exercise"
            role="tabpanel"
            aria-labelledby="exercise-tab-exercise"
            className="exercise-panel"
          >
            <section className="exercise-section" aria-labelledby="statement-title">
              <div className="exercise-section-heading">
                <h2 id="statement-title">Ejercicio</h2>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing ? "Cancelar" : "Editar"}
                </button>
              </div>

              {editing ? (
                <form
                  className="exercise-form exercise-edit-form"
                  key={exercise.updatedAt}
                  onSubmit={updateDetails}
                >
                  <label htmlFor="edit-title">Título</label>
                  <input
                    id="edit-title"
                    name="title"
                    defaultValue={exercise.title}
                    maxLength={200}
                    required
                  />
                  <label htmlFor="edit-source">Libro o curso</label>
                  <input
                    id="edit-source"
                    name="sourceName"
                    defaultValue={exercise.sourceName ?? ""}
                    maxLength={300}
                  />
                  <div className="exercise-form-row">
                    <div>
                      <label htmlFor="edit-chapter">Capítulo</label>
                      <input
                        id="edit-chapter"
                        name="chapter"
                        defaultValue={exercise.chapter ?? ""}
                        maxLength={300}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-number">Número o identificador</label>
                      <input
                        id="edit-number"
                        name="exerciseNumber"
                        defaultValue={exercise.exerciseNumber ?? ""}
                        maxLength={300}
                      />
                    </div>
                  </div>
                  <label htmlFor="edit-prompt">Enunciado</label>
                  <textarea
                    id="edit-prompt"
                    name="prompt"
                    defaultValue={exercise.prompt}
                    maxLength={100_000}
                    rows={10}
                    required
                  />
                  <button type="submit" disabled={savingDetails}>
                    {savingDetails ? "Guardando…" : "Guardar cambios"}
                  </button>
                </form>
              ) : (
                <>
                  <dl className="exercise-metadata">
                    <div>
                      <dt>Libro o curso</dt>
                      <dd>{exercise.sourceName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Capítulo</dt>
                      <dd>{exercise.chapter ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Número</dt>
                      <dd>{exercise.exerciseNumber ?? "—"}</dd>
                    </div>
                  </dl>
                  <p className="exercise-prompt">{exercise.prompt}</p>
                </>
              )}
            </section>

            <section className="exercise-section" aria-labelledby="workspace-title">
              <div className="exercise-section-heading">
                <div>
                  <p className="section-kicker">Referencia externa</p>
                  <h2 id="workspace-title">Espacio de trabajo</h2>
                </div>
                {exercise.workspaceType === "colab" &&
                exercise.workspaceValue ? (
                  <a
                    className="primary-link compact-link"
                    href={exercise.workspaceValue}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir en Colab ↗
                  </a>
                ) : null}
                {exercise.workspaceType === "url" && exercise.workspaceValue ? (
                  <a
                    className="primary-link compact-link"
                    href={exercise.workspaceValue}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir enlace ↗
                  </a>
                ) : null}
                {exercise.workspaceType === "local" &&
                exercise.workspaceValue ? (
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => void copyLocalPath()}
                  >
                    {copied ? "Ruta copiada" : "Copiar ruta"}
                  </button>
                ) : null}
              </div>

              {exercise.workspaceType && exercise.workspaceValue ? (
                <div className="workspace-current">
                  <span>{EXERCISE_WORKSPACE_LABELS[exercise.workspaceType]}</span>
                  <code>{exercise.workspaceValue}</code>
                </div>
              ) : null}

              <form className="workspace-form" onSubmit={saveWorkspace}>
                <label htmlFor="workspace-type">Tipo</label>
                <select
                  id="workspace-type"
                  value={workspaceType}
                  onChange={(event) => {
                    setWorkspaceType(
                      event.target.value as ExerciseWorkspaceType | "",
                    );
                    setWorkspaceValue("");
                  }}
                >
                  <option value="">Sin espacio guardado</option>
                  {EXERCISE_WORKSPACE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EXERCISE_WORKSPACE_LABELS[type]}
                    </option>
                  ))}
                </select>

                {workspaceType ? (
                  <>
                    <label htmlFor="workspace-value">
                      {workspaceType === "local" ? "Ruta local" : "URL"}
                    </label>
                    <input
                      id="workspace-value"
                      value={workspaceValue}
                      onChange={(event) => setWorkspaceValue(event.target.value)}
                      maxLength={4_000}
                      required
                      placeholder={workspacePlaceholder}
                      type={workspaceType === "local" ? "text" : "url"}
                    />
                  </>
                ) : null}

                <button type="submit" disabled={savingWorkspace}>
                  {savingWorkspace ? "Guardando…" : "Guardar espacio"}
                </button>
              </form>
            </section>
          </div>
        ) : null}

        {activeTab === "guide" ? (
          <section
            id="exercise-panel-guide"
            role="tabpanel"
            aria-labelledby="exercise-tab-guide"
            className="exercise-panel exercise-ai-panel"
          >
            <div className="exercise-section-heading">
              <div>
                <p className="section-kicker">Tutor, no solucionador</p>
                <h2>Guía</h2>
              </div>
              <div className="exercise-guide-actions">
                <button
                  type="button"
                  disabled={generating !== null || guideLimitReached}
                  onClick={() => void generate("guide")}
                >
                  {generating === "guide"
                    ? "Generando…"
                    : hasGuide
                      ? "Regenerar guía"
                      : "Generar guía"}
                </button>
                {exercise.guideGenerationCount === 1 ? (
                  <span>1 regeneración disponible</span>
                ) : null}
                {guideLimitReached ? (
                  <span>Límite de regeneraciones alcanzado</span>
                ) : null}
              </div>
            </div>

            {hasGuide ? (
              <ExerciseGuide
                guide={exercise.guideStructuredContent}
                legacyGuide={exercise.guideContent}
              />
            ) : (
              <div className="empty-state exercise-tab-empty">
                <h3>La guía aún no existe</h3>
                <p>
                  Pide una explicación de los conceptos y de qué conviene
                  observar mientras trabajas.
                </p>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "steps" ? (
          <section
            id="exercise-panel-steps"
            role="tabpanel"
            aria-labelledby="exercise-tab-steps"
            className="exercise-panel exercise-ai-panel"
          >
            <div className="exercise-section-heading">
              <div>
                <p className="section-kicker">Una acción a la vez</p>
                <h2>Pasos sugeridos</h2>
              </div>
              <button
                type="button"
                disabled={generating !== null}
                onClick={() => void generate("steps")}
              >
                {generating === "steps"
                  ? "Generando…"
                  : exercise.suggestedSteps
                    ? "Regenerar pasos"
                    : "Generar pasos"}
              </button>
            </div>

            {exercise.suggestedSteps ? (
              <ol className="exercise-steps-list">
                {exercise.suggestedSteps.map((step, index) => (
                  <li key={`${index}-${step}`}>{step}</li>
                ))}
              </ol>
            ) : (
              <div className="empty-state exercise-tab-empty">
                <h3>Aún no hay pasos</h3>
                <p>Genera una ruta concreta sin revelar toda la solución.</p>
              </div>
            )}
          </section>
        ) : null}
      </article>
    </main>
  );
}
