"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  createLanguageLessonSubmissionGuard,
  filterLanguageLessons,
  formatLanguageDate,
  formatLanguageLessonTitle,
  INITIAL_LANGUAGE_LESSON_CREATION_STATE,
  LANGUAGE_LESSON_FILTER_OPTIONS,
  LANGUAGE_LESSON_SOURCE_OPTIONS,
  languageLessonCreationRequest,
  languageLessonCreationReducer,
  languageLessonFilterEmptyMessage,
  languageLessonSubtitle,
  orderLanguageLessonsPedagogically,
  type LanguageLesson,
  type LanguageLessonFilter,
  type LanguageProject,
} from "@/lib/languages";
import { useSessionGuard } from "@/lib/use-session-guard";

export function LanguageProjectScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [project, setProject] = useState<LanguageProject | null>(null);
  const [lessons, setLessons] = useState<LanguageLesson[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creation, dispatchCreation] = useReducer(
    languageLessonCreationReducer,
    INITIAL_LANGUAGE_LESSON_CREATION_STATE,
  );
  const creationSubmissionGuard = useRef(
    createLanguageLessonSubmissionGuard(),
  );
  const [lessonFilter, setLessonFilter] =
    useState<LanguageLessonFilter>("all");
  const creating = creation.status === "creating";
  const creationRequest = languageLessonCreationRequest(creation);

  useEffect(() => {
    if (!authorized) return;
    let active = true;

    async function loadProject() {
      try {
        const encodedProjectId = encodeURIComponent(projectId);
        const [projectResponse, lessonsResponse] = await Promise.all([
          fetch(`/api/languages/projects/${encodedProjectId}`, {
            cache: "no-store",
            credentials: "include",
          }),
          fetch(`/api/languages/projects/${encodedProjectId}/lessons`, {
            cache: "no-store",
            credentials: "include",
          }),
        ]);
        if (projectResponse.status === 401 || lessonsResponse.status === 401) {
          router.replace("/");
          return;
        }
        const projectResult = (await projectResponse.json()) as {
          project?: LanguageProject;
        };
        const lessonsResult = (await lessonsResponse.json()) as {
          lessons?: LanguageLesson[];
        };
        if (
          !projectResponse.ok ||
          !lessonsResponse.ok ||
          !projectResult.project ||
          !lessonsResult.lessons
        ) {
          throw new Error("Language project unavailable");
        }
        if (active) {
          setProject(projectResult.project);
          setLessons(lessonsResult.lessons);
        }
      } catch {
        if (active) setLoadError("No se pudo cargar el idioma.");
      }
    }

    void loadProject();
    return () => {
      active = false;
    };
  }, [authorized, projectId, router]);

  async function createLesson() {
    const request = languageLessonCreationRequest(creation);
    if (!request || !creationSubmissionGuard.current.start()) return;

    dispatchCreation({ type: "start" });
    setActionError(null);
    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      const result = (await response.json()) as {
        lesson?: LanguageLesson;
        message?: string;
      };
      if (!response.ok || !result.lesson) {
        setActionError(result.message ?? "No se pudo crear la lección.");
        dispatchCreation({ type: "failed" });
        return;
      }
      router.push(`/languages/${projectId}/lessons/${result.lesson.id}`);
    } catch {
      setActionError("No se pudo crear la lección.");
      dispatchCreation({ type: "failed" });
    } finally {
      creationSubmissionGuard.current.finish();
    }
  }

  if (!authorized || (!project && !loadError)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando idioma…</p>
      </main>
    );
  }
  if (loadError || !project || !lessons) {
    return (
      <main className="flow-shell">
        <section className="flow-card">
          <p className="brand">MemoOS · Idiomas</p>
          <p className="form-error" role="alert">{loadError}</p>
          <Link className="primary-link" href="/languages">Volver a Idiomas</Link>
        </section>
      </main>
    );
  }

  const filteredLessons = orderLanguageLessonsPedagogically(
    filterLanguageLessons(lessons, lessonFilter),
  );

  return (
    <main className="flow-shell language-shell">
      <article className="flow-card language-card" aria-labelledby="language-project-title">
        <p className="brand">MemoOS · Idiomas</p>
        <Link className="back-link" href="/languages">Volver a Idiomas</Link>
        <header className="language-heading">
          <h1 id="language-project-title">{project.language} — {project.level}</h1>
        </header>
        {creation.status === "closed" ? (
          <div className="lesson-create-launch">
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                dispatchCreation({ type: "open" });
              }}
            >
              Crear lección
            </button>
          </div>
        ) : (
          <form
            className="lesson-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createLesson();
            }}
          >
            <fieldset className="lesson-source-fieldset" disabled={creating}>
              <legend>¿De dónde viene esta lección?</legend>
              <div className="lesson-source-options">
                {LANGUAGE_LESSON_SOURCE_OPTIONS.map((option) => (
                  <label className="lesson-source-option" key={option.value}>
                    <input
                      checked={creation.lessonSource === option.value}
                      name="lesson-source"
                      type="radio"
                      value={option.value}
                      onChange={() =>
                        dispatchCreation({
                          type: "select-source",
                          lessonSource: option.value,
                        })
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {creation.lessonSource === "assimil" ? (
              <div>
                <label htmlFor="assimil-source-lesson-number">
                  Número de lección Assimil
                </label>
                <input
                  aria-describedby="assimil-source-lesson-number-help"
                  disabled={creating}
                  id="assimil-source-lesson-number"
                  max={9999}
                  min={1}
                  placeholder="15"
                  step={1}
                  type="number"
                  value={creation.assimilSourceLessonNumber}
                  onChange={(event) =>
                    dispatchCreation({
                      type: "set-assimil-source-lesson-number",
                      value: event.target.value,
                    })
                  }
                />
                <small id="assimil-source-lesson-number-help">
                  Usa el número real del curso o libro Assimil.
                </small>
              </div>
            ) : null}
            <div className="lesson-create-actions">
              <button type="submit" disabled={creating || !creationRequest}>
                {creating ? "Creando…" : "Continuar"}
              </button>
              <button
                className="secondary-button"
                disabled={creating}
                type="button"
                onClick={() => {
                  setActionError(null);
                  dispatchCreation({ type: "cancel" });
                }}
              >
                Cancelar
              </button>
            </div>
            {actionError ? (
              <p className="form-error language-error" role="alert">
                {actionError}
              </p>
            ) : null}
          </form>
        )}
        <section className="language-lessons" aria-labelledby="lessons-title">
          <h2 id="lessons-title">Lecciones</h2>
          <div
            aria-label="Filtrar lecciones por procedencia"
            className="lesson-filters"
            role="group"
          >
            {LANGUAGE_LESSON_FILTER_OPTIONS.map((option) => (
              <button
                aria-pressed={lessonFilter === option.value}
                className="lesson-filter-button"
                key={option.value}
                type="button"
                onClick={() => setLessonFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {filteredLessons.length === 0 ? (
            <div className="empty-state">
              <h3>{languageLessonFilterEmptyMessage(lessonFilter)}</h3>
              <p>
                {lessons.length === 0
                  ? "Crea la primera para añadir material."
                  : "Selecciona otro filtro o crea una nueva lección."}
              </p>
            </div>
          ) : (
            <div className="lesson-list">
              {filteredLessons.map((lesson) => (
                <Link
                  className={`language-list-card${
                    lesson.splitPart ? " language-list-card-child" : ""
                  }`}
                  href={`/languages/${project.id}/lessons/${lesson.id}`}
                  key={lesson.id}
                >
                  <span className="language-list-card-title">
                    <strong>
                      {formatLanguageLessonTitle(lesson, project.language)}
                    </strong>
                    {lesson.splitPart ? (
                      <small>Parte {lesson.splitPart}</small>
                    ) : languageLessonSubtitle(lesson) ? (
                      <small>{languageLessonSubtitle(lesson)}</small>
                    ) : null}
                  </span>
                  <time dateTime={lesson.createdAt}>{formatLanguageDate(lesson.createdAt)}</time>
                </Link>
              ))}
            </div>
          )}
        </section>
      </article>
    </main>
  );
}
