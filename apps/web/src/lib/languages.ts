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
