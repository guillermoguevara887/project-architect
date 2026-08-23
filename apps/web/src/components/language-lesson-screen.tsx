"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  canRegenerateLanguageLesson,
  formatLanguageLessonTitle,
  languageLessonAudioButtonLabel,
  languageLessonAudioKey,
  languageLessonAudioRequest,
  languageLessonAudioStateAfterEnd,
  languageLessonAudioToggleAction,
  languageLessonContentForVersion,
  LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS,
  playExclusiveLanguageAudio,
  stopPlayableLanguageAudio,
  type LanguageLesson,
  type LanguageLessonAudioPlayback,
  type LanguageLessonAudioSection,
  type LanguageLessonContentVersion,
  type LanguageProject,
  type StructuredLanguageLesson,
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

const LESSON_SECTION_VARIANTS = ["a", "b", "c"] as const;

function lessonSectionVariant(sectionIndex: number) {
  return LESSON_SECTION_VARIANTS[
    sectionIndex % LESSON_SECTION_VARIANTS.length
  ];
}

function BookOpenIcon() {
  return (
    <svg
      aria-hidden="true"
      className="lesson-section-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        d="M4.75 5.5A2.75 2.75 0 0 1 7.5 2.75H12v17.5H7.5a2.75 2.75 0 0 0-2.75 2.75V5.5Zm14.5 0a2.75 2.75 0 0 0-2.75-2.75H12v17.5h4.5A2.75 2.75 0 0 1 19.25 23V5.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="copy-button-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <rect
        height="10.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.5"
        width="9.5"
        x="6.5"
        y="6"
      />
      <path
        d="M13.5 6V5.25A1.75 1.75 0 0 0 11.75 3.5h-7A1.75 1.75 0 0 0 3 5.25v7A1.75 1.75 0 0 0 4.75 14h1.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      className="lesson-audio-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path
        d="M3.5 8h3L10 5v10l-3.5-3h-3V8Z"
        fill="currentColor"
      />
      <path
        d="M12.75 7.25a4 4 0 0 1 0 5.5M14.75 5.5a6.4 6.4 0 0 1 0 9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      aria-hidden="true"
      className="lesson-audio-icon lesson-audio-stop-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <rect fill="currentColor" height="7" rx="1.4" width="7" x="6.5" y="6.5" />
    </svg>
  );
}

function LessonAudioButton({
  text,
  playback,
  onPlay,
}: {
  text: string;
  playback: LanguageLessonAudioPlayback | null;
  onPlay: () => void;
}) {
  const loading = playback?.status === "loading";
  const playing = playback?.status === "playing";
  const status = playback?.status ?? "idle";

  return (
    <>
      <button
        aria-label={languageLessonAudioButtonLabel(text, status)}
        aria-pressed={playing}
        aria-busy={loading}
        className="lesson-audio-button"
        data-state={status}
        disabled={loading}
        type="button"
        onClick={onPlay}
      >
        {loading ? (
          <span aria-hidden="true" className="lesson-audio-spinner" />
        ) : playing ? (
          <StopIcon />
        ) : (
          <SpeakerIcon />
        )}
      </button>
      {playback?.status === "error" && playback.error ? (
        <small className="lesson-audio-error" role="alert">
          {playback.error}
        </small>
      ) : null}
    </>
  );
}

