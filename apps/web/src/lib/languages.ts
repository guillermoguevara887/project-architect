export type LanguageProject = {
  id: string;
  language: string;
  level: string;
  createdAt: string;
  updatedAt: string;
};

export type LanguageLessonStatus =
  | "draft"
  | "processing"
  | "ready"
  | "failed";

export const LANGUAGE_LESSON_SOURCE_OPTIONS = [
  {
    value: "assimil",
    label: "Assimil",
    emptyMessage: "No hay lecciones de Assimil todavía.",
  },
  {
    value: "language_framework",
    label: "Marco de idiomas",
    emptyMessage: "No hay lecciones del Marco de idiomas todavía.",
  },
  {
    value: "free",
    label: "Lección libre",
    emptyMessage: "No hay lecciones libres todavía.",
  },
] as const;

export type LanguageLessonSource =
  (typeof LANGUAGE_LESSON_SOURCE_OPTIONS)[number]["value"];

export type LanguageLessonCreationState = {
  status: "closed" | "choosing" | "creating";
  lessonSource: LanguageLessonSource;
};

export type LanguageLessonCreationAction =
  | { type: "open" }
  | { type: "select-source"; lessonSource: LanguageLessonSource }
  | { type: "start" }
  | { type: "cancel" }
  | { type: "failed" };

export const INITIAL_LANGUAGE_LESSON_CREATION_STATE = {
  status: "closed",
  lessonSource: "free",
} satisfies LanguageLessonCreationState;

export function languageLessonCreationReducer(
  state: LanguageLessonCreationState,
  action: LanguageLessonCreationAction,
): LanguageLessonCreationState {
  switch (action.type) {
    case "open":
      return { status: "choosing", lessonSource: "free" };
    case "select-source":
      return state.status === "choosing"
        ? { ...state, lessonSource: action.lessonSource }
        : state;
    case "start":
      return state.status === "choosing"
        ? { ...state, status: "creating" }
        : state;
    case "cancel":
      return state.status === "creating"
        ? state
        : INITIAL_LANGUAGE_LESSON_CREATION_STATE;
    case "failed":
      return state.status === "creating"
        ? { ...state, status: "choosing" }
        : state;
  }

  return state;
}

export function createLanguageLessonSubmissionGuard() {
  let submitting = false;

  return {
    start() {
      if (submitting) return false;
      submitting = true;
      return true;
    },
    finish() {
      submitting = false;
    },
  };
}

export const LANGUAGE_LESSON_FILTER_OPTIONS = [
  {
    value: "all",
    label: "Todas",
    emptyMessage: "No hay lecciones todavía.",
  },
  ...LANGUAGE_LESSON_SOURCE_OPTIONS,
] as const;

export type LanguageLessonFilter =
  (typeof LANGUAGE_LESSON_FILTER_OPTIONS)[number]["value"];

export type StructuredLanguageLesson = {
  vocabulary: Array<{
    term: string;
    meaning: string;
    example: string | null;
  }>;
  phrases: Array<{
    text: string;
    translation: string;
    note: string | null;
  }>;
  patterns: Array<{
    name: string;
    explanation: string;
    examples: string[];
  }>;
  miniStory: {
    text: string;
  };
  automaticThoughts: Array<{
    text: string;
  }>;
  dialogue: Array<{
    speaker: string;
    text: string;
  }>;
  nextLevelBridge: Array<{
    base: string;
    advanced: string;
    note: string;
  }>;
  review: {
    keyVocabulary: string[];
    keyPatterns: string[];
  };
};

export type LanguageLesson = {
  id: string;
  languageProjectId: string;
  lessonNumber: number;
  lessonSource: LanguageLessonSource;
  sourceLessonNumber: number;
  status: LanguageLessonStatus;
  sourceContent?: string;
  structuredContent?: StructuredLanguageLesson | null;
  simplifiedStructuredContent?: StructuredLanguageLesson | null;
  simplifiedAt?: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "simplified", label: "Simplificada" },
] as const;

export type LanguageLessonContentVersion =
  (typeof LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS)[number]["value"];

export type LanguageLessonAudioSection =
  | "vocabulary"
  | "phrases"
  | "miniStory";

export const LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS = [
  { value: 0.75, label: "0.75×" },
  { value: 1, label: "1×" },
] as const;

export type LanguageAudioPlaybackRate =
  (typeof LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS)[number]["value"];

export const DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE: LanguageAudioPlaybackRate =
  1;

