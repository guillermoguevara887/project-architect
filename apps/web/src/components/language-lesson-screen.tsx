"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { LanguageLesson, LanguageProject } from "@/lib/languages";
import { useSessionGuard } from "@/lib/use-session-guard";

export function LanguageLessonScreen({ projectId, lessonId }: { projectId: string; lessonId: string }) {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [project, setProject] = useState<LanguageProject | null>(null);
  const [lesson, setLesson] = useState<LanguageLesson | null>(null);
  const [sourceContent, setSourceContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authorized) return;
    let active = true;

    async function loadLesson() {
      try {
        const encodedProjectId = encodeURIComponent(projectId);
        const encodedLessonId = encodeURIComponent(lessonId);
        const [projectResponse, lessonResponse] = await Promise.all([
          fetch(`/api/languages/projects/${encodedProjectId}`, { cache: "no-store", credentials: "include" }),
          fetch(`/api/languages/projects/${encodedProjectId}/lessons/${encodedLessonId}`, { cache: "no-store", credentials: "include" }),
        ]);
        if (projectResponse.status === 401 || lessonResponse.status === 401) {
          router.replace("/");
          return;
        }
        const projectResult = (await projectResponse.json()) as { project?: LanguageProject };
        const lessonResult = (await lessonResponse.json()) as { lesson?: LanguageLesson };
        if (!projectResponse.ok || !lessonResponse.ok || !projectResult.project || !lessonResult.lesson) {
          throw new Error("Language lesson unavailable");
        }
        if (active) {
          setProject(projectResult.project);
          setLesson(lessonResult.lesson);
          setSourceContent(lessonResult.lesson.sourceContent);
        }
      } catch {
        if (active) setLoadError("No se pudo cargar la lección.");
      }
    }

    void loadLesson();
    return () => {
      active = false;
    };
  }, [authorized, lessonId, projectId, router]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceContent }),
        },
      );
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      const result = (await response.json()) as { lesson?: LanguageLesson; message?: string };
      if (!response.ok || !result.lesson) {
        setSaveError(result.message ?? "No se pudo guardar el material.");
        return;
      }
      setLesson(result.lesson);
      setSourceContent(result.lesson.sourceContent);
      setSaved(true);
    } catch {
      setSaveError("No se pudo guardar el material.");
    } finally {
      setSaving(false);
    }
  }

  if (!authorized || (!lesson && !loadError)) {
    return <main className="flow-shell"><p className="loading-message">Cargando lección…</p></main>;
  }
  if (loadError || !project || !lesson) {
    return (
      <main className="flow-shell">
        <section className="flow-card">
          <p className="brand">MemoOS · Idiomas</p>
          <p className="form-error" role="alert">{loadError}</p>
          <Link className="primary-link" href={`/languages/${projectId}`}>Volver al idioma</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flow-shell language-shell">
      <article className="flow-card language-lesson-card" aria-labelledby="lesson-title">
        <p className="brand">MemoOS · Idiomas</p>
        <Link className="back-link" href={`/languages/${project.id}`}>Volver a {project.language}</Link>
        <h1 id="lesson-title">Lección {lesson.lessonNumber}</h1>
        <form className="lesson-form" onSubmit={save}>
          <label htmlFor="source-content">Material de la lección</label>
          <textarea
            id="source-content"
            value={sourceContent}
            onChange={(event) => {
              setSourceContent(event.target.value);
              setSaved(false);
            }}
            maxLength={1_000_000}
            rows={18}
            placeholder="Pega aquí el material de la lección."
          />
          {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
          {saved ? <p className="save-confirmation" role="status">Material guardado.</p> : null}
          <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
        </form>
      </article>
    </main>
  );
}
