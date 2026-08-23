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
  resolveLanguageLessonAudioText,
  resolveLanguageStoryAudioConfiguration,
  resolveLanguageStoryAudioLanguage,
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

test("dialogue is a strict voiced positional target resolved from stored content", () => {
  const content = {
    vocabulary: [],
    phrases: [],
    patterns: [],
    miniStory: { text: "Eine gespeicherte Geschichte." },
    automaticThoughts: [],
    dialogue: [
      { speaker: "Anna", text: "Guten Morgen." },
      { speaker: "Thomas", text: "Wie geht es dir?" },
    ],
    nextLevelBridge: [],
    review: { keyVocabulary: [], keyPatterns: [] },
  } satisfies StructuredLanguageLesson;

  for (const voice of ["male", "female"] as const) {
    assert.equal(
      languageLessonAudioRequestSchema.safeParse({
        version: "original",
        section: "dialogue",
        index: 1,
        voice,
      }).success,
      true,
    );
  }

  for (const payload of [
    { version: "original", section: "dialogue", index: 0 },
    {
      version: "original",
      section: "dialogue",
      index: 0,
      voice: "other",
    },
    {
      version: "original",
      section: "dialogue",
      index: 0,
      voice: "female",
      text: "Texto del navegador",
    },
    {
      version: "original",
      section: "dialogue",
      index: 0,
      voice: "female",
      speaker: "Navegador",
    },
  ]) {
    assert.equal(languageLessonAudioRequestSchema.safeParse(payload).success, false);
  }

  assert.equal(
    resolveLanguageLessonAudioText(content, { section: "dialogue", index: 0 }),
    "Guten Morgen.",
  );
  assert.equal(
    resolveLanguageLessonAudioText(content, { section: "dialogue", index: 1 }),
    "Wie geht es dir?",
  );
  assert.equal(
    resolveLanguageLessonAudioText(content, { section: "dialogue", index: 2 }),
    null,
  );
});

test("automatic thoughts are strict positional OpenAI targets", () => {
  const content = {
    vocabulary: [],
    phrases: [],
    patterns: [],
    miniStory: { text: "Eine gespeicherte Geschichte." },
    automaticThoughts: [
      { text: "Ich muss heute früh anfangen." },
      { text: "Ich habe genug Zeit." },
    ],
    dialogue: [],
    nextLevelBridge: [],
    review: { keyVocabulary: [], keyPatterns: [] },
  } satisfies StructuredLanguageLesson;

  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "automaticThoughts",
      index: 0,
    }).success,
    true,
  );
  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "simplified",
      section: "automaticThoughts",
      index: 1,
    }).success,
    true,
  );
  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "automaticThoughts",
      index: 0,
      voice: "female",
    }).success,
    false,
  );
  assert.equal(
    languageLessonAudioRequestSchema.safeParse({
      version: "original",
      section: "automaticThoughts",
      index: 0,
      text: "Texto arbitrario",
    }).success,
    false,
  );
  assert.equal(
    resolveLanguageLessonAudioText(content, {
      section: "automaticThoughts",
      index: 0,
    }),
    "Ich muss heute früh anfangen.",
  );
  assert.equal(
    resolveLanguageLessonAudioText(content, {
      section: "automaticThoughts",
      index: 1,
    }),
    "Ich habe genug Zeit.",
  );
  assert.equal(
    resolveLanguageLessonAudioText(content, {
      section: "automaticThoughts",
      index: 2,
    }),
    null,
  );
});

test("story audio language aliases resolve to canonical codes", () => {
  const aliases = [
    ["de", ["German", " Deutsch ", "Alemán", "Aleman"]],
    ["en", ["English", "Inglés", "Ingles"]],
    ["fr", ["French", "Français", "Francais", "Francés", "Frances"]],
    ["pl", ["Polish", "Polski", "Polaco"]],
    ["ja", ["Japanese", "Japonés", "Japones", "日本語"]],
    ["it", ["Italian", "Italiano"]],
    ["pt", ["Portuguese", "Português", "Portugues", "Portugués"]],
    ["tr", ["Turkish", "Türkçe", "Turkce", "Turco"]],
    ["vi", ["Vietnamese", "Tiếng Việt", "Tieng Viet", "Vietnamita"]],
    ["no", ["Norwegian", "Norsk", "Noruego"]],
  ] as const;

  for (const [expectedCode, languageAliases] of aliases) {
    for (const alias of languageAliases) {
      assert.equal(resolveLanguageStoryAudioLanguage(alias), expectedCode);
    }
  }

  assert.equal(resolveLanguageStoryAudioLanguage("Klingon"), null);
});

