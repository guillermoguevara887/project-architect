"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  LanguageLesson,
  LanguageProject,
  StructuredLanguageLesson,
} from "@/lib/languages";
import { useSessionGuard } from "@/lib/use-session-guard";

const SOURCE_CONTENT_MAX_LENGTH = 100_000;

type LessonSectionKey =
  | "vocabulary"
  | "phrases"
  | "patterns"
  | "miniStory"
  | "automaticThoughts"
  | "dialogue"
  | "nextLevelBridge"
  | "review";

function LessonSection({
  sectionKey,
  title,
  copied,
  onCopy,
  children,
}: {
  sectionKey: LessonSectionKey;
  title: string;
  copied: boolean;
  onCopy: (sectionKey: LessonSectionKey) => void;
  children: ReactNode;
}) {
  return (
    <section className="lesson-section" aria-labelledby={`${sectionKey}-title`}>
      <header className="lesson-section-header">
        <h2 id={`${sectionKey}-title`}>{title}</h2>
        <button
          className="copy-button"
          type="button"
          onClick={() => onCopy(sectionKey)}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </header>
      <div className="lesson-section-content">{children}</div>
    </section>
  );
}

function sectionText(
  lesson: StructuredLanguageLesson,
  sectionKey: LessonSectionKey,
) {
  switch (sectionKey) {
    case "vocabulary":
      return lesson.vocabulary
        .map(({ term, meaning, example }) =>
          [term, meaning, example].filter(Boolean).join("\n"),
        )
        .join("\n\n");
    case "phrases":
      return lesson.phrases
        .map(({ text, translation, note }) =>
          [text, translation, note].filter(Boolean).join("\n"),
        )
        .join("\n\n");
    case "patterns":
      return lesson.patterns
        .map(({ name, explanation, examples }) =>
          [name, explanation, ...examples].join("\n"),
        )
        .join("\n\n");
    case "miniStory":
      return lesson.miniStory.text;
    case "automaticThoughts":
      return lesson.automaticThoughts
        .map(({ text }, index) => `${index + 1}. ${text}`)
        .join("\n");
    case "dialogue":
      return lesson.dialogue
        .map(({ speaker, text }) => `${speaker}: ${text}`)
        .join("\n");
    case "nextLevelBridge":
      return lesson.nextLevelBridge
        .map(
          ({ base, advanced, note }) =>
            `Base: ${base}\nMás natural / avanzado: ${advanced}\nNota: ${note}`,
        )
        .join("\n\n");
    case "review":
      return [
        "Vocabulario clave:",
        ...lesson.review.keyVocabulary.map((item) => `- ${item}`),
        "",
        "Patrones clave:",
        ...lesson.review.keyPatterns.map((item) => `- ${item}`),
      ].join("\n");
  }
}

