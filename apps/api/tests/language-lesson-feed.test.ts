import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyLanguageAudioPlaybackRate,
  assignLanguageDialogueVoices,
  canRegenerateLanguageLesson,
  createLanguageLessonSplitSubmissionGuard,
  createLanguageLessonSubmissionGuard,
  createLanguageLessonVerySimplificationSubmissionGuard,
  DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE,
  DEFAULT_LANGUAGE_STORY_VOICE,
  downloadLanguageAudioBlob,
  filterLanguageLessons,
  formatLanguageLessonTitle,
  getOrCreateLanguageAudioElement,
  INITIAL_LANGUAGE_LESSON_CREATION_STATE,
  isAssimilV1LanguageLesson,
  isA1LanguageProjectLevel,
  isPreparedFreeLanguageLesson,
  isJapaneseLanguage,
  LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS,
  LANGUAGE_LESSON_DIFFICULTY_OPTIONS,
  LANGUAGE_LESSON_LEARNING_STATUS_OPTIONS,
  LANGUAGE_LESSON_SOURCE_OPTIONS,
  LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS,
  LANGUAGE_SPLIT_LESSON_CONTENT_VERSION_OPTIONS,
  LANGUAGE_STORY_VOICE_OPTIONS,
  languageDialogueLineIsActive,
  languageFreeAudioDownloadFilename,
  languageFreeVoiceChangeStopsPlayback,
  languageLessonAudioButtonLabel,
  languageAudioPlaybackErrorMessage,
  languageLessonAudioErrorMessage,
  languageLessonAudioKey,
  languageLessonAudioRequest,
  languageLessonAudioStateAfterEnd,
  languageLessonAudioToggleAction,
  languageAssimilPhaseLabel,
  languageAssimilSourceLessonNumberIsValid,
  languageLessonCreationRequest,
  languageLessonCreationReducer,
  languageLessonContentForVersion,
  languageLessonContentVersionOptions,
  languageLessonFilterEmptyMessage,
  languageLessonKanjiCopyText,
  languageLessonCanSplit,
  languageLessonCanVerySimplify,
  languageLessonAllowsSimplification,
  languageLessonShowsProgress,
  languageLessonSplitErrorMessage,
  languageLessonSplitResponseIsValid,
  languageLessonSplitState,
  languageLessonVerySimplificationErrorMessage,
  orderLanguageLessonsPedagogically,
  languageStoryAudioDownloadDisabled,
  languageStoryAudioDownloadFilename,
  languageStoryVoiceChangeStopsPlayback,
  playExclusiveLanguageAudio,
  playLanguageDialogueSequentially,
  stopPlayableLanguageAudio,
  type AssimilLanguageLessonContent,
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
  assert.deepEqual(
    languageLessonAudioRequest("original", "automaticThoughts", 2),
    {
      version: "original",
      section: "automaticThoughts",
      index: 2,
    },
  );
  assert.deepEqual(
    languageLessonAudioRequest("original", "miniStory", 0, "female"),
    {
      version: "original",
      section: "miniStory",
      index: 0,
      voice: "female",
    },
  );
  assert.deepEqual(
    languageLessonAudioRequest("simplified", "miniStory", 0, "male"),
    {
      version: "simplified",
      section: "miniStory",
      index: 0,
      voice: "male",
    },
  );
  assert.deepEqual(
    languageLessonAudioRequest("original", "freeText", 0, "female"),
    {
      version: "original",
      section: "freeText",
      index: 0,
      voice: "female",
    },
  );
  assert.equal(
    "text" in languageLessonAudioRequest("original", "freeText", 0, "female"),
    false,
  );
  assert.equal(
    languageLessonAudioKey("original", "freeText", 0, "male"),
    "original:freeText:0:male",
  );
  assert.equal(
    "text" in
      languageLessonAudioRequest("original", "miniStory", 0, "female"),
    false,
  );
  assert.equal(
    languageLessonAudioKey("original", "miniStory", 0, "female"),
    "original:miniStory:0:female",
  );
  assert.equal(
    languageLessonAudioKey("simplified", "miniStory", 0, "male"),
    "simplified:miniStory:0:male",
  );
  assert.equal(
    languageLessonAudioKey("original", "automaticThoughts", 0),
    "original:automaticThoughts:0",
  );
  assert.equal(
    languageLessonAudioKey("simplified", "automaticThoughts", 1),
    "simplified:automaticThoughts:1",
  );
  assert.deepEqual(
    languageLessonAudioRequest("original", "dialogue", 2, "female"),
    {
      version: "original",
      section: "dialogue",
      index: 2,
      voice: "female",
    },
  );
  assert.equal(
    languageLessonAudioKey("simplified", "dialogue", 1, "male"),
    "simplified:dialogue:1:male",
  );
  assert.equal(
    "speaker" in languageLessonAudioRequest("original", "dialogue", 0, "male"),
    false,
  );
  assert.throws(
    () => languageLessonAudioRequest("original", "miniStory", 0),
    /requires a voice/,
  );
  assert.throws(
    () => languageLessonAudioRequest("original", "dialogue", 0),
    /requires a voice/,
  );
  assert.throws(
    () => languageLessonAudioRequest("original", "vocabulary", 0, "female"),
    /only valid for voiced language audio/,
  );
  assert.throws(
    () =>
      languageLessonAudioRequest(
        "original",
        "automaticThoughts",
        0,
        "male",
      ),
    /only valid for voiced language audio/,
  );
  assert.throws(
    () => languageLessonAudioRequest("original", "freeText", 0),
    /requires a voice/,
  );
  assert.throws(
    () => languageLessonAudioRequest("simplified", "freeText", 0, "female"),
    /original version/,
  );
});

test("dialogue voices stay consistent by normalized speaker order", () => {
  assert.deepEqual(
    assignLanguageDialogueVoices([
      { speaker: " Anna " },
      { speaker: "Thomas" },
      { speaker: "anna" },
      { speaker: " THOMAS " },
      { speaker: "Mika" },
      { speaker: "Sofia" },
      { speaker: "mika" },
    ]),
    ["female", "male", "female", "male", "female", "male", "female"],
  );
});

test("dialogue line activity derives only from matching key and active playback status", () => {
  const key = languageLessonAudioKey("original", "dialogue", 0, "female");

  for (const status of ["loading", "playing"] as const) {
    assert.equal(
      languageDialogueLineIsActive(
        { key, status, error: null },
        "original",
        0,
        "female",
      ),
      true,
    );
  }

  assert.equal(
    languageDialogueLineIsActive(null, "original", 0, "female"),
    false,
  );
  assert.equal(
    languageDialogueLineIsActive(
      { key, status: "error", error: "Error" },
      "original",
      0,
      "female",
    ),
    false,
  );
  assert.equal(
    languageDialogueLineIsActive(
      {
        key: languageLessonAudioKey("original", "dialogue", 1, "male"),
        status: "playing",
        error: null,
      },
      "original",
      0,
      "female",
    ),
    false,
  );
  assert.equal(
    languageDialogueLineIsActive(
      { key, status: "playing", error: null },
      "simplified",
      0,
      "female",
    ),
    false,
  );
});

test("dialogue sequence moves its derived highlight and stop clears it", () => {
  const first = {
    key: languageLessonAudioKey("original", "dialogue", 0, "female"),
    status: "playing" as const,
    error: null,
  };
  const second = {
    key: languageLessonAudioKey("original", "dialogue", 1, "male"),
    status: "loading" as const,
    error: null,
  };

  assert.equal(
    languageDialogueLineIsActive(first, "original", 0, "female"),
    true,
  );
  assert.equal(
    languageDialogueLineIsActive(first, "original", 1, "male"),
    false,
  );
  assert.equal(
    languageDialogueLineIsActive(second, "original", 0, "female"),
    false,
  );
  assert.equal(
    languageDialogueLineIsActive(second, "original", 1, "male"),
    true,
  );
  assert.equal(
    languageDialogueLineIsActive(null, "original", 1, "male"),
    false,
  );
});

