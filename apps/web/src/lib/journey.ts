export const JOURNEY_SOURCE_TYPES = [
  "url",
  "article",
  "paper",
  "pdf",
  "book",
  "video",
  "personal_note",
  "other",
] as const;

export type JourneySourceType = (typeof JOURNEY_SOURCE_TYPES)[number];

export const JOURNEY_SOURCE_LABELS: Record<JourneySourceType, string> = {
  url: "URL",
  article: "Artículo",
  paper: "Paper",
  pdf: "PDF",
  book: "Libro",
  video: "Video",
  personal_note: "Nota personal",
  other: "Otro",
};

export type JourneyIdea = {
  id: string;
  title: string;
  sourceType: JourneySourceType;
  sourceReference: string;
  createdAt: string;
  updatedAt: string;
};

export type JourneyFeedEntry = {
  id: string;
  ideaId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export function formatJourneyDate(value: string) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
