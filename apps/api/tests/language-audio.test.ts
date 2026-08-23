import assert from "node:assert/strict";
import test from "node:test";
import {
  ElevenLabsLanguageAudioProvider,
  languageAudioStorageKey,
  languageLessonAudioRequestSchema,
  languageStoryVoiceSchema,
  normalizeLanguageAudioText,
  OPENAI_LANGUAGE_AUDIO_CONFIG,
  OpenAILanguageAudioProvider,
  resolveGermanStoryAudioConfiguration,
  resolveLanguageLessonAudioText,
} from "../src/languages/audio.js";
import type { StructuredLanguageLesson } from "../src/languages/contracts.js";
import {
  isLanguageAudioGenerationActive,
  LANGUAGE_AUDIO_GENERATION_TIMEOUT_MS,
} from "../src/languages/audio-repository.js";

test("audio lookup normalization is conservative", () => {
  assert.equal(
    normalizeLanguageAudioText("  Dzień\t dobry\nŚwiecie!  "),
    "Dzień dobry Świecie!",
  );
  assert.equal(normalizeLanguageAudioText("Äpfel"), "Äpfel");
  assert.notEqual(normalizeLanguageAudioText("Äpfel"), "äpfel");
  assert.equal(normalizeLanguageAudioText("Cafe\u0301"), "Café");
});

test("OpenAI audio adapter uses one centralized TTS configuration", async () => {
  let received: Record<string, unknown> | null = null;
  const provider = new OpenAILanguageAudioProvider(async (input) => {
    received = input;
    return Uint8Array.from([73, 68, 51]).buffer;
  });

  assert.deepEqual(
    await provider.generate({
      text: "Dzień dobry",
      language: "Polaco",
      configuration: OPENAI_LANGUAGE_AUDIO_CONFIG,
    }),
    new Uint8Array([73, 68, 51]),
  );
  assert.deepEqual(received, {
    model: "gpt-4o-mini-tts",
    voice: "coral",
    input: "Dzień dobry",
    instructions: "Pronuncia con claridad y naturalidad en Polaco.",
    response_format: "mp3",
  });
});

test("audio storage keys are stable, opaque and separated by language and user", () => {
  const base = {
    userId: "user-one",
    language: "Polaco",
    normalizedText: "Dzień dobry",
  };
  const first = languageAudioStorageKey(base);

  assert.equal(languageAudioStorageKey(base), first);
  assert.equal(
    first,
    "language-audio/0ee6294b0a1f9a78d5ecb19500deb153f5ea9ec56af63529f51ce8619e4f0e59.mp3",
  );
  assert.notEqual(
    languageAudioStorageKey({ ...base, language: "Alemán" }),
    first,
  );
  assert.notEqual(
    languageAudioStorageKey({ ...base, userId: "user-two" }),
    first,
  );
  assert.match(first, /^language-audio\/[a-f0-9]{64}\.mp3$/);
  assert.doesNotMatch(first, /Dzień|dobry/);
});

test("mini story is a safe index-zero target resolved from stored content", () => {
  const content = {
    vocabulary: [],
    phrases: [],
    patterns: [],
    miniStory: { text: "Eine gespeicherte Geschichte." },
    automaticThoughts: [],
    dialogue: [],
    nextLevelBridge: [],
    review: { keyVocabulary: [], keyPatterns: [] },
  } satisfies StructuredLanguageLesson;

  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "miniStory",
      index: 0,
      voice: "female",
    }).success,
    true,
  );
  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "miniStory",
      index: 1,
      voice: "male",
    }).success,
    false,
  );
  assert.equal(
    resolveLanguageLessonAudioText(content, {
      section: "miniStory",
      index: 0,
    }),
    "Eine gespeicherte Geschichte.",
  );
  assert.equal(languageStoryVoiceSchema.safeParse("male").success, true);
  assert.equal(languageStoryVoiceSchema.safeParse("female").success, true);
  assert.equal(languageStoryVoiceSchema.safeParse("other").success, false);
  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "miniStory",
      index: 0,
    }).success,
    false,
  );
  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "miniStory",
      index: 0,
      voice: "other",
    }).success,
    false,
  );
  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "vocabulary",
      index: 0,
      voice: "female",
    }).success,
    false,
  );
});

