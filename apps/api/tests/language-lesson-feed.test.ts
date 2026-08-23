import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canRegenerateLanguageLesson,
  createLanguageLessonSubmissionGuard,
  filterLanguageLessons,
  formatLanguageLessonTitle,
  INITIAL_LANGUAGE_LESSON_CREATION_STATE,
  LANGUAGE_LESSON_SOURCE_OPTIONS,
  languageLessonAudioButtonLabel,
  languageLessonAudioKey,
  languageLessonAudioRequest,
  languageLessonAudioStateAfterEnd,
  languageLessonAudioToggleAction,
  languageLessonCreationReducer,
  languageLessonContentForVersion,
  languageLessonFilterEmptyMessage,
  playExclusiveLanguageAudio,
  stopPlayableLanguageAudio,
  type LanguageLesson,
  type LanguageLessonSource,
  type StructuredLanguageLesson,
} from "../../web/src/lib/languages.js";

test("lesson audio UI builds positional requests without arbitrary text", () => {
  assert.deepEqual(languageLessonAudioRequest("original", "vocabulary", 2), {
    version: "original",
    section: "vocabulary",
    index: 2,
  });
  assert.deepEqual(languageLessonAudioRequest("simplified", "phrases", 1), {
    version: "simplified",
    section: "phrases",
    index: 1,
  });
});

test("lesson audio idle, loading and playing states expose the correct action", () => {
  const key = languageLessonAudioKey("original", "vocabulary", 0);

  assert.equal(
    languageLessonAudioButtonLabel("müde", "idle"),
    "Reproducir pronunciación de müde",
  );
  assert.equal(languageLessonAudioToggleAction(null, key), "play");
  assert.equal(
    languageLessonAudioButtonLabel("müde", "loading"),
    "Preparando pronunciación de müde",
  );
  assert.equal(
    languageLessonAudioToggleAction(
      { key, status: "loading", error: null },
      key,
    ),
    "ignore",
  );
  assert.equal(
    languageLessonAudioButtonLabel("müde", "playing"),
    "Detener pronunciación de müde",
  );
});

test("a second click stops the same audio without requesting it again", () => {
  const key = languageLessonAudioKey("original", "phrases", 0);
  const audio = {
    currentTime: 7,
    paused: false,
    pause() {
      this.paused = true;
    },
    async play() {},
  };

  assert.equal(
    languageLessonAudioToggleAction(
      { key, status: "playing", error: null },
      key,
    ),
    "stop",
  );
  stopPlayableLanguageAudio(audio);
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
});

test("ending audio clears only the playback that actually ended", () => {
  const firstKey = languageLessonAudioKey("original", "vocabulary", 0);
  const secondKey = languageLessonAudioKey("original", "vocabulary", 1);
  const playing = { key: firstKey, status: "playing" as const, error: null };

  assert.equal(languageLessonAudioStateAfterEnd(playing, firstKey), null);
  assert.equal(languageLessonAudioStateAfterEnd(playing, secondKey), playing);
});

test("an audio error returns to a retryable play action", () => {
  const key = languageLessonAudioKey("simplified", "phrases", 2);
  const error = {
    key,
    status: "error" as const,
    error: "No se pudo reproducir la pronunciación.",
  };

  assert.equal(languageLessonAudioToggleAction(error, key), "play");
  assert.equal(
    languageLessonAudioButtonLabel("Guten Morgen", error.status),
    "Reproducir pronunciación de Guten Morgen",
  );
});

test("lesson audio controls use an accessible spinner and non-color playing cue", async () => {
  const component = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const styles = await readFile(
    new URL("../../web/src/app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(component, /className="lesson-audio-spinner"/);
  assert.match(component, /<StopIcon \/>/);
  assert.match(component, /aria-busy=\{loading\}/);
  assert.match(styles, /@keyframes lesson-audio-spin/);
  assert.match(styles, /@keyframes lesson-audio-pulse/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /width: 2\.65rem;[\s\S]*height: 2\.65rem;/);
});

test("lesson audio UI starts the selected audio and stops the previous one", async () => {
  const events: string[] = [];
  const previous = {
    currentTime: 8,
    pause() {
      events.push("pause-previous");
    },
    async play() {
      events.push("play-previous");
    },
  };
  const next = {
    currentTime: 0,
    pause() {
      events.push("pause-next");
    },
    async play() {
      events.push("play-next");
    },
  };

  assert.equal(await playExclusiveLanguageAudio(previous, next), next);
  assert.equal(previous.currentTime, 0);
  assert.deepEqual(events, ["pause-previous", "play-next"]);
  assert.equal(
    languageLessonAudioToggleAction(
      {
        key: languageLessonAudioKey("original", "vocabulary", 0),
        status: "playing",
        error: null,
      },
      languageLessonAudioKey("original", "vocabulary", 1),
    ),
    "play",
  );
});

test("lesson creation source stays hidden until the primary action opens it", () => {
  assert.equal(INITIAL_LANGUAGE_LESSON_CREATION_STATE.status, "closed");

  const opened = languageLessonCreationReducer(
    INITIAL_LANGUAGE_LESSON_CREATION_STATE,
    { type: "open" },
  );

  assert.equal(opened.status, "choosing");
  assert.equal(opened.lessonSource, "free");
  assert.deepEqual(
    LANGUAGE_LESSON_SOURCE_OPTIONS.map(({ label }) => label),
    ["Assimil", "Marco de idiomas", "Lección libre"],
  );
});

test("cancelling lesson creation closes the source step without submitting", () => {
  const opened = languageLessonCreationReducer(
    INITIAL_LANGUAGE_LESSON_CREATION_STATE,
    { type: "open" },
  );
  const cancelled = languageLessonCreationReducer(opened, { type: "cancel" });

  assert.deepEqual(cancelled, INITIAL_LANGUAGE_LESSON_CREATION_STATE);
});

test("continuing lesson creation keeps the selected source and blocks duplicate submissions", () => {
  const opened = languageLessonCreationReducer(
    INITIAL_LANGUAGE_LESSON_CREATION_STATE,
    { type: "open" },
  );
  const selected = languageLessonCreationReducer(opened, {
    type: "select-source",
    lessonSource: "language_framework",
  });
  const creating = languageLessonCreationReducer(selected, { type: "start" });
  const guard = createLanguageLessonSubmissionGuard();

  assert.equal(creating.status, "creating");
  assert.equal(creating.lessonSource, "language_framework");
  assert.deepEqual(
    languageLessonCreationReducer(creating, { type: "failed" }),
    { status: "choosing", lessonSource: "language_framework" },
  );
  assert.equal(guard.start(), true);
  assert.equal(guard.start(), false);
  guard.finish();
  assert.equal(guard.start(), true);
});

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
  assert.equal(canRegenerateLanguageLesson(persistedLesson), true);
  assert.equal(
    canRegenerateLanguageLesson({ simplifiedStructuredContent: null }),
    false,
  );
});
