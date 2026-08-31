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
  applyLanguageAudioPlaybackRate,
  assignLanguageDialogueVoices,
  canRegenerateLanguageLesson,
  createLanguageLessonSplitSubmissionGuard,
  DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE,
  DEFAULT_LANGUAGE_STORY_VOICE,
  downloadLanguageAudioBlob,
  formatLanguageLessonTitle,
  getOrCreateLanguageAudioElement,
  isJapaneseLanguage,
  isPreparedFreeLanguageLesson,
  LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS,
  LANGUAGE_LESSON_DIFFICULTY_OPTIONS,
  LANGUAGE_LESSON_LEARNING_STATUS_OPTIONS,
  languageDialogueLineIsActive,
  languageFreeAudioDownloadFilename,
  languageFreeVoiceChangeStopsPlayback,
  languageLessonAudioButtonLabel,
  languageLessonAudioErrorMessage,
  languageLessonAudioKey,
  languageLessonAudioRequest,
  languageLessonAudioStateAfterEnd,
  languageLessonAudioToggleAction,
  languageAudioPlaybackErrorMessage,
  languageLessonContentForVersion,
  languageLessonKanjiCopyText,
  languageLessonCanSplit,
  languageLessonAllowsSimplification,
  languageLessonShowsProgress,
  languageLessonSplitErrorMessage,
  languageLessonSplitResponseIsValid,
  languageLessonSplitState,
  languageStoryAudioDownloadDisabled,
  languageStoryAudioDownloadFilename,
  languageStoryVoiceChangeStopsPlayback,
  LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS,
  LANGUAGE_STORY_VOICE_OPTIONS,
  playExclusiveLanguageAudio,
  playLanguageDialogueSequentially,
  stopPlayableLanguageAudio,
  type LanguageAudioPlaybackRate,
  type LanguageAudioPlaybackCompletion,
  type LanguageLesson,
  type LanguageLessonAudioPlayback,
  type LanguageLessonAudioSection,
  type LanguageLessonContentVersion,
  type LanguageLessonDifficulty,
  type LanguageLessonLearningStatus,
  type LanguageLessonSplitState,
  type LanguageProject,
  type LanguageStoryVoice,
  type StructuredLanguageLesson,
} from "@/lib/languages";
import { useSessionGuard } from "@/lib/use-session-guard";

const SOURCE_CONTENT_MAX_LENGTH = 100_000;
const FREE_LESSON_TITLE_MAX_LENGTH = 160;

