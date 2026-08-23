import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyLanguageAudioPlaybackRate,
  assignLanguageDialogueVoices,
  canRegenerateLanguageLesson,
  createLanguageLessonSubmissionGuard,
  DEFAULT_LANGUAGE_AUDIO_PLAYBACK_RATE,
  DEFAULT_LANGUAGE_STORY_VOICE,
  downloadLanguageAudioBlob,
  filterLanguageLessons,
  formatLanguageLessonTitle,
  getOrCreateLanguageAudioElement,
  INITIAL_LANGUAGE_LESSON_CREATION_STATE,
  LANGUAGE_AUDIO_PLAYBACK_RATE_OPTIONS,
  LANGUAGE_LESSON_SOURCE_OPTIONS,
  LANGUAGE_STORY_VOICE_OPTIONS,
  languageDialogueLineIsActive,
  languageLessonAudioButtonLabel,
  languageAudioPlaybackErrorMessage,
  languageLessonAudioErrorMessage,
  languageLessonAudioKey,
  languageLessonAudioRequest,
  languageLessonAudioStateAfterEnd,
  languageLessonAudioToggleAction,
  languageLessonCreationReducer,
  languageLessonContentForVersion,
  languageLessonFilterEmptyMessage,
  languageStoryAudioDownloadDisabled,
  languageStoryAudioDownloadFilename,
  languageStoryVoiceChangeStopsPlayback,
  playExclusiveLanguageAudio,
  playLanguageDialogueSequentially,
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
    /only valid for mini story/,
  );
  assert.throws(
    () =>
      languageLessonAudioRequest(
        "original",
        "automaticThoughts",
        0,
        "male",
      ),
    /only valid for mini story/,
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
    1,
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
  assert.match(component, /aria-label="Voz de la mini historia"/);
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
