import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyLanguageAudioPlaybackRate,
  canRegenerateLanguageLesson,
  createLanguageLessonSubmissionGuard,
  DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE,
  filterLanguageLessons,
  formatLanguageLessonTitle,
  INITIAL_LANGUAGE_LESSON_CREATION_STATE,
  LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS,
  LANGUAGE_LESSON_SOURCE_OPTIONS,
  languageLessonAudioButtonLabel,
  languageLessonAudioErrorMessage,
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
  assert.deepEqual(languageLessonAudioRequest("original", "miniStory", 0), {
    version: "original",
    section: "miniStory",
    index: 0,
  });
  assert.deepEqual(languageLessonAudioRequest("simplified", "miniStory", 0), {
    version: "simplified",
    section: "miniStory",
    index: 0,
  });
  assert.equal(
    "text" in languageLessonAudioRequest("original", "miniStory", 0),
    false,
  );
  assert.equal(
    languageLessonAudioKey("original", "miniStory", 0),
    "original:miniStory:0",
  );
  assert.equal(
    languageLessonAudioKey("simplified", "miniStory", 0),
    "simplified:miniStory:0",
  );
});

test("mini story has concise accessible labels and a controlled unavailable error", () => {
  const story =
    "Lukas ist müde, aber morgen muss er sehr früh aufstehen und zur Arbeit gehen.";

  assert.equal(
    languageLessonAudioButtonLabel(story, "idle", "mini historia"),
    "Reproducir mini historia",
  );
  assert.equal(
    languageLessonAudioButtonLabel(story, "loading", "mini historia"),
    "Preparando mini historia",
  );
  assert.equal(
    languageLessonAudioButtonLabel(story, "playing", "mini historia"),
    "Detener mini historia",
  );
  assert.doesNotMatch(
    languageLessonAudioButtonLabel(story, "idle", "mini historia"),
    /Lukas/,
  );
  assert.equal(
    languageLessonAudioErrorMessage(409, {
      error: "LANGUAGE_STORY_AUDIO_UNAVAILABLE",
      message: "Provider message",
    }),
    "El audio de la mini historia todavía no está disponible para este idioma.",
  );
});

test("mini story shares toggle, stop and exclusive playback with vocabulary and phrases", async () => {
  const miniStoryKey = languageLessonAudioKey("original", "miniStory", 0);
  const events: string[] = [];
  const storyAudio = {
    currentTime: 9,
    playbackRate: 1,
    pause() {
      events.push("pause-story");
    },
    async play() {
      events.push("play-story");
    },
  };
  const vocabularyAudio = {
    currentTime: 0,
    playbackRate: 1,
    pause() {
      events.push("pause-vocabulary");
    },
    async play() {
      events.push("play-vocabulary");
    },
  };
  const phraseAudio = {
    currentTime: 0,
    playbackRate: 1,
    pause() {
      events.push("pause-phrase");
    },
    async play() {
      events.push("play-phrase");
    },
  };

  assert.equal(languageLessonAudioToggleAction(null, miniStoryKey), "play");
  assert.equal(
    languageLessonAudioToggleAction(
      { key: miniStoryKey, status: "playing", error: null },
      miniStoryKey,
    ),
    "stop",
  );
  await playExclusiveLanguageAudio(null, storyAudio, 0.75);
  assert.equal(storyAudio.playbackRate, 0.75);
  await playExclusiveLanguageAudio(storyAudio, vocabularyAudio, 1);
  await playExclusiveLanguageAudio(vocabularyAudio, storyAudio, 0.75);
  await playExclusiveLanguageAudio(storyAudio, phraseAudio, 0.75);
  assert.deepEqual(events, [
    "play-story",
    "pause-story",
    "play-vocabulary",
    "pause-vocabulary",
    "play-story",
    "pause-story",
    "play-phrase",
  ]);
  assert.equal(storyAudio.currentTime, 0);

  stopPlayableLanguageAudio(storyAudio);
  assert.equal(storyAudio.currentTime, 0);
  assert.equal(events.at(-1), "pause-story");
});

test("language audio playback rate defaults to 1x and exposes only supported options", () => {
  assert.equal(DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE, 1);
  assert.deepEqual(LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS, [
    { value: 0.75, label: "0.75×" },
    { value: 1, label: "1×" },
  ]);
});