test("dialogue sequence requests one line at a time and stops on cancellation or error", async () => {
  const events: string[] = [];
  let releaseLine: (() => void) | null = null;
  const firstRun = playLanguageDialogueSequentially(
    3,
    async (index) => {
      events.push(`start-${index}`);
      await new Promise<void>((resolve) => {
        releaseLine = resolve;
      });
      events.push(`end-${index}`);
      return "ended";
    },
  );

  await Promise.resolve();
  assert.deepEqual(events, ["start-0"]);
  releaseLine?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start-0", "end-0", "start-1"]);
  releaseLine?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start-0", "end-0", "start-1", "end-1", "start-2"]);
  releaseLine?.();
  assert.equal(await firstRun, "completed");

  let active = true;
  assert.equal(
    await playLanguageDialogueSequentially(
      3,
      async () => {
        active = false;
        return "ended";
      },
      () => active,
    ),
    "stopped",
  );
  assert.equal(
    await playLanguageDialogueSequentially(3, async () => "error"),
    "error",
  );
});

test("a reusable audio element receives every dialogue source without being recreated", () => {
  const created: Array<{ src: string }> = [];
  let current: { src: string } | null = null;

  for (const source of ["blob:line-0", "blob:line-1", "blob:line-2"]) {
    current = getOrCreateLanguageAudioElement(current, () => {
      const audio = { src: "" };
      created.push(audio);
      return audio;
    });
    current.src = source;
    assert.equal(current, created[0]);
    assert.equal(current.src, source);
  }

  assert.equal(created.length, 1);
});

test("NotAllowedError is translated without exposing the native WebKit message", () => {
  const nativeMessage =
    "The request is not allowed by the user agent or the platform in the current context.";
  const message = languageAudioPlaybackErrorMessage({
    name: "NotAllowedError",
    message: nativeMessage,
  });

  assert.equal(
    message,
    "El navegador bloqueó la reproducción automática. Toca Reproducir diálogo nuevamente.",
  );
  assert.doesNotMatch(message, /request is not allowed|user agent|platform/i);
  assert.equal(
    languageAudioPlaybackErrorMessage(new Error("Error controlado")),
    "Error controlado",
  );
});

test("story voice options are centralized and default to female", () => {
  assert.equal(DEFAULT_LANGUAGE_STORY_VOICE, "female");
  assert.deepEqual(LANGUAGE_STORY_VOICE_OPTIONS, [
    { value: "male", label: "Hombre" },
    { value: "female", label: "Mujer" },
  ]);
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
  assert.equal(
    languageLessonAudioErrorMessage(409, {
      error: "LANGUAGE_STORY_AUDIO_VOICE_UNAVAILABLE",
    }),
    "La voz seleccionada todavía no está disponible.",
  );
});