function LessonSection({
  sectionIndex,
  sectionKey,
  title,
  copied,
  onCopy,
  children,
}: {
  sectionIndex: number;
  sectionKey: LessonSectionKey;
  title: string;
  copied: boolean;
  onCopy: (sectionKey: LessonSectionKey) => void;
  children: ReactNode;
}) {
  const variant = lessonSectionVariant(sectionIndex);

  return (
    <section
      className={`lesson-section lesson-section-variant-${variant}`}
      data-variant={variant}
      aria-labelledby={`${sectionKey}-title`}
    >
      <header className="lesson-section-header">
        <h2 id={`${sectionKey}-title`}>
          {sectionKey === "vocabulary" ? <BookOpenIcon /> : null}
          <span>{title}</span>
        </h2>
        <button
          className="copy-button"
          type="button"
          onClick={() => onCopy(sectionKey)}
          aria-label={copied ? `${title} copiado` : `Copiar ${title}`}
        >
          <CopyIcon />
          <span>{copied ? "Copiado" : "Copiar"}</span>
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
  contentVersion,
  copiedSection,
  audioPlayback,
  onCopy,
  onPlayAudio,
}: {
  content: StructuredLanguageLesson;
  contentVersion: LanguageLessonContentVersion;
  copiedSection: LessonSectionKey | null;
  audioPlayback: LanguageLessonAudioPlayback | null;
  onCopy: (sectionKey: LessonSectionKey) => void;
  onPlayAudio: (
    section: LanguageLessonAudioSection,
    index: number,
  ) => void;
}) {
  return (
    <div className="lesson-sections">
      <LessonSection
        sectionIndex={0}
        sectionKey="vocabulary"
        title="Vocabulario"
        copied={copiedSection === "vocabulary"}
        onCopy={onCopy}
      >
        <div className="lesson-item-list">
          {content.vocabulary.map((item, index) => (
            <article className="lesson-item" key={`${item.term}-${index}`}>
              <div className="lesson-audio-heading">
                <h3>{item.term}</h3>
                <LessonAudioButton
                  text={item.term}
                  playback={
                    audioPlayback?.key ===
                    languageLessonAudioKey(contentVersion, "vocabulary", index)
                      ? audioPlayback
                      : null
                  }
                  onPlay={() => onPlayAudio("vocabulary", index)}
                />
              </div>
              <p>{item.meaning}</p>
              {item.example ? <em>{item.example}</em> : null}
            </article>
          ))}
        </div>
      </LessonSection>

      <LessonSection
        sectionIndex={1}
        sectionKey="phrases"
        title="Frases"
        copied={copiedSection === "phrases"}
        onCopy={onCopy}
      >
        <div className="lesson-item-list">
          {content.phrases.map((item, index) => (
            <article className="lesson-item" key={`${item.text}-${index}`}>
              <div className="lesson-audio-heading">
                <h3>{item.text}</h3>
                <LessonAudioButton
                  text={item.text}
                  playback={
                    audioPlayback?.key ===
                    languageLessonAudioKey(contentVersion, "phrases", index)
                      ? audioPlayback
                      : null
                  }
                  onPlay={() => onPlayAudio("phrases", index)}
                />
              </div>
              <p>{item.translation}</p>
              {item.note ? <small>{item.note}</small> : null}
            </article>
          ))}
        </div>
      </LessonSection>

      <LessonSection
        sectionIndex={2}
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
        sectionIndex={3}
        sectionKey="miniStory"
        title="Mini historia"
        copied={copiedSection === "miniStory"}
        onCopy={onCopy}
      >
        <p className="lesson-reading-text">{content.miniStory.text}</p>
      </LessonSection>

      <LessonSection
        sectionIndex={4}
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
        sectionIndex={5}
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
        sectionIndex={6}
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
        sectionIndex={7}
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
  const [simplificationAction, setSimplificationAction] = useState<
    "simplify" | "regenerate" | null
  >(null);
  const [contentVersion, setContentVersion] =
    useState<LanguageLessonContentVersion>("original");
  const [deleting, setDeleting] = useState(false);
  const [copiedSection, setCopiedSection] =
    useState<LessonSectionKey | null>(null);
  const [audioPlayback, setAudioPlayback] =
    useState<LanguageLessonAudioPlayback | null>(null);
  const audioPlaybackRef = useRef<LanguageLessonAudioPlayback | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const audioAbortControllerRef = useRef<AbortController | null>(null);
  const audioRequestIdRef = useRef(0);
  const simplifying = simplificationAction !== null;

  function updateAudioPlayback(
    playback: LanguageLessonAudioPlayback | null,
  ) {
    audioPlaybackRef.current = playback;
    setAudioPlayback(playback);
  }

  function stopLanguageAudio() {
    audioRequestIdRef.current += 1;
    audioAbortControllerRef.current?.abort();
    audioAbortControllerRef.current = null;
    stopPlayableLanguageAudio(audioElementRef.current);
    audioElementRef.current = null;

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      audioAbortControllerRef.current?.abort();
      audioElementRef.current?.pause();

      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
      }
    };
  }, []);

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
          setContentVersion("original");
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
      setContentVersion("original");
    } catch {
      setLesson((current) =>
        current ? { ...current, status: "failed" } : current,
      );
      setActionError("No se pudo procesar la lección. Intenta nuevamente.");
    } finally {
      setProcessing(false);
    }
  }

  async function simplifyLesson(regenerate = false) {
    if (simplifying) return;

    setSimplificationAction(regenerate ? "regenerate" : "simplify");
    setActionError(null);

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/simplify`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ regenerate }),
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
        setActionError(
          result.message ??
            "No se pudo simplificar la lección. Intenta nuevamente.",
        );
        return;
      }

      setLesson(result.lesson);
      setContentVersion("simplified");
      setCopiedSection(null);
    } catch {
      setActionError(
        "No se pudo simplificar la lección. Intenta nuevamente.",
      );
    } finally {
      setSimplificationAction(null);
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
    if (!lesson) return;

    const content = languageLessonContentForVersion(lesson, contentVersion);

    if (!content) return;

    try {
      await navigator.clipboard.writeText(
        sectionText(content, sectionKey),
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

  async function playLanguageAudio(
    section: LanguageLessonAudioSection,
    index: number,
  ) {
    const key = languageLessonAudioKey(contentVersion, section, index);
    const toggleAction = languageLessonAudioToggleAction(
      audioPlaybackRef.current,
      key,
    );

    if (toggleAction === "ignore") return;

    if (toggleAction === "stop") {
      stopLanguageAudio();
      updateAudioPlayback(null);
      return;
    }

    const previousAudio = audioElementRef.current;

    stopLanguageAudio();
    const requestId = audioRequestIdRef.current;
    const controller = new AbortController();
    audioAbortControllerRef.current = controller;
    updateAudioPlayback({ key, status: "loading", error: null });

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/audio`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            languageLessonAudioRequest(contentVersion, section, index),
          ),
          signal: controller.signal,
        },
      );

      if (response.status === 401) {
        stopLanguageAudio();
        updateAudioPlayback(null);
        router.replace("/");
        return;
      }

      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(
          result.message ?? "No se pudo preparar la pronunciación.",
        );
      }

      const audioUrl = URL.createObjectURL(await response.blob());

      if (requestId !== audioRequestIdRef.current) {
        URL.revokeObjectURL(audioUrl);
        return;
      }

      const audio = new Audio(audioUrl);
      audioObjectUrlRef.current = audioUrl;
      audioElementRef.current = audio;
      audio.onended = () => {
        if (audioElementRef.current === audio) {
          stopLanguageAudio();
          updateAudioPlayback(
            languageLessonAudioStateAfterEnd(audioPlaybackRef.current, key),
          );
        }
      };
      audio.onerror = () => {
        if (audioElementRef.current === audio) {
          stopLanguageAudio();
          updateAudioPlayback({
            key,
            status: "error",
            error: "No se pudo reproducir la pronunciación.",
          });
        }
      };
      await playExclusiveLanguageAudio(previousAudio, audio);

      if (requestId === audioRequestIdRef.current) {
        updateAudioPlayback({ key, status: "playing", error: null });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      if (requestId === audioRequestIdRef.current) {
        stopLanguageAudio();
        updateAudioPlayback({
          key,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "No se pudo preparar la pronunciación.",
        });
      }
    } finally {
      if (audioAbortControllerRef.current === controller) {
        audioAbortControllerRef.current = null;
      }
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
          <Link className="primary-link" href="/languages">
            Volver a Idiomas
          </Link>
        </section>
      </main>
    );
  }

  const readyContent =
    lesson.status === "ready"
      ? languageLessonContentForVersion(lesson, contentVersion)
      : null;

  return (
    <main className="flow-shell language-shell language-lesson-shell">
      <article
        className="flow-card language-lesson-card"
        aria-labelledby="lesson-title"
      >
        <header className="lesson-page-header">
          <p className="brand">MemoOS · Idiomas</p>
          <Link className="back-link lesson-back-link" href="/languages">
            <span aria-hidden="true">←</span>
            <span>Idiomas</span>
          </Link>
          <h1 id="lesson-title">
            {formatLanguageLessonTitle(lesson, project.language)}
          </h1>
        </header>

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
          <div className="lesson-simplification-controls">
            {canRegenerateLanguageLesson(lesson) ? (
              <>
                <div
                  aria-label="Versión de la lección"
                  className="lesson-version-selector"
                  role="group"
                >
                  {LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS.map((option) => (
                    <button
                      aria-pressed={contentVersion === option.value}
                      key={option.value}
                      type="button"
                      onClick={() => {
                        stopLanguageAudio();
                        updateAudioPlayback(null);
                        setContentVersion(option.value);
                        setCopiedSection(null);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="lesson-regeneration-action">
                  <button
                    className="lesson-regenerate-button"
                    disabled={simplifying}
                    type="button"
                    onClick={() => void simplifyLesson(true)}
                  >
                    {simplificationAction === "regenerate"
                      ? "Regenerando…"
                      : "Regenerar simplificación"}
                  </button>
                  <small>Vuelve a generar esta versión con IA.</small>
                </div>
              </>
            ) : (
              <button
                className="lesson-simplify-button"
                disabled={simplifying}
                type="button"
                onClick={() => void simplifyLesson()}
              >
                {simplificationAction === "simplify"
                  ? "Simplificando…"
                  : "Simplificar lección"}
              </button>
            )}
          </div>
        ) : null}

        {lesson.status === "ready" && actionError ? (
          <p className="form-error lesson-action-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {lesson.status === "ready" && readyContent ? (
          <ReadyLesson
            content={readyContent}
            contentVersion={contentVersion}
            copiedSection={copiedSection}
            audioPlayback={audioPlayback}
            onCopy={(sectionKey) => void copySection(sectionKey)}
            onPlayAudio={(section, index) =>
              void playLanguageAudio(section, index)
            }
          />
        ) : null}

        {lesson.status === "ready" && !readyContent ? (
          <p className="form-error lesson-ready-error" role="alert">
            No se pudo mostrar el contenido estructurado de esta lección.
          </p>
        ) : null}

        <footer className="lesson-footer-actions">
          <button
            className="lesson-delete-button"
            type="button"
            disabled={deleting || processing || simplifying}
            onClick={() => {
              stopLanguageAudio();
              void deleteLesson();
            }}
          >
            {deleting ? "Eliminando…" : "Eliminar lección"}
          </button>
        </footer>
      </article>
    </main>
  );
}