test("story audio configuration maps every language and gender at runtime", () => {
  const languages = [
    ["de", "Alemán", "eleven_multilingual_v2", undefined],
    ["en", "English", "eleven_multilingual_v2", undefined],
    ["fr", "Français", "eleven_multilingual_v2", undefined],
    ["pl", "Polski", "eleven_multilingual_v2", undefined],
    ["ja", "日本語", "eleven_multilingual_v2", undefined],
    ["it", "Italiano", "eleven_multilingual_v2", undefined],
    ["pt", "Português", "eleven_multilingual_v2", undefined],
    ["tr", "Türkçe", "eleven_multilingual_v2", undefined],
    ["vi", "Tiếng Việt", "eleven_flash_v2_5", "vi"],
    ["no", "Norsk", "eleven_flash_v2_5", "no"],
  ] as const;

  for (const [code, language, model, languageCode] of languages) {
    for (const voice of ["male", "female"] as const) {
      const expectedEnvironment = `ELEVENLABS_VOICE_ID_${code.toUpperCase()}_${voice.toUpperCase()}`;
      const configuration = resolveLanguageStoryAudioConfiguration(
        language,
        voice,
        (name) => (name === expectedEnvironment ? `${code}-${voice}-voice` : undefined),
      );

      assert.deepEqual(configuration, {
        provider: "elevenlabs",
        model,
        voice: `${code}-${voice}-voice`,
        audioFormat: "mp3_44100_128",
        fileExtension: "mp3",
        contentType: "audio/mpeg",
        ...(languageCode ? { languageCode } : {}),
      });
    }
  }
});

test("story audio voices never fall back across gender, language or provider", () => {
  const requested: string[] = [];
  const configuration = resolveLanguageStoryAudioConfiguration(
    "French",
    "female",
    (name) => {
      requested.push(name);
      if (name === "ELEVENLABS_VOICE_ID_FR_MALE") return "male-voice";
      if (name === "ELEVENLABS_VOICE_ID_DE_FEMALE") return "german-voice";
      return undefined;
    },
  );

  assert.equal(configuration, null);
  assert.deepEqual(requested, ["ELEVENLABS_VOICE_ID_FR_FEMALE"]);
  assert.equal(
    resolveLanguageStoryAudioConfiguration("Klingon", "female", () => "voice"),
    null,
  );
});

test("German story cache identities stay historical across the resolver refactor", () => {
  const base = {
    userId: "user-one",
    language: "Alemán",
    normalizedText: "Eine bekannte Geschichte.",
  };
  const readEnvironment = (name: string) =>
    ({
      ELEVENLABS_VOICE_ID_DE_FEMALE: "historic-female-voice",
      ELEVENLABS_VOICE_ID_DE_MALE: "new-male-voice",
    })[name];
  const femaleConfiguration = resolveLanguageStoryAudioConfiguration(
    "Alemán",
    "female",
    readEnvironment,
  );
  const maleConfiguration = resolveLanguageStoryAudioConfiguration(
    "Alemán",
    "male",
    readEnvironment,
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
  const anotherModelKey = languageAudioStorageKey({
    ...base,
    configuration: {
      ...femaleConfiguration,
      model: "eleven_flash_v2_5",
      languageCode: "vi",
    },
  });

  assert.equal(
    femaleKey,
    "language-audio/abc156285876fc490a65598e6eec906a0e8bd62413086e7b0fd1a2caf0f59a96.mp3",
  );
  assert.equal(
    maleKey,
    "language-audio/91872e1ce255c842c2ad5f6dbc3e2755d74ae12b1e3b248af1222e4bc6b9195f.mp3",
  );
  assert.notEqual(anotherModelKey, femaleKey);
});

test("ElevenLabs adapter uses multilingual configuration without a hardcoded language", async () => {
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
  const configuration = resolveLanguageStoryAudioConfiguration(
    "Alemán",
    "female",
    (name) =>
      name === "ELEVENLABS_VOICE_ID_DE_FEMALE" ? "voice/from env" : undefined,
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
  });
});

test("ElevenLabs adapter sends Flash language codes from configuration", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const provider = new ElevenLabsLanguageAudioProvider(
    async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
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

  for (const [language, voice, code] of [
    ["Vietnamita", "female", "vi"],
    ["Noruego", "male", "no"],
  ] as const) {
    const configuration = resolveLanguageStoryAudioConfiguration(
      language,
      voice,
      () => `${code}-${voice}-voice`,
    );
    assert.ok(configuration);
    await provider.generate({ text: "Historia", language, configuration });
  }

  assert.deepEqual(bodies, [
    {
      text: "Historia",
      model_id: "eleven_flash_v2_5",
      language_code: "vi",
    },
    {
      text: "Historia",
      model_id: "eleven_flash_v2_5",
      language_code: "no",
    },
  ]);
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
  const configuration = resolveLanguageStoryAudioConfiguration(
    "German",
    "male",
    (name) => (name === "ELEVENLABS_VOICE_ID_DE_MALE" ? "voice" : undefined),
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