test("mini story shares toggle, stop and exclusive playback with vocabulary and phrases", async () => {
  const miniStoryKey = languageLessonAudioKey(
    "original",
    "miniStory",
    0,
    "female",
  );
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

test("automatic thoughts share play, stop, exclusivity and playback rate", async () => {
  const thoughtKey = languageLessonAudioKey(
    "original",
    "automaticThoughts",
    1,
  );
  const events: string[] = [];
  const storyAudio = {
    currentTime: 6,
    playbackRate: 1,
    pause() {
      events.push("pause-story");
    },
    async play() {
      events.push("play-story");
    },
  };
  const thoughtAudio = {
    currentTime: 4,
    playbackRate: 1,
    pause() {
      events.push("pause-thought");
    },
    async play() {
      events.push("play-thought");
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

  await playExclusiveLanguageAudio(storyAudio, thoughtAudio, 0.75);
  assert.equal(thoughtAudio.playbackRate, 0.75);
  assert.equal(storyAudio.currentTime, 0);
  assert.equal(
    languageLessonAudioToggleAction(
      { key: thoughtKey, status: "playing", error: null },
      thoughtKey,
    ),
    "stop",
  );
  stopPlayableLanguageAudio(thoughtAudio);
  assert.equal(thoughtAudio.currentTime, 0);
  await playExclusiveLanguageAudio(thoughtAudio, vocabularyAudio, 1);
  await playExclusiveLanguageAudio(vocabularyAudio, thoughtAudio, 0.75);
  await playExclusiveLanguageAudio(thoughtAudio, phraseAudio, 1);
  assert.deepEqual(events, [
    "pause-story",
    "play-thought",
    "pause-thought",
    "pause-thought",
    "play-vocabulary",
    "pause-vocabulary",
    "play-thought",
    "pause-thought",
    "play-phrase",
  ]);
});

test("mini story download uses a safe filename and revokes its object URL", () => {
  const filename = languageStoryAudioDownloadFilename(
    "Alemán avanzado",
    "simplified",
    "female",
  );
  const events: string[] = [];
  const anchor = {
    href: "",
    download: "",
    click() {
      events.push("click");
    },
    remove() {
      events.push("remove");
    },
  };

  downloadLanguageAudioBlob(new Blob(["ID3"], { type: "audio/mpeg" }), filename, {
    createObjectURL() {
      events.push("create");
      return "blob:private-audio";
    },
    revokeObjectURL(url) {
      events.push(`revoke:${url}`);
    },
    createAnchor() {
      return anchor;
    },
    appendAnchor() {
      events.push("append");
    },
    scheduleCleanup(callback) {
      events.push("schedule");
      callback();
    },
  });

  assert.equal(
    filename,
    "memoos-aleman-avanzado-mini-historia-simplificada-mujer.mp3",
  );
  assert.doesNotMatch(filename, /[0-9a-f]{8}-[0-9a-f-]{27,}|voice/i);
  assert.equal(anchor.href, "blob:private-audio");
  assert.equal(anchor.download, filename);
  assert.deepEqual(events, [
    "create",
    "append",
    "click",
    "remove",
    "schedule",
    "revoke:blob:private-audio",
  ]);
  assert.equal(
    languageStoryAudioDownloadFilename("Deutsch", "original", "male"),
    "memoos-deutsch-mini-historia-original-hombre.mp3",
  );
  assert.equal(
    languageStoryAudioDownloadFilename("Deutsch", "original", "female", "A"),
    "memoos-deutsch-mini-historia-base-mujer.mp3",
  );
  assert.equal(
    languageStoryAudioDownloadFilename(
      "Deutsch",
      "simplified",
      "male",
      "B",
    ),
    "memoos-deutsch-mini-historia-muy-simplificada-hombre.mp3",
  );
});

test("story download blocks duplicate loading and only matching story generation", () => {
  const storyKey = languageLessonAudioKey(
    "original",
    "miniStory",
    0,
    "female",
  );

  assert.equal(languageStoryAudioDownloadDisabled(true, null, storyKey), true);
  assert.equal(
    languageStoryAudioDownloadDisabled(
      false,
      { key: storyKey, status: "loading", error: null },
      storyKey,
    ),
    true,
  );
  assert.equal(
    languageStoryAudioDownloadDisabled(
      false,
      {
        key: languageLessonAudioKey("original", "vocabulary", 0),
        status: "loading",
        error: null,
      },
      storyKey,
    ),
    false,
  );
  assert.equal(
    languageStoryAudioDownloadDisabled(
      false,
      { key: storyKey, status: "playing", error: null },
      storyKey,
    ),
    false,
  );
});

test("changing story voice stops only the visible mini story audio", () => {
  const playingStory = {
    key: languageLessonAudioKey("original", "miniStory", 0, "female"),
    status: "playing" as const,
    error: null,
  };
  const playingVocabulary = {
    key: languageLessonAudioKey("original", "vocabulary", 0),
    status: "playing" as const,
    error: null,
  };
  const playingPhrase = {
    key: languageLessonAudioKey("original", "phrases", 0),
    status: "playing" as const,
    error: null,
  };

  assert.equal(
    languageStoryVoiceChangeStopsPlayback(
      playingStory,
      "original",
      "female",
    ),
    true,
  );
  assert.equal(
    languageStoryVoiceChangeStopsPlayback(
      playingVocabulary,
      "original",
      "female",
    ),
    false,
  );
  assert.equal(
    languageStoryVoiceChangeStopsPlayback(
      playingPhrase,
      "original",
      "female",
    ),
    false,
  );
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
  const languageHelpers = await readFile(
    new URL("../../web/src/lib/languages.ts", import.meta.url),
    "utf8",
  );
  const rateHandler = component.match(
    /function updateLanguageAudioPlaybackRate\([\s\S]*?\n  }/,
  )?.[0];
  const miniStorySection = component.match(
    /sectionKey="miniStory"[\s\S]*?<\/LessonSection>/,
  )?.[0];
  const automaticThoughtsSection = component.match(
    /sectionKey="automaticThoughts"[\s\S]*?<\/LessonSection>/,
  )?.[0];
  const dialogueSection = component.match(
    /sectionKey="dialogue"[\s\S]*?<\/LessonSection>/,
  )?.[0];
  const generalReadyControls = component.match(
    /\{lesson\.status === "ready" && readyContent \? \([\s\S]*?<ReadyLesson/,
  )?.[0];
  const storyVoiceHandler = component.match(
    /function updateLanguageStoryVoice\([\s\S]*?\n  }/,
  )?.[0];
  const storyDownloadHandler = component.match(
    /async function downloadMiniStoryAudio\([\s\S]*?\n  }/,
  )?.[0];
  const dialogueHandler = component.match(
    /async function playDialogueAudio\([\s\S]*?\n  }/,
  )?.[0];
  const stopHandler = component.match(
    /function stopCurrentLanguageAudio\([\s\S]*?\n  }/,
  )?.[0];

  assert.ok(rateHandler);
  assert.ok(miniStorySection);
  assert.ok(automaticThoughtsSection);
  assert.ok(dialogueSection);
  assert.ok(generalReadyControls);
  assert.ok(storyVoiceHandler);
  assert.ok(storyDownloadHandler);
  assert.ok(dialogueHandler);
  assert.ok(stopHandler);
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
  assert.match(miniStorySection, /<LanguageStoryVoiceControl/);
  assert.equal(
    component.match(/className="lesson-story-download-button"/g)?.length,
    2,
  );
  assert.match(miniStorySection, /Descargar MP3/);
  assert.match(miniStorySection, /Preparando descarga…/);
  assert.match(miniStorySection, /onClick=\{onDownloadStory\}/);
  assert.doesNotMatch(automaticThoughtsSection, /Descargar MP3|DownloadIcon/);
  assert.doesNotMatch(component.match(/sectionKey="vocabulary"[\s\S]*?<\/LessonSection>/)?.[0] ?? "", /Descargar MP3/);
  assert.doesNotMatch(component.match(/sectionKey="phrases"[\s\S]*?<\/LessonSection>/)?.[0] ?? "", /Descargar MP3/);
  assert.match(
    automaticThoughtsSection,
    /onPlay=\{\(\) => onPlayAudio\("automaticThoughts", index\)\}/,
  );
  assert.match(dialogueSection, /<LanguageDialogueAudioButton/);
  assert.match(dialogueSection, /accessibleLabel=\{`intervención de \$\{line\.speaker\}`\}/);
  assert.match(
    dialogueSection,
    /onPlayAudio\("dialogue", index, voice\)/,
  );
  assert.match(component, /assignLanguageDialogueVoices\(content\.dialogue\)/);
  assert.match(component, /Reproducir diálogo/);
  assert.match(component, /Detener diálogo/);
  assert.match(dialogueHandler, /playLanguageDialogueSequentially/);
  assert.match(dialogueHandler, /playLanguageAudio\("dialogue", index, voices\[index\], sequenceId\)/);
  assert.doesNotMatch(dialogueHandler, /Promise\.all|map\(.*fetch/);
  assert.match(stopHandler, /audioAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(stopHandler, /stopPlayableLanguageAudio\(audio\)/);
  assert.match(stopHandler, /URL\.revokeObjectURL\(audioObjectUrlRef\.current\)/);
  assert.match(stopHandler, /audio\.onended = null/);
  assert.match(stopHandler, /audio\.onerror = null/);
  assert.match(stopHandler, /audio\.removeAttribute\("src"\)/);
  assert.doesNotMatch(stopHandler, /audioElementRef\.current = null/);
  assert.match(component, /dialogueSequenceIdRef\.current \+= 1/);
  assert.match(component, /audioCompletionRef\.current/);
  assert.equal(component.match(/new Audio\(\)/g)?.length, 1);
  assert.doesNotMatch(component, /new Audio\(audioUrl\)/);
  assert.match(
    component,
    /getOrCreateLanguageAudioElement\(\s*audioElementRef\.current,\s*\(\) => new Audio\(\)/,
  );
  assert.match(component, /audioObjectUrlRef\.current = audioUrl;\s*audio\.src = audioUrl;/);
  assert.match(component, /audio\.onended = \(\) =>/);
  assert.match(component, /audio\.onerror = \(\) =>/);
  assert.ok(
    (component.match(/requestId === audioRequestIdRef\.current/g)?.length ?? 0) >=
      3,
  );
  assert.match(component, /languageAudioPlaybackErrorMessage\(error\)/);
  assert.ok(
    miniStorySection.indexOf("<LanguageStoryVoiceControl") <
      miniStorySection.indexOf("<LanguageAudioRateControl"),
  );
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
  assert.equal(
    component.match(/className="lesson-story-voice-selector"/g)?.length,
    1,
  );
  assert.match(component, /accessibleLabel = "Voz de la mini historia"/);
  assert.match(component, /aria-pressed=\{voice === option\.value\}/);
  assert.match(
    component,
    /useState<LanguageStoryVoice>\(\s*DEFAULT_LANGUAGE_STORY_VOICE/,
  );
  assert.doesNotMatch(storyVoiceHandler, /fetch|\.play\(/);
  assert.match(
    storyDownloadHandler,
    /languageLessonAudioRequest\(version, "miniStory", 0, voice\)/,
  );
  assert.match(storyDownloadHandler, /response\.blob\(\)/);
  assert.match(storyDownloadHandler, /storyDownloadLoadingRef\.current/);
  assert.match(storyDownloadHandler, /languageStoryAudioDownloadDisabled/);
  assert.match(storyDownloadHandler, /languageLessonAudioErrorMessage/);
  assert.doesNotMatch(
    storyDownloadHandler,
    /\.play\(|playLanguageAudio|stopLanguageAudio|playbackRate|storageKey|VOICE_ID|ELEVENLABS|text:/,
  );
  assert.match(styles, /\.lesson-story-voice-selector/);
  assert.match(styles, /\.lesson-story-download-button/);
  assert.match(styles, /\.lesson-thought-audio-item/);
  assert.match(styles, /\.lesson-dialogue-play-button/);
  assert.match(styles, /\.lesson-dialogue-line/);
  assert.match(styles, /\.lesson-dialogue-line\[data-active="true"\]/);
  assert.match(component, /data-active=\{active \? "true" : undefined\}/);
  assert.match(component, /languageDialogueLineIsActive\(/);
  assert.doesNotMatch(component, /useState<[^>]*DialogueLine|activeDialogueLine/);
  assert.doesNotMatch(
    `${component}\n${languageHelpers}`,
    /ELEVENLABS|VOICE_ID|eleven_multilingual|eleven_flash|languageCode|language_code/,
  );
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
    /function selectLanguageLessonContentVersion\([\s\S]*?(?=\n  useEffect)/m,
  )?.[0];

  assert.ok(versionHandler);
  assert.match(versionHandler, /stopLanguageAudio\(\)/);
  assert.match(versionHandler, /updateAudioPlayback\(null\)/);
  assert.match(versionHandler, /setContentVersion\(version\)/);
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
  assert.equal(
    INITIAL_LANGUAGE_LESSON_CREATION_STATE.assimilSourceLessonNumber,
    "",
  );

  const opened = languageLessonCreationReducer(
    INITIAL_LANGUAGE_LESSON_CREATION_STATE,
    { type: "open" },
  );

  assert.equal(opened.status, "choosing");
  assert.equal(opened.lessonSource, "free");
  assert.equal(opened.assimilSourceLessonNumber, "");
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

test("lesson creation keeps and resets the Assimil source number", () => {
  const opened = languageLessonCreationReducer(
    INITIAL_LANGUAGE_LESSON_CREATION_STATE,
    { type: "open" },
  );
  const assimil = languageLessonCreationReducer(opened, {
    type: "select-source",
    lessonSource: "assimil",
  });
  const numbered = languageLessonCreationReducer(assimil, {
    type: "set-assimil-source-lesson-number",
    value: "15",
  });

  assert.equal(assimil.assimilSourceLessonNumber, "");
  assert.equal(numbered.assimilSourceLessonNumber, "15");
  assert.deepEqual(
    languageLessonCreationReducer(
      languageLessonCreationReducer(numbered, { type: "start" }),
      { type: "failed" },
    ),
    {
      status: "choosing",
      lessonSource: "assimil",
      assimilSourceLessonNumber: "15",
    },
  );
  assert.equal(
    languageLessonCreationReducer(numbered, {
      type: "select-source",
      lessonSource: "free",
    }).assimilSourceLessonNumber,
    "",
  );
  assert.equal(
    languageLessonCreationReducer(numbered, {
      type: "select-source",
      lessonSource: "language_framework",
    }).assimilSourceLessonNumber,
    "",
  );
  assert.deepEqual(
    languageLessonCreationReducer(numbered, { type: "cancel" }),
    INITIAL_LANGUAGE_LESSON_CREATION_STATE,
  );
});

test("Assimil source lesson number validation is strict", () => {
  for (const value of ["1", "15", "9999"]) {
    assert.equal(languageAssimilSourceLessonNumberIsValid(value), true);
  }

  for (const value of ["", "0", "-1", "1.5", "10000", "abc", " 15 "]) {
    assert.equal(languageAssimilSourceLessonNumberIsValid(value), false);
  }
});

test("lesson creation requests include a source number only for Assimil", () => {
  assert.deepEqual(
    languageLessonCreationRequest({
      lessonSource: "assimil",
      assimilSourceLessonNumber: "15",
    }),
    { lessonSource: "assimil", sourceLessonNumber: 15 },
  );
  assert.equal(
    languageLessonCreationRequest({
      lessonSource: "assimil",
      assimilSourceLessonNumber: "",
    }),
    null,
  );
  assert.deepEqual(
    languageLessonCreationRequest({
      lessonSource: "language_framework",
      assimilSourceLessonNumber: "15",
    }),
    { lessonSource: "language_framework" },
  );
  assert.deepEqual(
    languageLessonCreationRequest({
      lessonSource: "free",
      assimilSourceLessonNumber: "15",
    }),
    { lessonSource: "free" },
  );
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
    {
      status: "choosing",
      lessonSource: "language_framework",
      assimilSourceLessonNumber: "",
    },
  );
  assert.equal(guard.start(), true);
  assert.equal(guard.start(), false);
  guard.finish();
  assert.equal(guard.start(), true);
});

test("Assimil lesson creation UI requests the real lesson number", async () => {
  const projectComponent = await readFile(
    new URL(
      "../../web/src/components/language-project-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    projectComponent,
    /creation\.lessonSource === "assimil"[\s\S]*?Número de lección Assimil/,
  );
  assert.match(projectComponent, /type="number"/);
  assert.match(projectComponent, /min=\{1\}/);
  assert.match(projectComponent, /max=\{9999\}/);
  assert.match(projectComponent, /step=\{1\}/);
  assert.match(projectComponent, /placeholder="15"/);
  assert.match(
    projectComponent,
    /disabled=\{creating \|\| !creationRequest\}/,
  );
  assert.match(projectComponent, /body: JSON\.stringify\(request\)/);
});

test("prepared free lessons are distinguished from historical structured free lessons", () => {
  const prepared = {
    lessonSource: "free" as const,
    freeTitle: "Una tarde en Berlín",
  };
  const historical = {
    lessonSource: "free" as const,
    freeTitle: null,
  };

  assert.equal(isPreparedFreeLanguageLesson(prepared), true);
  assert.equal(isPreparedFreeLanguageLesson(historical), false);
  assert.equal(
    isPreparedFreeLanguageLesson({
      lessonSource: "assimil" as const,
      freeTitle: "No debe activar el formato libre",
    }),
    false,
  );
});

test("new Assimil lessons are distinguished from drafts and historical content", () => {
  const assimilContent: AssimilLanguageLessonContent = {
    kind: "assimil_v1",
    comprehension: [],
    notes: [],
    patterns: [],
    keyPhrases: [],
    practice: { instructions: "", items: [] },
    review: null,
  };

  assert.equal(
    isAssimilV1LanguageLesson({
      lessonSource: "assimil",
      assimilContent,
    }),
    true,
  );
  assert.equal(
    isAssimilV1LanguageLesson({
      lessonSource: "assimil",
      assimilContent: null,
    }),
    false,
  );
  assert.equal(
    isAssimilV1LanguageLesson({
      lessonSource: "assimil",
      assimilContent: null,
      structuredContent: structuredContent("Legacy Assimil"),
    }),
    false,
  );
  assert.equal(
    isAssimilV1LanguageLesson({
      lessonSource: "language_framework",
      assimilContent,
    }),
    false,
  );
  assert.equal(
    isAssimilV1LanguageLesson({ lessonSource: "free", assimilContent }),
    false,
  );
});

test("Assimil phase labels come directly from the backend phase", () => {
  assert.equal(
    languageAssimilPhaseLabel("impregnation"),
    "Fase de impregnación",
  );
  assert.equal(
    languageAssimilPhaseLabel("activation"),
    "Fase de activación",
  );
});

test("Assimil processing UI stays separate from Framework and Free", async () => {
  const component = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const assimilHandler = component.match(
    /async function processAssimilLesson[\s\S]*?\n  }\n/m,
  )?.[0];
  const frameworkHandler = component.match(
    /async function processLesson[\s\S]*?\n  }\n/m,
  )?.[0];

  assert.ok(assimilHandler);
  assert.ok(frameworkHandler);
  assert.match(component, /Preparar lección Assimil/);
  assert.match(component, /Procesar lección Assimil/);
  assert.match(
    component,
    /lesson\.lessonSource === "assimil"[\s\S]*?onSubmit=\{processAssimilLesson\}/,
  );
  assert.match(
    component,
    /lesson\.lessonSource === "language_framework"[\s\S]*?onSubmit=\{processLesson\}/,
  );
  assert.match(
    component,
    /lesson\.lessonSource === "free"[\s\S]*?onSubmit=\{prepareFreeLesson\}/,
  );
  assert.match(assimilHandler, /\/assimil\/process/);
  assert.match(assimilHandler, /body: JSON\.stringify\(\{ sourceContent \}\)/);
  assert.doesNotMatch(
    assimilHandler.replace("/assimil/process", ""),
    /\/process/,
  );
  assert.match(frameworkHandler, /lessons\/\$\{encodeURIComponent\(lessonId\)\}\/process/);
  assert.doesNotMatch(frameworkHandler, /\/assimil\/process/);
  assert.match(assimilHandler, /setLesson\(result\.lesson\)/);
  assert.match(
    assimilHandler,
    /setSourceContent\(result\.lesson\.sourceContent \?\? sourceContent\)/,
  );
  assert.doesNotMatch(assimilHandler, /setSourceContent\(""\)/);
  assert.match(
    assimilHandler,
    /No se pudo procesar la lección Assimil\. Intenta nuevamente\./,
  );
});

test("Assimil processing and ready states preserve legacy lesson behavior", async () => {
  const component = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(component, /Procesando lección Assimil…/);
  assert.match(
    component,
    /MemoOS está preparando la comprensión, notas y práctica de esta[\s\S]*?lección\./,
  );
  assert.match(
    component,
    /MemoOS está organizando el material en las secciones de la[\s\S]*?lección\./,
  );
  assert.match(
    component,
    /lesson\.status === "ready" && !preparedFreeLesson && !assimilV1Lesson/,
  );
  assert.match(component, /lesson\.status === "ready" && assimilV1Lesson/);
  assert.match(component, /<AssimilReadyLesson/);
  assert.doesNotMatch(component, /Lección Assimil preparada\./);
  assert.match(component, /<ReadyLesson/);
  assert.match(
    component,
    /!assimilV1Lesson && languageLessonAllowsSimplification\(lesson\)/,
  );
  assert.match(component, /const showProgress = languageLessonShowsProgress/);
  assert.match(component, /void deleteLesson\(\)/);
  assert.match(
    component,
    /setLesson\(result\.lesson\);\s*setSourceContent\(result\.lesson\.sourceContent \?\? ""\);/,
  );
});

test("Assimil v1 ready UI uses its own ordered study renderer", async () => {
  const component = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const renderer = component.match(
    /function AssimilReadyLesson\([\s\S]*?\n}\n\nfunction LessonSection/,
  )?.[0];

  assert.ok(renderer);
  const orderedHeadings = [
    "Texto original",
    "Comprensión línea por línea",
    "Notas",
    "Patrones",
    "Frases clave",
    "Práctica",
    "Repaso",
  ];
  let previousHeadingIndex = -1;

  for (const heading of orderedHeadings) {
    const headingIndex = renderer.indexOf(heading, previousHeadingIndex + 1);
    assert.ok(headingIndex > previousHeadingIndex, `${heading} está fuera de orden`);
    previousHeadingIndex = headingIndex;
  }

  assert.match(renderer, /languageAssimilPhaseLabel\(phase\)/);
  assert.match(renderer, /reviewLesson \? \([\s\S]*?Repaso/);
  assert.match(renderer, /navigator\.clipboard\.writeText\(sourceContent\)/);
  assert.match(renderer, /<p className="assimil-original-text">\{sourceContent\}<\/p>/);
  assert.match(renderer, /copiedOriginal \? "Copiado" : "Copiar"/);
  assert.match(renderer, /1_500/);
  assert.match(renderer, /No se pudo copiar el texto original\./);
  assert.match(renderer, /role="alert"/);

  assert.match(renderer, /useState<Set<number>>\(\s*\(\) => new Set\(\)/);
  assert.match(renderer, /revealedTranslations\.has\(index\)/);
  assert.match(renderer, /aria-expanded=\{revealed\}/);
  assert.match(renderer, /revealed \? "Ocultar traducción" : "Ver traducción"/);
  assert.match(renderer, /\{revealed \? \([\s\S]*?\{item\.translation\}/);
  assert.match(renderer, /item\.note !== null \? \([\s\S]*?\{item\.note\}/);

  assert.match(renderer, /\{item\.title\}/);
  assert.match(renderer, /\{item\.explanation\}/);
  assert.match(renderer, /item\.examples\.map/);
  assert.match(renderer, /\{item\.meaning\}/);
  assert.match(renderer, /\{content\.practice\.instructions\}/);
  assert.match(renderer, /revealedAnswers\.has\(index\)/);
  assert.match(renderer, /revealed \? "Ocultar respuesta" : "Ver respuesta"/);
  assert.match(renderer, /\{revealed \? \([\s\S]*?\{item\.answer\}/);
  assert.match(renderer, /\{content\.review \? \([\s\S]*?content\.review\.points\.map/);

  assert.doesNotMatch(renderer, /LessonAudioButton|playLanguageAudio|\/audio/);
  assert.doesNotMatch(renderer, /function ReadyLesson|<ReadyLesson/);
  assert.doesNotMatch(renderer, /Simplificar|simplificada|Dividir en 1A/);
});

test("Assimil v1 routing resets reveals and excludes Framework-only controls", async () => {
  const component = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    component,
    /lesson\.status === "ready" && assimilV1Lesson \? \([\s\S]*?<AssimilReadyLesson[\s\S]*?key=\{lesson\.id\}/,
  );
  assert.match(component, /phase=\{lesson\.assimilPhase\}/);
  assert.match(
    component,
    /reviewLesson=\{lesson\.assimilReviewLesson === true\}/,
  );
  assert.match(component, /sourceContent=\{lesson\.sourceContent \?\? ""\}/);
  assert.match(component, /progressControls=\{progressControls\}/);
  assert.match(
    component,
    /const canSplit =\s*!assimilV1Lesson &&[\s\S]*?languageLessonCanSplit/,
  );
  assert.match(
    component,
    /const allowVerySimplification =\s*!assimilV1Lesson &&/,
  );
  assert.match(
    component,
    /const contentVersionOptions = assimilV1Lesson\s*\? \[\]/,
  );
  assert.match(
    component,
    /lesson\.status === "ready" && !preparedFreeLesson && !assimilV1Lesson[\s\S]*?languageLessonContentForVersion/,
  );
  assert.match(
    component,
    /lesson\.lessonSource === "assimil" &&[\s\S]*?!assimilV1Lesson &&[\s\S]*?!lesson\.structuredContent[\s\S]*?No se pudo mostrar el contenido de esta lección Assimil\./,
  );
  assert.match(component, /<ReadyLesson[\s\S]*?content=\{readyContent\}/);
});

test("Assimil study styles preserve source formatting and fit mobile screens", async () => {
  const styles = await readFile(
    new URL("../../web/src/app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.assimil-original-text\s*\{[\s\S]*?white-space: pre-wrap;/,
  );
  assert.match(styles, /\.assimil-phase-badge\s*\{/);
  assert.match(styles, /\.assimil-comprehension-item/);
  assert.match(styles, /\.assimil-pattern-card/);
  assert.match(styles, /\.assimil-answer/);
  assert.match(
    styles,
    /@media \(max-width: 36rem\)[\s\S]*?\.assimil-section\s*\{[\s\S]*?width: 100%;/,
  );
  assert.match(
    styles,
    /\.assimil-section-header \.copy-button,[\s\S]*?\.assimil-reveal-button\s*\{[\s\S]*?width: 100%;/,
  );
});

test("free lesson audio uses voice-specific keys and safe friendly filenames", () => {
  const active = {
    key: languageLessonAudioKey("original", "freeText", 0, "female"),
    status: "playing" as const,
  };

  assert.equal(languageFreeVoiceChangeStopsPlayback(active, "female"), true);
  assert.equal(languageFreeVoiceChangeStopsPlayback(active, "male"), false);
  assert.equal(
    languageFreeAudioDownloadFilename("  Café / conversación: 你好  ", "male"),
    "memoos-cafe-conversacion-hombre.mp3",
  );
  assert.doesNotMatch(
    languageFreeAudioDownloadFilename("Mi texto", "female"),
    /VOICE_ID|[0-9a-f]{32}/i,
  );
});

test("free lesson UI prepares exact text and keeps copy, audio and download independent", async () => {
  const component = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(component, /\/free\/prepare/);
  assert.match(component, /title: freeTitle,\s*sourceContent/);
  assert.match(component, /Preparar lección libre/);
  assert.match(component, /isPreparedFreeLanguageLesson\(lesson\)/);
  assert.match(component, /<FreeReadyLesson/);
  assert.match(component, /copyFreeLessonField\("title"\)/);
  assert.match(component, /copyFreeLessonField\("text"\)/);
  assert.match(component, /playLanguageAudio\("freeText", 0\)/);
  assert.match(
    component,
    /languageLessonAudioRequest\("original", "freeText", 0, voice\)/,
  );
  assert.doesNotMatch(
    component.match(/async function prepareFreeLesson[\s\S]*?\n  }/m)?.[0] ?? "",
    /process|simplif|OpenAI|ElevenLabs|R2/,
  );
});

test("Free L1 analysis is optional, retryable and does not replace its existing UI", async () => {
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
  const handler = component.match(
    /async function analyzeFreeLesson\(\)[\s\S]*?\n  }\n/m,
  )?.[0];

  assert.ok(handler);
  assert.match(component, /Frases y patrones útiles/);
  assert.match(component, /Extrae hasta 5 estructuras útiles del texto/);
  assert.match(component, /Analizar texto/);
  assert.match(component, /Analizando…/);
  assert.match(component, /analysis\.items\.slice\(0, 5\)/);
  assert.match(component, /analysisError[\s\S]*?role="alert"/);
  assert.match(handler, /analyzingFreeRef\.current/);
  assert.match(handler, /\/free\/analyze/);
  assert.doesNotMatch(handler, /body:|sourceContent|language:|level:|prompt|model/);
  assert.doesNotMatch(component, /Regenerar análisis/);
  assert.match(component, /Copiar título/);
  assert.match(component, /Copiar texto/);
  assert.match(component, /Descargar MP3/);
  assert.match(component, /playLanguageAudio\("freeText", 0\)/);
  assert.match(component, /<LanguageLessonProgressControls/);
  assert.equal(component.match(/new Audio\(\)/g)?.length, 1);
  assert.match(styles, /\.free-lesson-analysis-list/);
  assert.match(styles, /\.free-lesson-analysis-empty/);
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
    splitParentLessonId: null,
    splitPart: null,
    freeTitle: null,
    freeAnalysis: null,
    status: "draft",
    learningStatus: "pending",
    difficulty: null,
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

test("lesson learning progress options expose the required labels and null selects no difficulty", () => {
  assert.deepEqual(LANGUAGE_LESSON_LEARNING_STATUS_OPTIONS, [
    { value: "pending", label: "Pendiente" },
    { value: "in_progress", label: "En curso" },
    { value: "completed", label: "Finalizada" },
  ]);
  assert.deepEqual(LANGUAGE_LESSON_DIFFICULTY_OPTIONS, [
    { value: "easy", label: "Fácil" },
    { value: "normal", label: "Normal" },
    { value: "hard", label: "Difícil" },
  ]);
  assert.ok(
    LANGUAGE_LESSON_DIFFICULTY_OPTIONS.every(
      (option) => null !== option.value,
    ),
  );
});

test("lesson progress UI is ready-only, server-confirmed and accessible", async () => {
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

  assert.match(
    component,
    /showProgress \? \(\s*<LanguageLessonProgressControls/s,
  );
  assert.match(component, /aria-label="Estado de aprendizaje"/);
  assert.match(component, /aria-label="Dificultad percibida"/);
  assert.match(component, /aria-pressed=\{learningStatus === option\.value\}/);
  assert.match(component, /aria-pressed=\{difficulty === option\.value\}/);
  assert.match(component, /disabled=\{updating !== null\}/);
  assert.match(component, /lessons\/\$\{encodeURIComponent\(lessonId\)\}\/progress/);
  assert.match(component, /method: "PATCH"/);
  assert.match(component, /if \(!response\.ok \|\| !result\.lesson\)/);
  assert.match(component, /setLesson\(result\.lesson\)/);
  assert.match(component, /lesson-learning-progress-error" role="alert"/);
  assert.match(styles, /\.lesson-learning-progress-field button\[aria-pressed="true"\]/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);

  assert.match(component, /languageDialogueLineIsActive\(/);
  assert.match(component, /getOrCreateLanguageAudioElement\(/);
  assert.match(component, /\(\) => new Audio\(\)/);
  assert.doesNotMatch(component, /new Audio\(audioUrl\)/);
  assert.match(component, /title="Kanji de la lección"/);
});

test("frontend historical lessons can omit kanji and Japanese aliases are detected", () => {
  const historical = structuredContent("歴史");
  assert.equal(historical.kanji, undefined);
  for (const language of ["Japanese", "Japonés", "Japones", "日本語"]) {
    assert.equal(isJapaneseLanguage(language), true);
  }
  assert.equal(isJapaneseLanguage("Alemán"), false);
});

test("kanji copy is readable and omits a missing reading segment", () => {
  assert.equal(
    languageLessonKanjiCopyText([
      {
        word: "今日",
        reading: "きょう",
        meaning: "hoy",
        components: [
          { character: "今", readingInWord: null, meaning: "ahora" },
          { character: "日", readingInWord: null, meaning: "día" },
        ],
      },
    ]),
    "今日\nLectura: きょう\nSignificado: hoy\n今 — ahora\n日 — día",
  );
});

test("Japanese kanji UI is conditional, ordered, bounded and keeps audio fixes intact", async () => {
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

  assert.match(component, /isJapaneseLanguage\(language\).*Boolean\(content\.kanji\?\.length\)/s);
  assert.match(component, /title="Kanji de la lección"/);
  assert.match(component, /content\.kanji!\.slice\(0, 4\)/);
  assert.ok(component.indexOf('title="Vocabulario"') < component.indexOf('title="Kanji de la lección"'));
  assert.ok(component.indexOf('title="Kanji de la lección"') < component.indexOf('title="Frases"'));
  assert.match(component, /sectionIndexAfterVocabulary\(1\)/);
  assert.match(component, /sectionIndexAfterVocabulary\(7\)/);
  assert.match(component, /MemoOS está organizando el material en las secciones de la lección/);
  assert.doesNotMatch(component, /organizando el material en las ocho secciones/);
  assert.match(styles, /\.lesson-kanji-card/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fit/);

  const kanjiSection = component.slice(
    component.indexOf('{showKanji ? ('),
    component.indexOf('sectionKey="phrases"'),
  );
  assert.doesNotMatch(kanjiSection, /LessonAudioButton|onPlayAudio/);
  assert.match(component, /languageDialogueLineIsActive\(/);
  assert.match(component, /getOrCreateLanguageAudioElement\(/);
  assert.match(component, /\(\) => new Audio\(\)/);
  assert.doesNotMatch(component, /new Audio\(audioUrl\)/);
});

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

test("framework split titles use source numbering and A/B suffixes", () => {
  const root = lessons[1]!;
  const partA = {
    ...root,
    id: "framework-1-a",
    lessonNumber: 20,
    splitParentLessonId: root.id,
    splitPart: "A" as const,
  };
  const partB = {
    ...root,
    id: "framework-1-b",
    lessonNumber: 21,
    splitParentLessonId: root.id,
    splitPart: "B" as const,
  };

  assert.equal(formatLanguageLessonTitle(root, "Alemán"), "Marco Alemán 1");
  assert.equal(formatLanguageLessonTitle(partA, "Alemán"), "Marco Alemán 1A");
  assert.equal(formatLanguageLessonTitle(partB, "Alemán"), "Marco Alemán 1B");
  assert.equal(formatLanguageLessonTitle(lessons[2]!, "Alemán"), "Assimil 2");
  assert.equal(
    formatLanguageLessonTitle(lessons[3]!, "Alemán"),
    "Lección libre 1",
  );
});

test("A1 project detection is conservative", () => {
  for (const level of ["A1", "a1", "A1 Beginner", "A1 - Principiante"]) {
    assert.equal(isA1LanguageProjectLevel(level), true);
  }
  for (const level of ["A10", "A2", "Nivel 1", "Nivel básico"]) {
    assert.equal(isA1LanguageProjectLevel(level), false);
  }
});

test("lesson split state detects complete, absent and inconsistent pairs", () => {
  const parent = lessons[1]!;
  const partA = {
    ...parent,
    id: "framework-1-a",
    lessonNumber: 40,
    splitParentLessonId: parent.id,
    splitPart: "A" as const,
  };
  const partB = {
    ...parent,
    id: "framework-1-b",
    lessonNumber: 41,
    splitParentLessonId: parent.id,
    splitPart: "B" as const,
  };

  assert.deepEqual(languageLessonSplitState(lessons, parent.id), {
    kind: "none",
  });
  assert.deepEqual(
    languageLessonSplitState([...lessons, partB, partA], parent.id),
    { kind: "complete", parts: { A: partA, B: partB } },
  );
  assert.deepEqual(languageLessonSplitState([...lessons, partA], parent.id), {
    kind: "inconsistent",
  });
  assert.deepEqual(languageLessonSplitState([...lessons, partB], parent.id), {
    kind: "inconsistent",
  });
});

test("pedagogical order attaches A then B after each parent without duplicates", () => {
  const firstParent = lessons[1]!;
  const secondParent = lessons[4]!;
  const partA = {
    ...firstParent,
    id: "framework-1-a",
    lessonNumber: 20,
    splitParentLessonId: firstParent.id,
    splitPart: "A" as const,
  };
  const partB = {
    ...firstParent,
    id: "framework-1-b",
    lessonNumber: 21,
    splitParentLessonId: firstParent.id,
    splitPart: "B" as const,
  };
  const secondPartA = {
    ...secondParent,
    id: "framework-2-a",
    lessonNumber: 22,
    splitParentLessonId: secondParent.id,
    splitPart: "A" as const,
  };
  const unordered = [...lessons, partB, secondPartA, partA];
  const ordered = orderLanguageLessonsPedagogically(unordered);

  assert.deepEqual(
    ordered.map(({ id }) => id),
    [
      "assimil-1",
      "framework-1",
      "framework-1-a",
      "framework-1-b",
      "assimil-2",
      "free-1",
      "framework-2",
      "framework-2-a",
    ],
  );
  assert.equal(new Set(ordered.map(({ id }) => id)).size, ordered.length);
  assert.deepEqual(
    orderLanguageLessonsPedagogically(
      filterLanguageLessons(unordered, "language_framework"),
    ).map(({ id }) => id),
    [
      "framework-1",
      "framework-1-a",
      "framework-1-b",
      "framework-2",
      "framework-2-a",
    ],
  );
});

test("split eligibility, response validation and submission guard are deterministic", () => {
  const root = {
    ...lessons[1]!,
    status: "ready" as const,
    structuredContent: structuredContent("Marco"),
  };
  const none = { kind: "none" as const };
  const child = {
    ...root,
    id: "framework-1-a",
    splitParentLessonId: root.id,
    splitPart: "A" as const,
  };
  const otherPart = {
    ...root,
    id: "framework-1-b",
    splitParentLessonId: root.id,
    splitPart: "B" as const,
  };

  assert.equal(languageLessonCanSplit("A1", root, none), true);
  assert.equal(languageLessonCanSplit("A2", root, none), false);
  assert.equal(
    languageLessonCanSplit("A1", { ...root, lessonSource: "free" }, none),
    false,
  );
  assert.equal(languageLessonCanSplit("A1", child, none), false);
  assert.equal(
    languageLessonCanSplit("A1", root, {
      kind: "complete",
      parts: { A: child, B: otherPart },
    }),
    false,
  );
  assert.equal(languageLessonShowsProgress(root, none), true);
  assert.equal(
    languageLessonShowsProgress(root, {
      kind: "complete",
      parts: { A: child, B: otherPart },
    }),
    false,
  );
  assert.equal(languageLessonShowsProgress(child, none), true);
  assert.equal(languageLessonAllowsSimplification(root), true);
  assert.equal(languageLessonAllowsSimplification(child), false);
  assert.equal(
    languageLessonSplitResponseIsValid(
      { parent: root, parts: { A: child, B: otherPart } },
      root.id,
    ),
    true,
  );
  assert.equal(
    languageLessonSplitResponseIsValid(
      { parent: root, parts: { A: otherPart, B: child } },
      root.id,
    ),
    false,
  );

  const guard = createLanguageLessonSplitSubmissionGuard();
  assert.equal(guard.start(), true);
  assert.equal(guard.start(), false);
  guard.finish();
  assert.equal(guard.start(), true);
});

test("split errors use the required accessible Spanish messages", () => {
  assert.equal(
    languageLessonSplitErrorMessage(
      409,
      "LANGUAGE_LESSON_SPLIT_INCONSISTENT",
    ),
    "Las partes de esta lección están incompletas. No se generarán nuevamente.",
  );
  assert.equal(
    languageLessonSplitErrorMessage(409, "LANGUAGE_LESSON_SPLIT_UNAVAILABLE"),
    "Esta lección no se puede dividir.",
  );
  assert.equal(
    languageLessonSplitErrorMessage(409, "LANGUAGE_LESSON_STATE_CHANGED"),
    "La lección cambió mientras se dividía. Recarga e intenta nuevamente.",
  );
  assert.equal(
    languageLessonSplitErrorMessage(502, "LANGUAGE_LESSON_SPLIT_FAILED"),
    "No se pudo dividir la lección. Intenta nuevamente.",
  );
});

test("root and split-child content versions keep technical values with contextual labels", () => {
  assert.deepEqual(LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS, [
    { value: "original", label: "Original" },
    { value: "simplified", label: "Simplificada" },
  ]);
  assert.deepEqual(LANGUAGE_SPLIT_LESSON_CONTENT_VERSION_OPTIONS, [
    { value: "original", label: "Base" },
    { value: "simplified", label: "Muy simplificada" },
  ]);
  assert.equal(LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS[0].value, "original");
  assert.equal(
    LANGUAGE_SPLIT_LESSON_CONTENT_VERSION_OPTIONS[0].value,
    "original",
  );
  assert.equal(
    LANGUAGE_SPLIT_LESSON_CONTENT_VERSION_OPTIONS[1].value,
    "simplified",
  );
  assert.equal(
    languageLessonContentVersionOptions({ splitPart: null }),
    LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS,
  );
  assert.equal(
    languageLessonContentVersionOptions({ splitPart: "A" }),
    LANGUAGE_SPLIT_LESSON_CONTENT_VERSION_OPTIONS,
  );
  assert.equal(
    languageLessonContentVersionOptions({ splitPart: "B" }),
    LANGUAGE_SPLIT_LESSON_CONTENT_VERSION_OPTIONS,
  );
});

test("only ready A1 framework children with base content can be very simplified", () => {
  const root = {
    ...lessons[1]!,
    status: "ready" as const,
    structuredContent: structuredContent("Marco"),
  };
  const childA = {
    ...root,
    id: "framework-1-a",
    splitParentLessonId: root.id,
    splitPart: "A" as const,
  };
  const childB = {
    ...childA,
    id: "framework-1-b",
    splitPart: "B" as const,
  };

  assert.equal(languageLessonCanVerySimplify("A1", childA), true);
  assert.equal(languageLessonCanVerySimplify("A1 inicial", childB), true);
  assert.equal(languageLessonCanVerySimplify("A1", root), false);
  assert.equal(
    languageLessonCanVerySimplify("A1", {
      ...childA,
      lessonSource: "free",
    }),
    false,
  );
  assert.equal(
    languageLessonCanVerySimplify("A1", {
      ...childA,
      lessonSource: "assimil",
    }),
    false,
  );
  assert.equal(languageLessonCanVerySimplify("A2", childA), false);
  assert.equal(
    languageLessonCanVerySimplify("A1", {
      ...childA,
      status: "processing",
    }),
    false,
  );
  assert.equal(
    languageLessonCanVerySimplify("A1", {
      ...childA,
      structuredContent: null,
    }),
    false,
  );
  assert.equal(
    canRegenerateLanguageLesson({
      simplifiedStructuredContent: structuredContent("Muy simple"),
    }),
    true,
  );
});

test("very simplification errors and submission guard are deterministic", () => {
  assert.equal(
    languageLessonVerySimplificationErrorMessage(409, {
      error: "LANGUAGE_LESSON_VERY_SIMPLIFICATION_UNAVAILABLE",
    }),
    "Esta parte no admite una versión muy simplificada.",
  );
  assert.equal(
    languageLessonVerySimplificationErrorMessage(409, {
      error: "LANGUAGE_LESSON_SIMPLIFICATION_PROCESSING",
    }),
    "Ya se está generando una versión simplificada.",
  );
  assert.equal(
    languageLessonVerySimplificationErrorMessage(409, {
      error: "LANGUAGE_LESSON_STATE_CHANGED",
    }),
    "La lección cambió mientras se generaba. Recarga e intenta nuevamente.",
  );
  assert.equal(
    languageLessonVerySimplificationErrorMessage(502, {
      error: "LANGUAGE_LESSON_VERY_SIMPLIFICATION_FAILED",
    }),
    "No se pudo crear la versión muy simplificada. Intenta nuevamente.",
  );

  const guard = createLanguageLessonVerySimplificationSubmissionGuard();
  assert.equal(guard.start(), true);
  assert.equal(guard.start(), false);
  guard.finish();
  assert.equal(guard.start(), true);
});

test("M2B child UI uses the very-simplification endpoint and preserves root behavior", async () => {
  const lessonComponent = await readFile(
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
  const veryHandler = lessonComponent.match(
    /async function verySimplifyLesson\(regenerate = false\)[\s\S]*?(?=\n  async function )/m,
  )?.[0];
  const rootHandler = lessonComponent.match(
    /async function simplifyLesson\(regenerate = false\)[\s\S]*?(?=\n  async function verySimplifyLesson)/m,
  )?.[0];

  assert.ok(veryHandler);
  assert.ok(rootHandler);
  assert.match(veryHandler, /verySimplificationGuard\.current\.start\(\)/);
  assert.match(veryHandler, /\/simplify\/very/);
  assert.doesNotMatch(
    veryHandler,
    /structuredContent|sourceContent|language:|level:|splitPart:|parentId|model|prompt/,
  );
  assert.match(veryHandler, /body: JSON\.stringify\(\{ regenerate \}\)/);
  assert.match(veryHandler, /setLesson\(result\.lesson\)/);
  assert.match(veryHandler, /setContentVersion\("simplified"\)/);
  assert.doesNotMatch(veryHandler, /setLesson\(null\)/);
  assert.match(rootHandler, /\/simplify`/);
  assert.doesNotMatch(rootHandler, /\/simplify\/very/);
  assert.match(lessonComponent, /Crear versión muy simplificada/);
  assert.match(lessonComponent, /verySimplifyLesson\(false\)/);
  assert.match(lessonComponent, /Creando…/);
  assert.match(lessonComponent, /Regenerar versión muy simplificada/);
  assert.match(lessonComponent, /verySimplifyLesson\(true\)/);
  assert.match(lessonComponent, /Regenerando…/);
  assert.match(lessonComponent, /LANGUAGE_LESSON_CONTENT_VERSION_OPTIONS\.map/);
  assert.match(lessonComponent, /contentVersionOptions\.map/);
  assert.match(
    lessonComponent,
    /function selectLanguageLessonContentVersion[\s\S]*?stopLanguageAudio\(\)[\s\S]*?setContentVersion\(version\)/,
  );
  assert.match(lessonComponent, /<ReadyLesson/);
  assert.match(styles, /\.lesson-very-simplification-controls/);
  assert.match(
    styles,
    /\.lesson-reading-text\s*\{[\s\S]*?white-space:\s*pre-(?:line|wrap)/,
  );
});

test("M1C UI reuses split, ready content and progress without exposing child mutations", async () => {
  const lessonComponent = await readFile(
    new URL(
      "../../web/src/components/language-lesson-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const projectComponent = await readFile(
    new URL(
      "../../web/src/components/language-project-screen.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const styles = await readFile(
    new URL("../../web/src/app/globals.css", import.meta.url),
    "utf8",
  );
  const splitHandler = lessonComponent.match(
    /async function splitLanguageLesson\(\)[\s\S]*?\n  }\n/m,
  )?.[0];

  assert.ok(splitHandler);
  assert.match(splitHandler, /splittingGuard\.current\.start\(\)/);
  assert.match(splitHandler, /lessons\/\$\{encodeURIComponent\(lessonId\)\}\/split/);
  assert.match(splitHandler, /method: "POST"/);
  assert.doesNotMatch(splitHandler, /body:|structuredContent|sourceContent|language:|level:|prompt|model/);
  assert.match(splitHandler, /setLesson\(result\.parent\)/);
  assert.match(
    splitHandler,
    /setSplitState\(\{ kind: "complete", parts: result\.parts \}\)/,
  );
  assert.equal(splitHandler.match(/setLesson\(/g)?.length, 1);
  assert.match(lessonComponent, /Dividir en 1A \+ 1B/);
  assert.match(lessonComponent, /Dividiendo…/);
  assert.match(lessonComponent, /Partes de estudio/);
  assert.match(lessonComponent, /Estudia primero 1A y después 1B/);
  assert.match(lessonComponent, /Ver lección fuente/);
  assert.match(lessonComponent, /El progreso se registra en 1A y 1B/);
  assert.match(lessonComponent, /allowSimplification && readyContent/);
  assert.match(lessonComponent, /!splitChild \? \(\s*<footer/s);
  assert.match(lessonComponent, /splitError[\s\S]*?role="alert"/);
  assert.match(lessonComponent, /<ReadyLesson/);
  assert.match(lessonComponent, /<LanguageLessonProgressControls/);
  assert.match(projectComponent, /orderLanguageLessonsPedagogically/);
  assert.match(projectComponent, /language-list-card-child/);
  assert.match(projectComponent, /Parte \{lesson\.splitPart\}/);
  assert.match(styles, /\.lesson-split-action/);
  assert.match(styles, /\.lesson-split-parts-grid/);
  assert.match(styles, /\.language-list-card-child/);
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