test("German language variants resolve to one ElevenLabs configuration", () => {
  const variants = ["German", " Deutsch ", "Alemán", "Aleman"];
  const voiceIds = {
    female: "female-voice-from-env",
    male: "male-voice-from-env",
  };
  const configurations = variants.map((language) =>
    resolveGermanStoryAudioConfiguration(language, "female", voiceIds),
  );

  assert.ok(configurations.every(Boolean));
  assert.deepEqual(configurations, configurations.map(() => configurations[0]));
  assert.deepEqual(configurations[0], {
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    voice: "female-voice-from-env",
    audioFormat: "mp3_44100_128",
    fileExtension: "mp3",
    contentType: "audio/mpeg",
  });
  assert.equal(
    resolveGermanStoryAudioConfiguration("Alemán", "male", voiceIds)?.voice,
    "male-voice-from-env",
  );
  assert.equal(
    resolveGermanStoryAudioConfiguration("Polaco", "female", voiceIds),
    null,
  );
  assert.equal(
    resolveGermanStoryAudioConfiguration("Alemán", "female", {
      female: "  ",
      male: "male-voice",
    }),
    null,
  );
  assert.equal(
    resolveGermanStoryAudioConfiguration("Alemán", "male", {
      female: "female-voice",
      male: undefined,
    }),
    null,
  );
});

test("female story cache identity stays historical while male uses another asset", () => {
  const base = {
    userId: "user-one",
    language: "Alemán",
    normalizedText: "Eine bekannte Geschichte.",
  };
  const voiceIds = {
    female: "historic-female-voice",
    male: "new-male-voice",
  };
  const femaleConfiguration = resolveGermanStoryAudioConfiguration(
    "Alemán",
    "female",
    voiceIds,
  );
  const maleConfiguration = resolveGermanStoryAudioConfiguration(
    "Alemán",
    "male",
    voiceIds,
  );
  assert.ok(femaleConfiguration);
  assert.ok(maleConfiguration);

  const femaleKey = languageAudioStorageKey({
    ...base,
    configuration: femaleConfiguration,
  });
  const maleKey = languageAudioStorageKey({
    ...base,
    configuration: maleConfiguration,
  });

  assert.equal(
    femaleKey,
    "language-audio/abc156285876fc490a65598e6eec906a0e8bd62413086e7b0fd1a2caf0f59a96.mp3",
  );
  assert.notEqual(maleKey, femaleKey);
});

test("ElevenLabs adapter sends the required German MP3 request", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;
  const provider = new ElevenLabsLanguageAudioProvider(
    async (url, init) => {
      receivedUrl = String(url);
      receivedInit = init;
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Uint8Array.from([73, 68, 51]).buffer;
        },
      };
    },
    () => "secret-test-key",
  );
  const configuration = resolveGermanStoryAudioConfiguration(
    "Alemán",
    "female",
    { female: "voice/from env", male: "male-voice" },
  );
  assert.ok(configuration);

  const audio = await provider.generate({
    text: "Eine kleine Geschichte.",
    language: "Alemán",
    configuration,
  });

  assert.deepEqual(audio, new Uint8Array([73, 68, 51]));
  assert.equal(
    receivedUrl,
    "https://api.elevenlabs.io/v1/text-to-speech/voice%2Ffrom%20env?output_format=mp3_44100_128",
  );
  assert.equal(receivedInit?.method, "POST");
  assert.deepEqual(receivedInit?.headers, {
    "xi-api-key": "secret-test-key",
    "content-type": "application/json",
    accept: "audio/mpeg",
  });
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), {
    text: "Eine kleine Geschichte.",
    model_id: "eleven_multilingual_v2",
    language_code: "de",
  });
});

test("ElevenLabs adapter rejects non-success responses without reading the body", async () => {
  let arrayBufferRead = false;
  const provider = new ElevenLabsLanguageAudioProvider(
    async () => ({
      ok: false,
      status: 429,
      async arrayBuffer() {
        arrayBufferRead = true;
        return new ArrayBuffer(0);
      },
    }),
    () => "secret-test-key",
  );
  const configuration = resolveGermanStoryAudioConfiguration(
    "German",
    "male",
    { female: "female-voice", male: "voice" },
  );
  assert.ok(configuration);

  await assert.rejects(
    provider.generate({
      text: "Geschichte",
      language: "German",
      configuration,
    }),
    /status 429/,
  );
  assert.equal(arrayBufferRead, false);
});

test("audio generation leases expire and can be reclaimed", () => {
  const now = Date.parse("2026-08-23T12:00:00.000Z");

  assert.equal(
    isLanguageAudioGenerationActive(new Date(now - 1_000), now),
    true,
  );
  assert.equal(
    isLanguageAudioGenerationActive(
      new Date(now - LANGUAGE_AUDIO_GENERATION_TIMEOUT_MS),
      now,
    ),
    false,
  );
  assert.equal(isLanguageAudioGenerationActive(null, now), false);
});