function LanguageLessonProgressControls({
  learningStatus,
  difficulty,
  updating,
  error,
  onLearningStatusChange,
  onDifficultyChange,
}: {
  learningStatus: LanguageLessonLearningStatus;
  difficulty: LanguageLessonDifficulty | null;
  updating: "learningStatus" | "difficulty" | null;
  error: string | null;
  onLearningStatusChange: (value: LanguageLessonLearningStatus) => void;
  onDifficultyChange: (value: LanguageLessonDifficulty) => void;
}) {
  return (
    <section className="lesson-learning-progress" aria-label="Progreso de aprendizaje">
      <div className="lesson-learning-progress-field">
        <span>Estado</span>
        <div aria-label="Estado de aprendizaje" role="group">
          {LANGUAGE_LESSON_LEARNING_STATUS_OPTIONS.map((option) => (
            <button
              aria-pressed={learningStatus === option.value}
              disabled={updating !== null}
              key={option.value}
              type="button"
              onClick={() => onLearningStatusChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lesson-learning-progress-field">
        <span>Dificultad</span>
        <div aria-label="Dificultad percibida" role="group">
          {LANGUAGE_LESSON_DIFFICULTY_OPTIONS.map((option) => (
            <button
              aria-pressed={difficulty === option.value}
              disabled={updating !== null}
              key={option.value}
              type="button"
              onClick={() => onDifficultyChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {updating ? <small aria-live="polite">Guardando…</small> : null}
      {error ? (
        <p className="lesson-learning-progress-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

type LessonSectionKey =
  | "vocabulary"
  | "kanji"
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

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="lesson-story-download-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path
        d="M10 3.5v8m0 0 3-3m-3 3-3-3M4 13.5v1.25A1.75 1.75 0 0 0 5.75 16.5h8.5A1.75 1.75 0 0 0 16 14.75V13.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function LessonAudioButton({
  text,
  accessibleLabel,
  playback,
  onPlay,
}: {
  text: string;
  accessibleLabel?: string;
  playback: LanguageLessonAudioPlayback | null;
  onPlay: () => void;
}) {
  const loading = playback?.status === "loading";
  const playing = playback?.status === "playing";
  const status = playback?.status ?? "idle";

  return (
    <>
      <button
        aria-label={languageLessonAudioButtonLabel(
          text,
          status,
          accessibleLabel,
        )}
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

function LanguageDialogueAudioButton({
  playback,
  onPlay,
}: {
  playback: Pick<LanguageLessonAudioPlayback, "status" | "error"> | null;
  onPlay: () => void;
}) {
  const loading = playback?.status === "loading";
  const playing = playback?.status === "playing";
  const active = loading || playing;

  return (
    <>
      <button
        aria-busy={loading}
        aria-label={active ? "Detener diálogo" : "Reproducir diálogo"}
        aria-pressed={playing}
        className="lesson-dialogue-play-button"
        data-state={playback?.status ?? "idle"}
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
        <span>{active ? "Detener diálogo" : "Reproducir diálogo"}</span>
      </button>
      {playback?.status === "error" && playback.error ? (
        <small className="lesson-audio-error" role="alert">
          {playback.error}
        </small>
      ) : null}
    </>
  );
}

function LanguageAudioRateControl({
  playbackRate,
  onPlaybackRateChange,
}: {
  playbackRate: LanguageAudioPlaybackRate;
  onPlaybackRateChange: (playbackRate: LanguageAudioPlaybackRate) => void;
}) {
  return (
    <div className="lesson-audio-rate-control">
      <span className="lesson-audio-rate-label" id="audio-rate-label">
        Velocidad
      </span>
      <div
        aria-labelledby="audio-rate-label"
        className="lesson-audio-rate-selector"
        role="group"
      >
        {LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS.map((option) => (
          <button
            aria-pressed={playbackRate === option.value}
            key={option.value}
            type="button"
            onClick={() => onPlaybackRateChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LanguageStoryVoiceControl({
  voice,
  accessibleLabel = "Voz de la mini historia",
  onVoiceChange,
}: {
  voice: LanguageStoryVoice;
  accessibleLabel?: string;
  onVoiceChange: (voice: LanguageStoryVoice) => void;
}) {
  return (
    <div className="lesson-story-voice-control">
      <span className="lesson-story-control-label">Voz</span>
      <div
        aria-label={accessibleLabel}
        className="lesson-story-voice-selector"
        role="group"
      >
        {LANGUAGE_STORY_VOICE_OPTIONS.map((option) => (
          <button
            aria-pressed={voice === option.value}
            key={option.value}
            type="button"
            onClick={() => onVoiceChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FreeReadyLesson({
  title,
  sourceContent,
  copiedField,
  copyError,
  audioPlayback,
  audioPlaybackRate,
  voice,
  download,
  analysis,
  analyzing,
  analysisError,
  onCopyTitle,
  onCopyText,
  onPlayAudio,
  onDownload,
  onPlaybackRateChange,
  onVoiceChange,
  onAnalyze,
}: {
  title: string;
  sourceContent: string;
  copiedField: "title" | "text" | null;
  copyError: string | null;
  audioPlayback: LanguageLessonAudioPlayback | null;
  audioPlaybackRate: LanguageAudioPlaybackRate;
  voice: LanguageStoryVoice;
  download: { loading: boolean; error: string | null };
  analysis: LanguageLesson["freeAnalysis"];
  analyzing: boolean;
  analysisError: string | null;
  onCopyTitle: () => void;
  onCopyText: () => void;
  onPlayAudio: () => void;
  onDownload: () => void;
  onPlaybackRateChange: (playbackRate: LanguageAudioPlaybackRate) => void;
  onVoiceChange: (voice: LanguageStoryVoice) => void;
  onAnalyze: () => void;
}) {
  const audioKey = languageLessonAudioKey("original", "freeText", 0, voice);
  const playback = audioPlayback?.key === audioKey ? audioPlayback : null;

  return (
    <div className="free-lesson-ready">
      <section aria-labelledby="free-lesson-title-heading">
        <header className="free-lesson-section-header">
          <h2 id="free-lesson-title-heading">Título</h2>
          <button
            aria-label={copiedField === "title" ? "Título copiado" : "Copiar título"}
            className="copy-button"
            type="button"
            onClick={onCopyTitle}
          >
            <CopyIcon />
            <span>{copiedField === "title" ? "Copiado" : "Copiar título"}</span>
          </button>
        </header>
        <p className="free-lesson-title">{title}</p>
      </section>

      <section aria-labelledby="free-lesson-text-heading">
        <header className="free-lesson-section-header">
          <h2 id="free-lesson-text-heading">Texto</h2>
          <button
            aria-label={copiedField === "text" ? "Texto copiado" : "Copiar texto"}
            className="copy-button"
            type="button"
            onClick={onCopyText}
          >
            <CopyIcon />
            <span>{copiedField === "text" ? "Copiado" : "Copiar texto"}</span>
          </button>
        </header>
        <p className="free-lesson-text">{sourceContent}</p>
      </section>

      <section aria-labelledby="free-lesson-audio-heading">
        <header className="free-lesson-section-header">
          <h2 id="free-lesson-audio-heading">Audio</h2>
          <div className="free-lesson-audio-actions">
            <LessonAudioButton
              accessibleLabel="texto de la lección libre"
              playback={playback}
              text={sourceContent}
              onPlay={onPlayAudio}
            />
            <button
              aria-busy={download.loading}
              className="lesson-story-download-button"
              disabled={download.loading || playback?.status === "loading"}
              type="button"
              onClick={onDownload}
            >
              <DownloadIcon />
              <span>
                {download.loading ? "Preparando descarga…" : "Descargar MP3"}
              </span>
            </button>
          </div>
        </header>
        <div className="free-lesson-audio-controls">
          <LanguageStoryVoiceControl
            accessibleLabel="Voz de la lección libre"
            voice={voice}
            onVoiceChange={onVoiceChange}
          />
          <LanguageAudioRateControl
            playbackRate={audioPlaybackRate}
            onPlaybackRateChange={onPlaybackRateChange}
          />
        </div>
        {download.error ? (
          <p className="lesson-story-download-error" role="alert">
            {download.error}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="free-lesson-analysis-heading">
        <header className="free-lesson-section-header">
          <h2 id="free-lesson-analysis-heading">Frases y patrones útiles</h2>
        </header>
        {analysis ? (
          <ol className="free-lesson-analysis-list">
            {analysis.items.slice(0, 5).map((item) => (
              <li key={`${item.phrase}-${item.pattern}`}>
                <strong>{item.phrase}</strong>
                <p>
                  <span>Patrón:</span> {item.pattern}
                </p>
                <p>{item.explanation}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="free-lesson-analysis-empty">
            <p>Extrae hasta 5 estructuras útiles del texto.</p>
            <button disabled={analyzing} type="button" onClick={onAnalyze}>
              {analyzing ? "Analizando…" : "Analizar texto"}
            </button>
          </div>
        )}
        {analysisError ? (
          <p className="form-error" role="alert">
            {analysisError}
          </p>
        ) : null}
      </section>

      {copyError ? (
        <p className="form-error" role="alert">
          {copyError}
        </p>
      ) : null}
    </div>
  );
}

function LessonSection({
  sectionIndex,
  sectionKey,
  title,
  copied,
  onCopy,
  headerAction,
  children,
}: {
  sectionIndex: number;
  sectionKey: LessonSectionKey;
  title: string;
  copied: boolean;
  onCopy: (sectionKey: LessonSectionKey) => void;
  headerAction?: ReactNode;
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
        <div className="lesson-section-actions">
          {headerAction}
          <button
            className="copy-button"
            type="button"
            onClick={() => onCopy(sectionKey)}
            aria-label={copied ? `${title} copiado` : `Copiar ${title}`}
          >
            <CopyIcon />
            <span>{copied ? "Copiado" : "Copiar"}</span>
          </button>
        </div>
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
    case "kanji":
      return languageLessonKanjiCopyText(lesson.kanji ?? []);
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
  language,
  contentVersion,
  copiedSection,
  audioPlayback,
  dialoguePlayback,
  audioPlaybackRate,
  storyVoice,
  storyDownload,
  onCopy,
  onDownloadStory,
  onPlayDialogue,
  onPlayAudio,
  onPlaybackRateChange,
  onStoryVoiceChange,
}: {
  content: StructuredLanguageLesson;
  language: string;
  contentVersion: LanguageLessonContentVersion;
  copiedSection: LessonSectionKey | null;
  audioPlayback: LanguageLessonAudioPlayback | null;
  dialoguePlayback: Pick<
    LanguageLessonAudioPlayback,
    "status" | "error"
  > | null;
  audioPlaybackRate: LanguageAudioPlaybackRate;
  storyVoice: LanguageStoryVoice;
  storyDownload: { loading: boolean; error: string | null };
  onCopy: (sectionKey: LessonSectionKey) => void;
  onDownloadStory: () => void;
  onPlayDialogue: () => void;
  onPlayAudio: (
    section: LanguageLessonAudioSection,
    index: number,
    voice?: LanguageStoryVoice,
  ) => void;
  onPlaybackRateChange: (playbackRate: LanguageAudioPlaybackRate) => void;
  onStoryVoiceChange: (voice: LanguageStoryVoice) => void;
}) {
  const storyAudioKey = languageLessonAudioKey(
    contentVersion,
    "miniStory",
    0,
    storyVoice,
  );
  const storyPlayback =
    audioPlayback?.key === storyAudioKey ? audioPlayback : null;
  const storyDownloadDisabled = languageStoryAudioDownloadDisabled(
    storyDownload.loading,
    audioPlayback,
    storyAudioKey,
  );
  const dialogueVoices = assignLanguageDialogueVoices(content.dialogue);
  const showKanji =
    isJapaneseLanguage(language) && Boolean(content.kanji?.length);
  const sectionIndexAfterVocabulary = (baseIndex: number) =>
    baseIndex + (showKanji ? 1 : 0);

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

      {showKanji ? (
        <LessonSection
          sectionIndex={1}
          sectionKey="kanji"
          title="Kanji de la lección"
          copied={copiedSection === "kanji"}
          onCopy={onCopy}
        >
          <div className="lesson-kanji-list">
            {content.kanji!.slice(0, 4).map((item, index) => (
              <article className="lesson-kanji-card" key={`${item.word}-${index}`}>
                <h3 lang="ja">{item.word}</h3>
                <p className="lesson-kanji-summary">
                  <span lang="ja">{item.reading}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{item.meaning}</span>
                </p>
                <div className="lesson-kanji-components">
                  {item.components.map((component, componentIndex) => (
                    <div
                      className="lesson-kanji-component"
                      key={`${component.character}-${componentIndex}`}
                    >
                      <p>
                        <strong lang="ja">{component.character}</strong>
                        {component.readingInWord ? (
                          <span lang="ja">{component.readingInWord}</span>
                        ) : null}
                      </p>
                      <small>{component.meaning}</small>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </LessonSection>
      ) : null}

      <LessonSection
        sectionIndex={sectionIndexAfterVocabulary(1)}
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
        sectionIndex={sectionIndexAfterVocabulary(2)}
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
        sectionIndex={sectionIndexAfterVocabulary(3)}
        sectionKey="miniStory"
        title="Mini historia"
        copied={copiedSection === "miniStory"}
        onCopy={onCopy}
        headerAction={
          <>
            <LessonAudioButton
              text={content.miniStory.text}
              accessibleLabel="mini historia"
              playback={storyPlayback}
              onPlay={() => onPlayAudio("miniStory", 0)}
            />
            <button
              aria-busy={storyDownload.loading}
              className="lesson-story-download-button"
              disabled={storyDownloadDisabled}
              type="button"
              onClick={onDownloadStory}
            >
              <DownloadIcon />
              <span>
                {storyDownload.loading
                  ? "Preparando descarga…"
                  : "Descargar MP3"}
              </span>
            </button>
          </>
        }
      >
        <LanguageStoryVoiceControl
          voice={storyVoice}
          onVoiceChange={onStoryVoiceChange}
        />
        <LanguageAudioRateControl
          playbackRate={audioPlaybackRate}
          onPlaybackRateChange={onPlaybackRateChange}
        />
        {storyDownload.error ? (
          <p className="lesson-story-download-error" role="alert">
            {storyDownload.error}
          </p>
        ) : null}
        <p className="lesson-reading-text">{content.miniStory.text}</p>
      </LessonSection>

      <LessonSection
        sectionIndex={sectionIndexAfterVocabulary(4)}
        sectionKey="automaticThoughts"
        title="Pensamientos automáticos"
        copied={copiedSection === "automaticThoughts"}
        onCopy={onCopy}
      >
        <ol className="lesson-numbered-list">
          {content.automaticThoughts.map((thought, index) => (
            <li key={`${thought.text}-${index}`}>
              <div className="lesson-thought-audio-item">
                <span>{thought.text}</span>
                <LessonAudioButton
                  text={thought.text}
                  playback={
                    audioPlayback?.key ===
                    languageLessonAudioKey(
                      contentVersion,
                      "automaticThoughts",
                      index,
                    )
                      ? audioPlayback
                      : null
                  }
                  onPlay={() => onPlayAudio("automaticThoughts", index)}
                />
              </div>
            </li>
          ))}
        </ol>
      </LessonSection>

      <LessonSection
        sectionIndex={sectionIndexAfterVocabulary(5)}
        sectionKey="dialogue"
        title="Diálogo"
        copied={copiedSection === "dialogue"}
        onCopy={onCopy}
        headerAction={
          <LanguageDialogueAudioButton
            playback={dialoguePlayback}
            onPlay={onPlayDialogue}
          />
        }
      >
        <div className="lesson-dialogue">
          {content.dialogue.map((line, index) => {
            const voice = dialogueVoices[index]!;
            const lineKey = languageLessonAudioKey(
              contentVersion,
              "dialogue",
              index,
              voice,
            );
            const linePlayback =
              audioPlayback?.key === lineKey ? audioPlayback : null;
            const active = languageDialogueLineIsActive(
              audioPlayback,
              contentVersion,
              index,
              voice,
            );

            return (
              <div
                className="lesson-dialogue-line"
                data-active={active ? "true" : undefined}
                key={`${line.speaker}-${index}`}
              >
                <p>
                  <strong>{line.speaker}:</strong>
                  <span>{line.text}</span>
                </p>
                <LessonAudioButton
                  text={line.text}
                  accessibleLabel={`intervención de ${line.speaker}`}
                  playback={linePlayback}
                  onPlay={() => onPlayAudio("dialogue", index, voice)}
                />
              </div>
            );
          })}
        </div>
      </LessonSection>

      <LessonSection
        sectionIndex={sectionIndexAfterVocabulary(6)}
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
        sectionIndex={sectionIndexAfterVocabulary(7)}
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
  const [splitState, setSplitState] = useState<LanguageLessonSplitState>({
    kind: "none",
  });
  const [splitting, setSplitting] = useState(false);
  const splittingGuard = useRef(createLanguageLessonSplitSubmissionGuard());
  const [splitError, setSplitError] = useState<string | null>(null);
  const [freeTitle, setFreeTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressUpdating, setProgressUpdating] = useState<
    "learningStatus" | "difficulty" | null
  >(null);
  const progressUpdatingRef = useRef(false);
  const [processing, setProcessing] = useState(false);
  const [preparingFree, setPreparingFree] = useState(false);
  const preparingFreeRef = useRef(false);
  const [analyzingFree, setAnalyzingFree] = useState(false);
  const analyzingFreeRef = useRef(false);
  const [freeAnalysisError, setFreeAnalysisError] = useState<string | null>(
    null,
  );
  const [simplificationAction, setSimplificationAction] = useState<
    "simplify" | "regenerate" | null
  >(null);
  const [contentVersion, setContentVersion] =
    useState<LanguageLessonContentVersion>("original");
  const [storyVoice, setStoryVoice] = useState<LanguageStoryVoice>(
    DEFAULT_LANGUAGE_STORY_VOICE,
  );
  const [audioPlaybackRate, setAudioPlaybackRate] =
    useState<LanguageAudioPlaybackRate>(
      DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE,
    );
  const audioPlaybackRateRef = useRef<LanguageAudioPlaybackRate>(
    DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE,
  );
  const [deleting, setDeleting] = useState(false);
  const [copiedSection, setCopiedSection] =
    useState<LessonSectionKey | null>(null);
  const [freeCopiedField, setFreeCopiedField] = useState<
    "title" | "text" | null
  >(null);
  const [freeCopyError, setFreeCopyError] = useState<string | null>(null);
  const [audioPlayback, setAudioPlayback] =
    useState<LanguageLessonAudioPlayback | null>(null);
  const [dialoguePlayback, setDialoguePlayback] = useState<Pick<
    LanguageLessonAudioPlayback,
    "status" | "error"
  > | null>(null);
  const dialoguePlaybackRef = useRef<Pick<
    LanguageLessonAudioPlayback,
    "status" | "error"
  > | null>(null);
  const [storyDownload, setStoryDownload] = useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: false, error: null });
  const storyDownloadLoadingRef = useRef(false);
  const [freeDownload, setFreeDownload] = useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: false, error: null });
  const freeDownloadLoadingRef = useRef(false);
  const audioPlaybackRef = useRef<LanguageLessonAudioPlayback | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const audioAbortControllerRef = useRef<AbortController | null>(null);
  const audioRequestIdRef = useRef(0);
  const dialogueSequenceIdRef = useRef(0);
  const audioCompletionRef = useRef<
    ((result: LanguageAudioPlaybackCompletion) => void) | null
  >(null);
  const simplifying = simplificationAction !== null;

  function updateAudioPlayback(
    playback: LanguageLessonAudioPlayback | null,
  ) {
    audioPlaybackRef.current = playback;
    setAudioPlayback(playback);
  }

  function updateDialoguePlayback(
    playback: Pick<LanguageLessonAudioPlayback, "status" | "error"> | null,
  ) {
    dialoguePlaybackRef.current = playback;
    setDialoguePlayback(playback);
  }

  function updateLanguageAudioPlaybackRate(
    playbackRate: LanguageAudioPlaybackRate,
  ) {
    audioPlaybackRateRef.current = playbackRate;
    setAudioPlaybackRate(playbackRate);
    applyLanguageAudioPlaybackRate(audioElementRef.current, playbackRate);
  }

  function updateLanguageStoryVoice(voice: LanguageStoryVoice) {
    if (voice === storyVoice) return;

    if (
      languageStoryVoiceChangeStopsPlayback(
        audioPlaybackRef.current,
        contentVersion,
        storyVoice,
      ) ||
      languageFreeVoiceChangeStopsPlayback(
        audioPlaybackRef.current,
        storyVoice,
      )
    ) {
      stopLanguageAudio();
      updateAudioPlayback(null);
    }

    setStoryVoice(voice);
  }

  function stopCurrentLanguageAudio() {
    audioRequestIdRef.current += 1;
    audioAbortControllerRef.current?.abort();
    audioAbortControllerRef.current = null;
    const complete = audioCompletionRef.current;
    audioCompletionRef.current = null;
    complete?.("stopped");
    const audio = audioElementRef.current;

    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      stopPlayableLanguageAudio(audio);
      audio.removeAttribute("src");
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }

  function stopLanguageAudio() {
    dialogueSequenceIdRef.current += 1;
    updateDialoguePlayback(null);
    stopCurrentLanguageAudio();
  }

  useEffect(() => {
    return () => {
      dialogueSequenceIdRef.current += 1;
      audioAbortControllerRef.current?.abort();
      audioCompletionRef.current?.("stopped");
      const audio = audioElementRef.current;

      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        stopPlayableLanguageAudio(audio);
        audio.removeAttribute("src");
        audioElementRef.current = null;
      }

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
        const [projectResponse, lessonResponse, lessonsResponse] =
          await Promise.all([
            fetch(`/api/languages/projects/${encodedProjectId}`, {
              cache: "no-store",
              credentials: "include",
            }),
            fetch(
              `/api/languages/projects/${encodedProjectId}/lessons/${encodedLessonId}`,
              { cache: "no-store", credentials: "include" },
            ),
            fetch(`/api/languages/projects/${encodedProjectId}/lessons`, {
              cache: "no-store",
              credentials: "include",
            }),
          ]);

        if (
          projectResponse.status === 401 ||
          lessonResponse.status === 401 ||
          lessonsResponse.status === 401
        ) {
          router.replace("/");
          return;
        }

        const projectResult = (await projectResponse.json()) as {
          project?: LanguageProject;
        };
        const lessonResult = (await lessonResponse.json()) as {
          lesson?: LanguageLesson;
        };
        const lessonsResult = (await lessonsResponse.json()) as {
          lessons?: LanguageLesson[];
        };

        if (
          !projectResponse.ok ||
          !lessonResponse.ok ||
          !lessonsResponse.ok ||
          !projectResult.project ||
          !lessonResult.lesson ||
          !lessonsResult.lessons
        ) {
          throw new Error("Language lesson unavailable");
        }

        if (active) {
          setProject(projectResult.project);
          setLesson(lessonResult.lesson);
          setSplitState(
            languageLessonSplitState(
              lessonsResult.lessons,
              lessonResult.lesson.id,
            ),
          );
          setFreeTitle(lessonResult.lesson.freeTitle ?? "");
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

  async function prepareFreeLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preparingFreeRef.current) return;

    preparingFreeRef.current = true;
    setPreparingFree(true);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/free/prepare`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: freeTitle, sourceContent }),
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
          result.message ?? "No se pudo preparar la lección libre.",
        );
        return;
      }

      setLesson(result.lesson);
      setFreeTitle(result.lesson.freeTitle ?? "");
      setSourceContent(result.lesson.sourceContent ?? "");
    } catch {
      setActionError("No se pudo preparar la lección libre.");
    } finally {
      preparingFreeRef.current = false;
      setPreparingFree(false);
    }
  }

  async function analyzeFreeLesson() {
    if (
      analyzingFreeRef.current ||
      !lesson ||
      !isPreparedFreeLanguageLesson(lesson) ||
      lesson.status !== "ready" ||
      lesson.freeAnalysis !== null
    ) {
      return;
    }

    analyzingFreeRef.current = true;
    setAnalyzingFree(true);
    setFreeAnalysisError(null);

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/free/analyze`,
        { method: "POST", credentials: "include" },
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
        setFreeAnalysisError(
          result.message ?? "No se pudo analizar el texto. Intenta nuevamente.",
        );
        return;
      }

      setLesson(result.lesson);
    } catch {
      setFreeAnalysisError(
        "No se pudo analizar el texto. Intenta nuevamente.",
      );
    } finally {
      analyzingFreeRef.current = false;
      setAnalyzingFree(false);
    }
  }

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

  async function splitLanguageLesson() {
    if (!lesson || !splittingGuard.current.start()) return;

    setSplitting(true);
    setSplitError(null);

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/split`,
        { method: "POST", credentials: "include" },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result: unknown = await response.json();

      if (!response.ok) {
        const error =
          result && typeof result === "object" && "error" in result
            ? String(result.error)
            : undefined;
        if (error === "LANGUAGE_LESSON_SPLIT_INCONSISTENT") {
          setSplitState({ kind: "inconsistent" });
        }
        setSplitError(languageLessonSplitErrorMessage(response.status, error));
        return;
      }

      if (!languageLessonSplitResponseIsValid(result, lesson.id)) {
        setSplitError("No se pudo dividir la lección. Intenta nuevamente.");
        return;
      }

      setLesson(result.parent);
      setSplitState({ kind: "complete", parts: result.parts });
    } catch {
      setSplitError("No se pudo dividir la lección. Intenta nuevamente.");
    } finally {
      splittingGuard.current.finish();
      setSplitting(false);
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

  async function updateLearningProgress(
    progress:
      | { learningStatus: LanguageLessonLearningStatus }
      | { difficulty: LanguageLessonDifficulty },
  ) {
    if (progressUpdatingRef.current) return;

    progressUpdatingRef.current = true;
    setProgressUpdating(
      "learningStatus" in progress ? "learningStatus" : "difficulty",
    );
    setProgressError(null);

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/progress`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(progress),
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
        setProgressError(
          result.message ?? "No se pudo guardar el progreso de la lección.",
        );
        return;
      }

      setLesson(result.lesson);
    } catch {
      setProgressError("No se pudo guardar el progreso de la lección.");
    } finally {
      progressUpdatingRef.current = false;
      setProgressUpdating(null);
    }
  }

  async function deleteLesson() {
    if (
      !window.confirm(
        splitState.kind === "complete"
          ? "¿Eliminar esta lección y sus partes 1A y 1B? Esta acción no se puede deshacer."
          : "¿Eliminar esta lección? Esta acción no se puede deshacer.",
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

  async function copyFreeLessonField(field: "title" | "text") {
    if (!lesson || !isPreparedFreeLanguageLesson(lesson)) return;

    const value = field === "title" ? lesson.freeTitle : lesson.sourceContent;

    if (!value) return;

    setFreeCopyError(null);
    try {
      await navigator.clipboard.writeText(value);
      setFreeCopiedField(field);
      window.setTimeout(() => {
        setFreeCopiedField((current) => (current === field ? null : current));
      }, 1_500);
    } catch {
      setFreeCopyError(
        field === "title"
          ? "No se pudo copiar el título."
          : "No se pudo copiar el texto.",
      );
    }
  }

  async function playLanguageAudio(
    section: LanguageLessonAudioSection,
    index: number,
    dialogueVoice?: LanguageStoryVoice,
    dialogueSequenceId?: number,
  ): Promise<LanguageAudioPlaybackCompletion> {
    const voice =
      section === "miniStory" || section === "freeText"
        ? storyVoice
        : section === "dialogue"
          ? dialogueVoice
          : undefined;
    const audioVersion = section === "freeText" ? "original" : contentVersion;
    const key = languageLessonAudioKey(audioVersion, section, index, voice);
    const toggleAction = languageLessonAudioToggleAction(
      audioPlaybackRef.current,
      key,
    );

    if (toggleAction === "ignore") return "stopped";

    if (toggleAction === "stop") {
      stopLanguageAudio();
      updateAudioPlayback(null);
      return "stopped";
    }

    const audio = getOrCreateLanguageAudioElement(
      audioElementRef.current,
      () => new Audio(),
    );
    audioElementRef.current = audio;

    if (dialogueSequenceId === undefined) {
      stopLanguageAudio();
    } else {
      stopCurrentLanguageAudio();
    }
    const requestId = audioRequestIdRef.current;
    const controller = new AbortController();
    audioAbortControllerRef.current = controller;
    updateAudioPlayback({ key, status: "loading", error: null });
    if (dialogueSequenceId === dialogueSequenceIdRef.current) {
      updateDialoguePlayback({ status: "loading", error: null });
    }

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/audio`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            languageLessonAudioRequest(
              audioVersion,
              section,
              index,
              voice,
            ),
          ),
          signal: controller.signal,
        },
      );

      if (response.status === 401) {
        stopLanguageAudio();
        updateAudioPlayback(null);
        router.replace("/");
        return "stopped";
      }

      if (!response.ok) {
        const result = (await response.json()) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          languageLessonAudioErrorMessage(response.status, result),
        );
      }

      const audioUrl = URL.createObjectURL(await response.blob());

      if (requestId !== audioRequestIdRef.current) {
        URL.revokeObjectURL(audioUrl);
        return "stopped";
      }

      const completion = new Promise<LanguageAudioPlaybackCompletion>(
        (resolve) => {
          audioCompletionRef.current = resolve;
        },
      );
      audioObjectUrlRef.current = audioUrl;
      audio.src = audioUrl;
      audio.onended = () => {
        if (
          requestId === audioRequestIdRef.current &&
          audioElementRef.current === audio
        ) {
          const complete = audioCompletionRef.current;
          audioCompletionRef.current = null;
          stopCurrentLanguageAudio();
          updateAudioPlayback(
            languageLessonAudioStateAfterEnd(audioPlaybackRef.current, key),
          );
          complete?.("ended");
        }
      };
      audio.onerror = () => {
        if (
          requestId === audioRequestIdRef.current &&
          audioElementRef.current === audio
        ) {
          const complete = audioCompletionRef.current;
          audioCompletionRef.current = null;
          stopCurrentLanguageAudio();
          updateAudioPlayback({
            key,
            status: "error",
            error: "No se pudo reproducir la pronunciación.",
          });
          if (dialogueSequenceId === dialogueSequenceIdRef.current) {
            updateDialoguePlayback({
              status: "error",
              error: "No se pudo reproducir el diálogo.",
            });
          }
          complete?.("error");
        }
      };
      await playExclusiveLanguageAudio(
        audio,
        audio,
        audioPlaybackRateRef.current,
      );

      if (requestId === audioRequestIdRef.current) {
        updateAudioPlayback({ key, status: "playing", error: null });
        if (dialogueSequenceId === dialogueSequenceIdRef.current) {
          updateDialoguePlayback({ status: "playing", error: null });
        }
      }
      return await completion;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "stopped";
      }

      if (requestId === audioRequestIdRef.current) {
        stopCurrentLanguageAudio();
        const message = languageAudioPlaybackErrorMessage(error);
        updateAudioPlayback({
          key,
          status: "error",
          error: message,
        });
        if (dialogueSequenceId === dialogueSequenceIdRef.current) {
          updateDialoguePlayback({ status: "error", error: message });
        }
      }
      return "error";
    } finally {
      if (audioAbortControllerRef.current === controller) {
        audioAbortControllerRef.current = null;
      }
    }
  }

  async function playDialogueAudio() {
    if (
      dialoguePlaybackRef.current?.status === "loading" ||
      dialoguePlaybackRef.current?.status === "playing"
    ) {
      stopLanguageAudio();
      updateAudioPlayback(null);
      return;
    }

    if (!lesson) return;
    const content = languageLessonContentForVersion(lesson, contentVersion);
    if (!content?.dialogue.length) return;

    const voices = assignLanguageDialogueVoices(content.dialogue);
    stopLanguageAudio();
    updateAudioPlayback(null);
    const sequenceId = dialogueSequenceIdRef.current;
    updateDialoguePlayback({ status: "loading", error: null });

    const result = await playLanguageDialogueSequentially(
      content.dialogue.length,
      (index) =>
        playLanguageAudio("dialogue", index, voices[index], sequenceId),
      () => sequenceId === dialogueSequenceIdRef.current,
    );

    if (sequenceId !== dialogueSequenceIdRef.current) return;

    if (result === "completed" || result === "stopped") {
      updateDialoguePlayback(null);
      updateAudioPlayback(null);
    }
  }

  async function downloadMiniStoryAudio() {
    if (storyDownloadLoadingRef.current || !project) return;

    const version = contentVersion;
    const voice = storyVoice;
    const storyKey = languageLessonAudioKey(version, "miniStory", 0, voice);

    if (
      languageStoryAudioDownloadDisabled(
        false,
        audioPlaybackRef.current,
        storyKey,
      )
    ) {
      return;
    }

    storyDownloadLoadingRef.current = true;
    setStoryDownload({ loading: true, error: null });

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/audio`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            languageLessonAudioRequest(version, "miniStory", 0, voice),
          ),
        },
      );

      if (response.status === 401) {
        setStoryDownload({ loading: false, error: null });
        router.replace("/");
        return;
      }

      if (!response.ok) {
        const result = (await response.json()) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          languageLessonAudioErrorMessage(response.status, result),
        );
      }

      downloadLanguageAudioBlob(
        await response.blob(),
        languageStoryAudioDownloadFilename(project.language, version, voice),
      );
      setStoryDownload({ loading: false, error: null });
    } catch (error) {
      setStoryDownload({
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo descargar el audio. Intenta nuevamente.",
      });
    } finally {
      storyDownloadLoadingRef.current = false;
    }
  }

  async function downloadFreeLessonAudio() {
    if (
      freeDownloadLoadingRef.current ||
      !lesson ||
      !isPreparedFreeLanguageLesson(lesson)
    ) {
      return;
    }

    const voice = storyVoice;
    const freeAudioKey = languageLessonAudioKey(
      "original",
      "freeText",
      0,
      voice,
    );

    if (
      audioPlaybackRef.current?.key === freeAudioKey &&
      audioPlaybackRef.current.status === "loading"
    ) {
      return;
    }

    freeDownloadLoadingRef.current = true;
    setFreeDownload({ loading: true, error: null });

    try {
      const response = await fetch(
        `/api/languages/projects/${encodeURIComponent(projectId)}/lessons/${encodeURIComponent(lessonId)}/audio`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            languageLessonAudioRequest("original", "freeText", 0, voice),
          ),
        },
      );

      if (response.status === 401) {
        setFreeDownload({ loading: false, error: null });
        router.replace("/");
        return;
      }

      if (!response.ok) {
        const result = (await response.json()) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          languageLessonAudioErrorMessage(response.status, result),
        );
      }

      downloadLanguageAudioBlob(
        await response.blob(),
        languageFreeAudioDownloadFilename(lesson.freeTitle, voice),
      );
      setFreeDownload({ loading: false, error: null });
    } catch (error) {
      setFreeDownload({
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo descargar el audio. Intenta nuevamente.",
      });
    } finally {
      freeDownloadLoadingRef.current = false;
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

  const preparedFreeLesson = isPreparedFreeLanguageLesson(lesson);
  const splitComplete = splitState.kind === "complete";
  const splitChild = lesson.splitPart !== null;
  const canSplit = languageLessonCanSplit(project.level, lesson, splitState);
  const showProgress = languageLessonShowsProgress(lesson, splitState);
  const allowSimplification = languageLessonAllowsSimplification(lesson);
  const readyContent =
    lesson.status === "ready" && !preparedFreeLesson
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
          {lesson.splitParentLessonId ? (
            <Link
              className="lesson-source-link"
              href={`/languages/${project.id}/lessons/${lesson.splitParentLessonId}`}
            >
              Ver lección fuente
            </Link>
          ) : null}
        </header>

        {showProgress ? (
          <LanguageLessonProgressControls
            difficulty={lesson.difficulty}
            error={progressError}
            learningStatus={lesson.learningStatus}
            updating={progressUpdating}
            onDifficultyChange={(difficulty) =>
              void updateLearningProgress({ difficulty })
            }
            onLearningStatusChange={(learningStatus) =>
              void updateLearningProgress({ learningStatus })
            }
          />
        ) : null}

        {lesson.status === "ready" && splitComplete ? (
          <p className="lesson-split-progress-note">
            El progreso se registra en 1A y 1B.
          </p>
        ) : null}

        {canSplit ? (
          <section
            className="lesson-split-action"
            aria-labelledby="lesson-split-title"
          >
            <div>
              <h2 id="lesson-split-title">Dividir en 1A + 1B</h2>
              <p>
                Crea dos unidades A1 más manejables a partir de esta lección.
              </p>
            </div>
            <button
              aria-busy={splitting}
              disabled={splitting}
              type="button"
              onClick={() => void splitLanguageLesson()}
            >
              {splitting ? "Dividiendo…" : "Dividir en 1A + 1B"}
            </button>
          </section>
        ) : null}

        {splitError ? (
          <p className="form-error lesson-split-error" role="alert">
            {splitError}
          </p>
        ) : null}

        {splitState.kind === "inconsistent" && !splitError ? (
          <p className="form-error lesson-split-error" role="alert">
            Las partes de esta lección están incompletas.
          </p>
        ) : null}

        {splitState.kind === "complete" ? (
          <section
            className="lesson-split-parts"
            aria-labelledby="lesson-split-parts-title"
          >
            <div>
              <h2 id="lesson-split-parts-title">Partes de estudio</h2>
              <p>Estudia primero 1A y después 1B.</p>
            </div>
            <div className="lesson-split-parts-grid">
              {(["A", "B"] as const).map((part) => {
                const child = splitState.parts[part];
                const learningStatus =
                  LANGUAGE_LESSON_LEARNING_STATUS_OPTIONS.find(
                    ({ value }) => value === child.learningStatus,
                  )?.label ?? child.learningStatus;
                const difficulty = child.difficulty
                  ? LANGUAGE_LESSON_DIFFICULTY_OPTIONS.find(
                      ({ value }) => value === child.difficulty,
                    )?.label
                  : null;

                return (
                  <Link
                    className="lesson-split-part-card"
                    href={`/languages/${project.id}/lessons/${child.id}`}
                    key={part}
                  >
                    <strong>
                      {child.sourceLessonNumber}
                      {part}
                    </strong>
                    <span>Estado: {learningStatus}</span>
                    {difficulty ? <small>Dificultad: {difficulty}</small> : null}
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null}

        {lesson.status === "processing" ? (
          <section className="lesson-processing" aria-live="polite">
            <strong>Procesando lección…</strong>
            <p>
              MemoOS está organizando el material en las secciones de la lección.
            </p>
          </section>
        ) : null}

        {lesson.lessonSource === "free" &&
        lesson.status !== "ready" &&
        lesson.status !== "processing" ? (
          <form className="lesson-form free-lesson-form" onSubmit={prepareFreeLesson}>
            <div className="free-lesson-form-intro">
              <h2>Preparar lección libre</h2>
              <p>Pega un texto para escucharlo y descargarlo como MP3.</p>
              <small>
                Podrás copiar el título y el texto para usarlos donde quieras.
              </small>
            </div>
            <label htmlFor="free-lesson-title">Título</label>
            <input
              id="free-lesson-title"
              maxLength={FREE_LESSON_TITLE_MAX_LENGTH}
              required
              type="text"
              value={freeTitle}
              onChange={(event) => setFreeTitle(event.target.value)}
            />
            <small className="lesson-input-limit">
              Máximo {FREE_LESSON_TITLE_MAX_LENGTH} caracteres.
            </small>
            <label htmlFor="free-lesson-text">Texto</label>
            <textarea
              id="free-lesson-text"
              maxLength={SOURCE_CONTENT_MAX_LENGTH}
              placeholder="Pega aquí el texto completo."
              required
              rows={18}
              value={sourceContent}
              onChange={(event) => setSourceContent(event.target.value)}
            />
            <small className="lesson-input-limit">
              Máximo {SOURCE_CONTENT_MAX_LENGTH.toLocaleString("es")} caracteres.
            </small>
            {actionError ? (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            ) : null}
            <button
              disabled={
                preparingFree || !freeTitle.trim() || !sourceContent.trim()
              }
              type="submit"
            >
              {preparingFree ? "Preparando…" : "Preparar lección libre"}
            </button>
          </form>
        ) : null}

        {lesson.lessonSource !== "free" &&
        lesson.status !== "ready" &&
        lesson.status !== "processing" ? (
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

        {allowSimplification && readyContent ? (
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
            language={project.language}
            contentVersion={contentVersion}
            copiedSection={copiedSection}
            audioPlayback={audioPlayback}
            dialoguePlayback={dialoguePlayback}
            audioPlaybackRate={audioPlaybackRate}
            storyVoice={storyVoice}
            storyDownload={storyDownload}
            onCopy={(sectionKey) => void copySection(sectionKey)}
            onDownloadStory={() => void downloadMiniStoryAudio()}
            onPlayDialogue={() => void playDialogueAudio()}
            onPlayAudio={(section, index, voice) =>
              void playLanguageAudio(section, index, voice)
            }
            onPlaybackRateChange={updateLanguageAudioPlaybackRate}
            onStoryVoiceChange={updateLanguageStoryVoice}
          />
        ) : null}

        {lesson.status === "ready" && preparedFreeLesson ? (
          <FreeReadyLesson
            analysis={lesson.freeAnalysis}
            analysisError={freeAnalysisError}
            analyzing={analyzingFree}
            audioPlayback={audioPlayback}
            audioPlaybackRate={audioPlaybackRate}
            copiedField={freeCopiedField}
            copyError={freeCopyError}
            download={freeDownload}
            sourceContent={lesson.sourceContent ?? ""}
            title={lesson.freeTitle}
            voice={storyVoice}
            onCopyText={() => void copyFreeLessonField("text")}
            onCopyTitle={() => void copyFreeLessonField("title")}
            onDownload={() => void downloadFreeLessonAudio()}
            onPlayAudio={() => void playLanguageAudio("freeText", 0)}
            onPlaybackRateChange={updateLanguageAudioPlaybackRate}
            onVoiceChange={updateLanguageStoryVoice}
            onAnalyze={() => void analyzeFreeLesson()}
          />
        ) : null}

        {lesson.status === "ready" && !preparedFreeLesson && !readyContent ? (
          <p className="form-error lesson-ready-error" role="alert">
            No se pudo mostrar el contenido estructurado de esta lección.
          </p>
        ) : null}

        {!splitChild ? (
          <footer className="lesson-footer-actions">
            <button
              className="lesson-delete-button"
              type="button"
              disabled={
                deleting ||
                processing ||
                preparingFree ||
                analyzingFree ||
                simplifying ||
                splitting
              }
              onClick={() => {
                stopLanguageAudio();
                void deleteLesson();
              }}
            >
              {deleting ? "Eliminando…" : "Eliminar lección"}
            </button>
          </footer>
        ) : null}
      </article>
    </main>
  );
}