function ReadyLesson({
  content,
  copiedSection,
  onCopy,
}: {
  content: StructuredLanguageLesson;
  copiedSection: LessonSectionKey | null;
  onCopy: (sectionKey: LessonSectionKey) => void;
}) {
  return (
    <div className="lesson-sections">
      <LessonSection
        sectionKey="vocabulary"
        title="Vocabulario"
        copied={copiedSection === "vocabulary"}
        onCopy={onCopy}
      >
        <div className="lesson-item-list">
          {content.vocabulary.map((item, index) => (
            <article className="lesson-item" key={`${item.term}-${index}`}>
              <h3>{item.term}</h3>
              <p>{item.meaning}</p>
              {item.example ? <em>{item.example}</em> : null}
            </article>
          ))}
        </div>
      </LessonSection>

      <LessonSection
        sectionKey="phrases"
        title="Frases"
        copied={copiedSection === "phrases"}
        onCopy={onCopy}
      >
        <div className="lesson-item-list">
          {content.phrases.map((item, index) => (
            <article className="lesson-item" key={`${item.text}-${index}`}>
              <h3>{item.text}</h3>
              <p>{item.translation}</p>
              {item.note ? <small>{item.note}</small> : null}
            </article>
          ))}
        </div>
      </LessonSection>

      <LessonSection
        sectionKey="patterns"
        title="Patrones"
        copied={copiedSection === "patterns"}
        onCopy={onCopy}
      >
        <div className="lesson-item-list">
          {content.patterns.map((pattern, index) => (
            <article className="lesson-item" key={`${pattern.name}-${index}`}>
              <h3>{pattern.name}</h3>
              <p>{pattern.explanation}</p>
              <ul>
                {pattern.examples.map((example, exampleIndex) => (
                  <li key={`${example}-${exampleIndex}`}>{example}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </LessonSection>

      <LessonSection
        sectionKey="miniStory"
        title="Mini historia"
        copied={copiedSection === "miniStory"}
        onCopy={onCopy}
      >
        <p className="lesson-reading-text">{content.miniStory.text}</p>
      </LessonSection>

      <LessonSection
        sectionKey="automaticThoughts"
        title="Pensamientos automáticos"
        copied={copiedSection === "automaticThoughts"}
        onCopy={onCopy}
      >
        <ol className="lesson-numbered-list">
          {content.automaticThoughts.map((thought, index) => (
            <li key={`${thought.text}-${index}`}>{thought.text}</li>
          ))}
        </ol>
      </LessonSection>

      <LessonSection
        sectionKey="dialogue"
        title="Diálogo"
        copied={copiedSection === "dialogue"}
        onCopy={onCopy}
      >
        <div className="lesson-dialogue">
          {content.dialogue.map((line, index) => (
            <p key={`${line.speaker}-${index}`}>
              <strong>{line.speaker}:</strong> {line.text}
            </p>
          ))}
        </div>
      </LessonSection>

      <LessonSection
        sectionKey="nextLevelBridge"
        title="Puente al siguiente nivel"
        copied={copiedSection === "nextLevelBridge"}
        onCopy={onCopy}
      >
        <div className="lesson-bridge-list">
          {content.nextLevelBridge.map((bridge, index) => (
            <article className="lesson-bridge" key={`${bridge.base}-${index}`}>
              <div>
                <span>Base</span>
                <p>{bridge.base}</p>
              </div>
              <div>
                <span>Más natural / avanzado</span>
                <p>{bridge.advanced}</p>
              </div>
              <div>
                <span>Nota</span>
                <p>{bridge.note}</p>
              </div>
            </article>
          ))}
        </div>
      </LessonSection>

      <LessonSection
        sectionKey="review"
        title="Repaso"
        copied={copiedSection === "review"}
        onCopy={onCopy}
      >
        <div className="lesson-review-grid">
          <div>
            <h3>Vocabulario clave</h3>
            <ul>
              {content.review.keyVocabulary.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Patrones clave</h3>
            <ul>
              {content.review.keyPatterns.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </LessonSection>
    </div>
  );
}

export function LanguageLessonScreen({
  projectId,
  lessonId,
}: {
  projectId: string;
  lessonId: string;
}) {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [project, setProject] = useState<LanguageProject | null>(null);
  const [lesson, setLesson] = useState<LanguageLesson | null>(null);
  const [sourceContent, setSourceContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedSection, setCopiedSection] =
    useState<LessonSectionKey | null>(null);

  useEffect(() => {
    if (!authorized) return;
    let active = true;

    async function loadLesson() {
      try {
        const encodedProjectId = encodeURIComponent(projectId);
        const encodedLessonId = encodeURIComponent(lessonId);
        const [projectResponse, lessonResponse] = await Promise.all([
          fetch(`/api/languages/projects/${encodedProjectId}`, {
            cache: "no-store",
            credentials: "include",
          }),
          fetch(
            `/api/languages/projects/${encodedProjectId}/lessons/${encodedLessonId}`,
            { cache: "no-store", credentials: "include" },
          ),
        ]);

        if (projectResponse.status === 401 || lessonResponse.status === 401) {
          router.replace("/");
          return;
        }

        const projectResult = (await projectResponse.json()) as {
          project?: LanguageProject;
        };
        const lessonResult = (await lessonResponse.json()) as {
          lesson?: LanguageLesson;
        };

        if (
          !projectResponse.ok ||
          !lessonResponse.ok ||
          !projectResult.project ||
          !lessonResult.lesson
        ) {
          throw new Error("Language lesson unavailable");
        }

        if (active) {
          setProject(projectResult.project);
          setLesson(lessonResult.lesson);
          setSourceContent(lessonResult.lesson.sourceContent ?? "");
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

  useEffect(() => {
    if (!authorized || lesson?.status !== "processing" || processing) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}`,
          { cache: "no-store", credentials: "include" },
        );
        const result = (await response.json()) as { lesson?: LanguageLesson };

        if (response.ok && result.lesson) {
          setLesson(result.lesson);
          setSourceContent(result.lesson.sourceContent ?? "");
        }
      } catch {
        // Keep the persisted processing state visible until a later poll succeeds.
      }
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [authorized, lesson?.status, lessonId, processing, projectId]);

  async function processLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (processing) return;

    setProcessing(true);
    setActionError(null);
    setLesson((current) =>
      current ? { ...current, status: "processing" } : current,
    );

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/process`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceContent }),
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
        setLesson((current) =>
          current ? { ...current, status: "failed" } : current,
        );
        setActionError(
          result.message ?? "No se pudo procesar la lección. Intenta nuevamente.",
        );
        return;
      }

      setLesson(result.lesson);
      setSourceContent("");
    } catch {
      setLesson((current) =>
        current ? { ...current, status: "failed" } : current,
      );
      setActionError("No se pudo procesar la lección. Intenta nuevamente.");
    } finally {
      setProcessing(false);
    }
  }

  async function deleteLesson() {
    if (
      !window.confirm(
        "¿Eliminar esta lección? Esta acción no se puede deshacer.",
      )
    ) {
      return;
    }

    setDeleting(true);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}`,
        { method: "DELETE", credentials: "include" },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (!response.ok) {
        setActionError("No se pudo eliminar la lección.");
        return;
      }

      router.push(`/languages/${projectId}`);
      router.refresh();
    } catch {
      setActionError("No se pudo eliminar la lección.");
    } finally {
      setDeleting(false);
    }
  }

  async function copySection(sectionKey: LessonSectionKey) {
    if (!lesson?.structuredContent) return;

    try {
      await navigator.clipboard.writeText(
        sectionText(lesson.structuredContent, sectionKey),
      );
      setCopiedSection(sectionKey);
      window.setTimeout(() => {
        setCopiedSection((current) =>
          current === sectionKey ? null : current,
        );
      }, 1_500);
    } catch {
      setActionError("No se pudo copiar esta sección.");
    }
  }

  if (!authorized || (!lesson && !loadError)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando lección…</p>
      </main>
    );
  }

  if (loadError || !project || !lesson) {
    return (
      <main className="flow-shell">
        <section className="flow-card">
          <p className="brand">MemoOS · Idiomas</p>
          <p className="form-error" role="alert">
            {loadError}
          </p>
          <Link className="primary-link" href={`/languages/${projectId}`}>
            Volver al idioma
          </Link>
        </section>
      </main>
    );
  }

  const readyContent =
    lesson.status === "ready" ? lesson.structuredContent : null;

  return (
    <main className="flow-shell language-shell">
      <article
        className="flow-card language-lesson-card"
        aria-labelledby="lesson-title"
      >
        <p className="brand">MemoOS · Idiomas</p>
        <Link className="back-link" href={`/languages/${project.id}`}>
          Volver a {project.language}
        </Link>
        <h1 id="lesson-title">Lección {lesson.lessonNumber}</h1>

        {lesson.status === "processing" ? (
          <section className="lesson-processing" aria-live="polite">
            <strong>Procesando lección…</strong>
            <p>
              MemoOS está organizando el material en las ocho secciones.
            </p>
          </section>
        ) : null}

        {lesson.status !== "ready" && lesson.status !== "processing" ? (
          <form className="lesson-form" onSubmit={processLesson}>
            <label htmlFor="source-content">Material de la lección</label>
            <textarea
              id="source-content"
              value={sourceContent}
              onChange={(event) => setSourceContent(event.target.value)}
              maxLength={SOURCE_CONTENT_MAX_LENGTH}
              rows={18}
              required
              placeholder="Pega aquí el material de la lección."
            />
            <small className="lesson-input-limit">
              Máximo {SOURCE_CONTENT_MAX_LENGTH.toLocaleString("es")} caracteres.
            </small>
            {actionError ? (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            ) : null}
            <button type="submit" disabled={processing || !sourceContent.trim()}>
              {processing ? "Procesando lección…" : "Procesar lección"}
            </button>
          </form>
        ) : null}

        {lesson.status === "ready" && readyContent ? (
          <ReadyLesson
            content={readyContent}
            copiedSection={copiedSection}
            onCopy={(sectionKey) => void copySection(sectionKey)}
          />
        ) : null}

        {lesson.status === "ready" && !readyContent ? (
          <p className="form-error lesson-ready-error" role="alert">
            No se pudo mostrar el contenido estructurado de esta lección.
          </p>
        ) : null}

        {lesson.status === "ready" && actionError ? (
          <p className="form-error lesson-action-error" role="alert">
            {actionError}
          </p>
        ) : null}

        <footer className="lesson-footer-actions">
          <button
            className="lesson-delete-button"
            type="button"
            disabled={deleting || processing}
            onClick={() => void deleteLesson()}
          >
            {deleting ? "Eliminando…" : "Eliminar lección"}
          </button>
        </footer>
      </article>
    </main>
  );
}
