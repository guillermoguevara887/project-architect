import assert from "node:assert/strict";
import test from "node:test";
import {
  filterLanguageLessons,
  formatLanguageLessonTitle,
  languageLessonContentForVersion,
  languageLessonFilterEmptyMessage,
  type LanguageLesson,
  type LanguageLessonSource,
  type StructuredLanguageLesson,
} from "../../web/src/lib/languages.js";

function lesson(
  id: string,
  lessonNumber: number,
  lessonSource: LanguageLessonSource,
  sourceLessonNumber: number,
): LanguageLesson {
  return {
    id,
    languageProjectId: "1a1931bf-6389-46a0-bddd-28d88b22e7e2",
    lessonNumber,
    lessonSource,
    sourceLessonNumber,
    status: "draft",
    processedAt: null,
    createdAt: `2026-08-${String(lessonNumber).padStart(2, "0")}T12:00:00.000Z`,
    updatedAt: `2026-08-${String(lessonNumber).padStart(2, "0")}T12:00:00.000Z`,
  };
}

const lessons = [
  lesson("assimil-1", 1, "assimil", 1),
  lesson("framework-1", 2, "language_framework", 1),
  lesson("assimil-2", 3, "assimil", 2),
  lesson("free-1", 4, "free", 1),
  lesson("framework-2", 5, "language_framework", 2),
];

function structuredContent(text: string): StructuredLanguageLesson {
  return {
    vocabulary: [{ term: text, meaning: text, example: null }],
    phrases: [{ text, translation: text, note: null }],
    patterns: [{ name: text, explanation: text, examples: [text] }],
    miniStory: { text },
    automaticThoughts: [{ text }],
    dialogue: [{ speaker: "A", text }],
    nextLevelBridge: [{ base: text, advanced: text, note: text }],
    review: { keyVocabulary: [text], keyPatterns: [text] },
  };
}

test("the all filter returns every lesson in its existing order", () => {
  const filtered = filterLanguageLessons(lessons, "all");

  assert.equal(filtered, lessons);
  assert.deepEqual(
    filtered.map(({ id }) => id),
    ["assimil-1", "framework-1", "assimil-2", "free-1", "framework-2"],
  );
});

test("source filters return only matching lessons without changing feed order", () => {
  assert.deepEqual(
    filterLanguageLessons(lessons, "assimil").map(({ id }) => id),
    ["assimil-1", "assimil-2"],
  );
  assert.deepEqual(
    filterLanguageLessons(lessons, "language_framework").map(({ id }) => id),
    ["framework-1", "framework-2"],
  );
  assert.deepEqual(
    filterLanguageLessons(lessons, "free").map(({ id }) => id),
    ["free-1"],
  );
});

test("an empty source filter has a clear source-specific message", () => {
  const assimilOnly = lessons.filter(
    ({ lessonSource }) => lessonSource === "assimil",
  );

  assert.deepEqual(filterLanguageLessons(assimilOnly, "free"), []);
  assert.equal(
    languageLessonFilterEmptyMessage("free"),
    "No hay lecciones libres todavía.",
  );
  assert.equal(
    languageLessonFilterEmptyMessage("assimil"),
    "No hay lecciones de Assimil todavía.",
  );
});

test("lesson titles continue to use source-specific numbering", () => {
  assert.equal(formatLanguageLessonTitle(lessons[2]!, "Alemán"), "Assimil 2");
  assert.equal(
    formatLanguageLessonTitle(lessons[4]!, "Alemán"),
    "Marco Alemán 2",
  );
  assert.equal(
    formatLanguageLessonTitle(lessons[3]!, "Alemán"),
    "Lección libre 1",
  );
});

test("the displayed lesson version switches locally between persisted content", () => {
  const original = structuredContent("Original");
  const simplified = structuredContent("Simplificada");
  const persistedLesson = {
    ...lessons[0]!,
    structuredContent: original,
    simplifiedStructuredContent: simplified,
  };

  assert.equal(
    languageLessonContentForVersion(persistedLesson, "original"),
    original,
  );
  assert.equal(
    languageLessonContentForVersion(persistedLesson, "simplified"),
    simplified,
  );
});
