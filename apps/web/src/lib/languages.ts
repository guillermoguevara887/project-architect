export type LanguageProject = {
  id: string;
  language: string;
  level: string;
  createdAt: string;
  updatedAt: string;
};

export type LanguageLesson = {
  id: string;
  languageProjectId: string;
  lessonNumber: number;
  sourceContent: string;
  createdAt: string;
  updatedAt: string;
};

export function formatLanguageDate(value: string) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
