"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  formatLanguageDate,
  formatLanguageLessonTitle,
  LANGUAGE_LESSON_SOURCE_OPTIONS,
  type LanguageLesson,
  type LanguageLessonSource,
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
  const [creating, setCreating] = useState(false);
  const [lessonSource, setLessonSource] =
    useState<LanguageLessonSource>("free");

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
    setCreating(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lessonSource }),
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
        return;
      }
      router.push(`/languages/${projectId}/lessons/${result.lesson.id}`);
    } catch {
      setActionError("No se pudo crear la lección.");
    } finally {
      setCreating(false);
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

  return (
    <main className="flow-shell language-shell">
      <article className="flow-card language-card" aria-labelledby="language-project-title">
        <p className="brand">MemoOS · Idiomas</p>
        <Link className="back-link" href="/languages">Volver a Idiomas</Link>
        <header className="language-heading">
          <h1 id="language-project-title">{project.language} — {project.level}</h1>
        </header>
        <form
          className="lesson-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createLesson();
          }}
        >
          <fieldset className="lesson-source-fieldset">
            <legend>Procedencia de la lección</legend>
            <div className="lesson-source-options">
              {LANGUAGE_LESSON_SOURCE_OPTIONS.map((option) => (
                <label className="lesson-source-option" key={option.value}>
                  <input
                    checked={lessonSource === option.value}
                    name="lesson-source"
                    type="radio"
                    value={option.value}
                    onChange={() => setLessonSource(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={creating}>
            {creating ? "Creando…" : "Crear lección"}
          </button>
        </form>
        {actionError ? <p className="form-error language-error" role="alert">{actionError}</p> : null}
        <section className="language-lessons" aria-labelledby="lessons-title">
          <h2 id="lessons-title">Lecciones</h2>
          {lessons.length === 0 ? (
            <div className="empty-state">
              <h3>Aún no hay lecciones</h3>
              <p>Crea la primera para añadir material.</p>
            </div>
          ) : (
            <div className="lesson-list">
              {lessons.map((lesson) => (
                <Link
                  className="language-list-card"
                  href={`/languages/${project.id}/lessons/${lesson.id}`}
                  key={lesson.id}
                >
                  <strong>
                    {formatLanguageLessonTitle(lesson, project.language)}
                  </strong>
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
