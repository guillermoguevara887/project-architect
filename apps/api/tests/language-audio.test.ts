import assert from "node:assert/strict";
import test from "node:test";
import {
  languageAudioStorageKey,
  normalizeLanguageAudioText,
  OpenAILanguageAudioProvider,
} from "../src/languages/audio.js";
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
    await provider.generate({ text: "Dzień dobry", language: "Polaco" }),
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