test("changing playback rate updates current audio without fetching or playing", () => {
  let playCalls = 0;
  const audio = {
    currentTime: 4,
    playbackRate: 1,
    pause() {},
    async play() {
      playCalls += 1;
    },
  };

  applyLanguageAudioPlaybackRate(audio, 0.75);

  assert.equal(audio.playbackRate, 0.75);
  assert.equal(audio.currentTime, 4);
  assert.equal(playCalls, 0);
});

test("new original and simplified audio use the shared selected rate", async () => {
  const observedRates: number[] = [];
  const selectedRate = 0.75;
  const original = {
    currentTime: 0,
    playbackRate: 1,
    pause() {},
    async play() {
      observedRates.push(this.playbackRate);
    },
  };
  const simplified = {
    currentTime: 0,
    playbackRate: 1,
    pause() {},
    async play() {
      observedRates.push(this.playbackRate);
    },
  };

  await playExclusiveLanguageAudio(null, original, selectedRate);
  assert.equal(
    languageLessonAudioStateAfterEnd(
      {
        key: languageLessonAudioKey("original", "vocabulary", 0),
        status: "playing",
        error: null,
      },
      languageLessonAudioKey("original", "vocabulary", 0),
    ),
    null,
  );
  stopPlayableLanguageAudio(original);
  await playExclusiveLanguageAudio(null, simplified, selectedRate);

  assert.deepEqual(observedRates, [0.75, 0.75]);
  assert.equal(original.currentTime, 0);
  assert.equal(simplified.playbackRate, selectedRate);
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
    playbackRate: 0.75,
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
  const rateHandler = component.match(
    /function updateLanguageAudioPlaybackRate\([\s\S]*?\n  }/,
  )?.[0];
  const miniStorySection = component.match(
    /sectionKey="miniStory"[\s\S]*?<\/LessonSection>/,
  )?.[0];
  const generalReadyControls = component.match(
    /\{lesson\.status === "ready" && readyContent \? \([\s\S]*?<ReadyLesson/,
  )?.[0];

  assert.ok(rateHandler);
  assert.ok(miniStorySection);
  assert.ok(generalReadyControls);
  assert.doesNotMatch(rateHandler, /fetch|\.play\(/);
  assert.match(component, /className="lesson-audio-spinner"/);
  assert.match(component, /<StopIcon \/>/);
  assert.match(component, /aria-busy=\{loading\}/);
  assert.match(component, /accessibleLabel="mini historia"/);
  assert.match(component, /onPlay=\{\(\) => onPlayAudio\("miniStory", 0\)\}/);
  assert.match(component, /headerAction=\{/);
  assert.doesNotMatch(component, /autoPlay|autoplay/);
  assert.equal(
    component.match(/className="lesson-audio-rate-selector"/g)?.length,
    1,
  );
  assert.match(miniStorySection, /<LanguageAudioRateControl/);
  assert.doesNotMatch(generalReadyControls, /lesson-audio-rate-control/);
  assert.match(component, /aria-pressed=\{playbackRate === option\.value\}/);
  assert.match(component, /audioElementRef\.current, playbackRate/);
  assert.match(
    component,
    /useState<LanguageAudioPlaybackRate>\(\s*DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE/,
  );
  assert.match(styles, /@keyframes lesson-audio-spin/);
  assert.match(styles, /@keyframes lesson-audio-pulse/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /width: 2\.65rem;[\s\S]*height: 2\.65rem;/);
  assert.match(styles, /\.lesson-section-actions/);
  assert.match(
    component,
    /<Link className="back-link lesson-back-link" href="\/languages">/,
  );
});

test("switching lesson version stops playback without autoplay or generation", async () => {
  const component = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const versionHandler = component.match(
    /onClick=\{\(\) => \{\s*stopLanguageAudio\(\);\s*updateAudioPlayback\(null\);\s*setContentVersion\(option\.value\);[\s\S]*?\}\}/,
  )?.[0];

  assert.ok(versionHandler);
  assert.doesNotMatch(versionHandler, /fetch|playLanguageAudio|\.play\(/);
});

test("lesson audio UI starts the selected audio and stops the previous one", async () => {
  const events: string[] = [];
  const previous = {
    currentTime: 8,
    playbackRate: 1,
    pause() {
      events.push("pause-previous");
    },
    async play() {
      events.push("play-previous");
    },
  };
  const next = {
    currentTime: 0,
    playbackRate: 1,
    pause() {
      events.push("pause-next");
    },
    async play() {
      events.push("play-next");
    },
  };

  assert.equal(await playExclusiveLanguageAudio(previous, next, 0.75), next);
  assert.equal(previous.currentTime, 0);
  assert.equal(next.playbackRate, 0.75);
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