export type LanguageLessonAudioPlayback = {
  key: string;
  status: "loading" | "playing" | "error";
  error: string | null;
};

export type LanguageLessonAudioToggleAction = "play" | "stop" | "ignore";

export function languageLessonAudioKey(
  version: LanguageLessonContentVersion,
  section: LanguageLessonAudioSection,
  index: number,
) {
  return `${version}:${section}:${index}`;
}

export function languageLessonAudioToggleAction(
  playback: LanguageLessonAudioPlayback | null,
  key: string,
): LanguageLessonAudioToggleAction {
  if (playback?.key !== key) return "play";
  if (playback.status === "loading") return "ignore";
  if (playback.status === "playing") return "stop";
  return "play";
}

export function languageLessonAudioButtonLabel(
  text: string,
  status: LanguageLessonAudioPlayback["status"] | "idle",
  accessibleLabel?: string,
) {
  const target = accessibleLabel ?? `pronunciación de ${text}`;

  if (status === "loading") {
    return `Preparando ${target}`;
  }

  if (status === "playing") {
    return `Detener ${target}`;
  }

  return `Reproducir ${target}`;
}

export function languageLessonAudioErrorMessage(
  status: number,
  result: { error?: string; message?: string },
) {
  if (status === 409 && result.error === "LANGUAGE_STORY_AUDIO_UNAVAILABLE") {
    return "El audio de la mini historia todavía no está disponible para este idioma.";
  }

  return result.message ?? "No se pudo preparar la pronunciación.";
}

export function languageLessonAudioStateAfterEnd(
  playback: LanguageLessonAudioPlayback | null,
  key: string,
) {
  return playback?.key === key ? null : playback;
}

export function languageLessonAudioRequest(
  version: LanguageLessonContentVersion,
  section: LanguageLessonAudioSection,
  index: number,
) {
  return { version, section, index };
}

export type PlayableLanguageAudio = {
  currentTime: number;
  playbackRate: number;
  pause(): void;
  play(): Promise<void>;
};

export function applyLanguageAudioPlaybackRate(
  audio: Pick<PlayableLanguageAudio, "playbackRate"> | null,
  playbackRate: LanguageAudioPlaybackRate,
) {
  if (!audio) return;
  audio.playbackRate = playbackRate;
}

export function stopPlayableLanguageAudio(
  audio: PlayableLanguageAudio | null,
) {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

export async function playExclusiveLanguageAudio(
  current: PlayableLanguageAudio | null,
  next: PlayableLanguageAudio,
  playbackRate: LanguageAudioPlaybackRate =
    DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE,
) {
  if (current && current !== next) {
    stopPlayableLanguageAudio(current);
  }

  applyLanguageAudioPlaybackRate(next, playbackRate);
  await next.play();
  return next;
}

export function languageLessonContentForVersion(
  lesson: Pick<
    LanguageLesson,
    "structuredContent" | "simplifiedStructuredContent"
  >,
  version: LanguageLessonContentVersion,
) {
  if (version === "simplified" && lesson.simplifiedStructuredContent) {
    return lesson.simplifiedStructuredContent;
  }

  return lesson.structuredContent ?? null;
}

export function canRegenerateLanguageLesson(
  lesson: Pick<LanguageLesson, "simplifiedStructuredContent">,
) {
  return Boolean(lesson.simplifiedStructuredContent);
}

export function formatLanguageLessonTitle(
  lesson: Pick<LanguageLesson, "lessonSource" | "sourceLessonNumber">,
  language: string,
) {
  switch (lesson.lessonSource) {
    case "assimil":
      return `Assimil ${lesson.sourceLessonNumber}`;
    case "language_framework":
      return `Marco ${language} ${lesson.sourceLessonNumber}`;
    case "free":
      return `Lección libre ${lesson.sourceLessonNumber}`;
  }
}

export function filterLanguageLessons(
  lessons: readonly LanguageLesson[],
  filter: LanguageLessonFilter,
) {
  if (filter === "all") {
    return lessons;
  }

  return lessons.filter((lesson) => lesson.lessonSource === filter);
}

export function languageLessonFilterEmptyMessage(
  filter: LanguageLessonFilter,
) {
  return (
    LANGUAGE_LESSON_FILTER_OPTIONS.find((option) => option.value === filter)
      ?.emptyMessage ?? "No hay lecciones todavía."
  );
}

export function formatLanguageDate(value: string) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
