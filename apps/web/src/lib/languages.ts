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
  { value: "assimil", label: "Assimil" },
  { value: "language_framework", label: "Marco de idiomas" },
  { value: "free", label: "Lección libre" },
] as const;

export type LanguageLessonSource =
  (typeof LANGUAGE_LESSON_SOURCE_OPTIONS)[number]["value"];

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
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export function formatLanguageDate(value: string) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
