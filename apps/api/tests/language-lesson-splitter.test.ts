import assert from "node:assert/strict";
import test from "node:test";
import type {
  GeneratedStructuredLanguageLesson,
  StructuredLanguageLesson,
} from "../src/languages/contracts.js";
import { LanguageLessonProcessingError } from "../src/languages/lesson-processor.js";
import {
  isA1LanguageLevel,
  OpenAILanguageLessonSplitter,
  splitStructuredLanguageLessonSchema,
} from "../src/languages/lesson-splitter.js";

const partA: GeneratedStructuredLanguageLesson = {
  vocabulary: [{ term: "müde", meaning: "cansado", example: "Ich bin müde." }],
  phrases: [{ text: "Ich bin müde.", translation: "Estoy cansado.", note: null }],
  patterns: [
    {
      name: "Ich bin …",
      explanation: "Describe un estado.",
      examples: ["Ich bin müde."],
    },
  ],
  miniStory: { text: "Lukas ist müde. Er geht heute früh schlafen." },
  automaticThoughts: [{ text: "Ich bin müde." }],
  dialogue: [
    { speaker: "Lukas", text: "Ich bin müde." },
    { speaker: "Anna", text: "Geh schlafen." },
  ],
  nextLevelBridge: [
    {
      base: "Ich bin müde.",
      advanced: "Ich bin sehr müde.",
      note: "Sehr añade intensidad.",
    },
  ],
  review: { keyVocabulary: ["müde"], keyPatterns: ["Ich bin …"] },
  kanji: [],
};

const partB: GeneratedStructuredLanguageLesson = {
  ...partA,
  vocabulary: [
    { term: "aufstehen", meaning: "levantarse", example: "Ich stehe früh auf." },
  ],
  phrases: [
    {
      text: "Ich stehe früh auf.",
      translation: "Me levanto temprano.",
      note: null,
    },
  ],
  miniStory: { text: "Lukas steht morgen früh auf und trinkt einen Kaffee." },
  automaticThoughts: [{ text: "Ich stehe früh auf." }],
  review: { keyVocabulary: ["aufstehen"], keyPatterns: ["Ich stehe … auf"] },
};

const input = {
  language: "Alemán",
  level: "A1 Beginner",
  structuredContent: partA as StructuredLanguageLesson,
};

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof LanguageLessonProcessingError);
    return error.code;
  }

  assert.fail("Expected language lesson splitting to fail.");
}

test("split schema requires strict valid partA and partB lessons", () => {
  assert.equal(
    splitStructuredLanguageLessonSchema.safeParse({ partA, partB }).success,
    true,
  );
  assert.equal(
    splitStructuredLanguageLessonSchema.safeParse({ partA }).success,
    false,
  );
  assert.equal(
    splitStructuredLanguageLessonSchema.safeParse({ partB }).success,
    false,
  );
  assert.equal(
    splitStructuredLanguageLessonSchema.safeParse({
      partA,
      partB,
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    splitStructuredLanguageLessonSchema.safeParse({
      partA: { ...partA, dialogue: "Lukas: Hallo" },
      partB,
    }).success,
    false,
  );
  assert.equal(
    splitStructuredLanguageLessonSchema.safeParse({
      partA,
      partB: { ...partB, review: null },
    }).success,
    false,
  );
});

test("A1 detection is conservative and does not infer arbitrary internal levels", () => {
  for (const level of ["A1", " a1 ", "A1 Beginner", "a1 inicial"]) {
    assert.equal(isA1LanguageLevel(level), true);
  }
  for (const level of ["Nivel 1", "A2", "B1", "Pre-A1", "A10"]) {
    assert.equal(isA1LanguageLevel(level), false);
  }
});

test("one OpenAI request creates both parts with the configured model and store false", async () => {
  const previousModel = process.env.OPENAI_LANGUAGE_MODEL;
  process.env.OPENAI_LANGUAGE_MODEL = "configured-language-model";
  const requests: Array<{
    model: string;
    store: false;
    input: string;
    instructions: string;
    text: { format: unknown };
  }> = [];
  const splitter = new OpenAILanguageLessonSplitter(async (request) => {
    requests.push(request);
    return { status: "completed", output_parsed: { partA, partB } };
  });

  try {
    assert.deepEqual(await splitter.split(input), { partA, partB });
  } finally {
    if (previousModel === undefined) delete process.env.OPENAI_LANGUAGE_MODEL;
    else process.env.OPENAI_LANGUAGE_MODEL = previousModel;
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.model, "configured-language-model");
  assert.equal(requests[0]?.store, false);
  assert.match(requests[0]?.input ?? "", /Idioma objetivo: Alemán/);
  assert.match(requests[0]?.input ?? "", /Nivel persistido del proyecto: A1 Beginner/);
  assert.match(requests[0]?.input ?? "", /LECCIÓN ESTRUCTURADA PARENT/);
  assert.match(requests[0]?.input ?? "", /"miniStory"/);
  assert.ok(requests[0]?.text.format);
});

test("splitter uses gpt-5.4-mini as its fallback model", async () => {
  const previousModel = process.env.OPENAI_LANGUAGE_MODEL;
  delete process.env.OPENAI_LANGUAGE_MODEL;
  let model = "";
  const splitter = new OpenAILanguageLessonSplitter(async (request) => {
    model = request.model;
    return { status: "completed", output_parsed: { partA, partB } };
  });

  try {
    await splitter.split(input);
  } finally {
    if (previousModel !== undefined) process.env.OPENAI_LANGUAGE_MODEL = previousModel;
  }

  assert.equal(model, "gpt-5.4-mini");
});

test("split prompt defines pedagogical progression instead of mechanical cutting", async () => {
  let instructions = "";
  const splitter = new OpenAILanguageLessonSplitter(async (request) => {
    instructions = request.instructions;
    return { status: "completed", output_parsed: { partA, partB } };
  });

  await splitter.split(input);

  assert.match(instructions, /NO dividas arrays por la mitad/i);
  assert.match(instructions, /NO cortes texto mecánicamente/i);
  assert.match(instructions, /fundamento autosuficiente/i);
  assert.match(instructions, /A no puede depender/i);
  assert.match(instructions, /B continúa naturalmente desde A/i);
  assert.match(instructions, /puede apoyarse en lo aprendido en\s+A/i);
  assert.match(instructions, /conservan el tema, contexto, intención comunicativa/i);
  assert.match(instructions, /más manejable y tener menor densidad/i);
  assert.match(instructions, /contenido educativo no\s+confiable/i);
  assert.match(instructions, /partA vocabulary: 3-6/i);
  assert.match(instructions, /partB vocabulary: 3-6/i);
});

test("identical parts and invalid response states are rejected deterministically", async () => {
  const identical = new OpenAILanguageLessonSplitter(async () => ({
    status: "completed",
    output_parsed: { partA, partB: structuredClone(partA) },
  }));
  const incomplete = new OpenAILanguageLessonSplitter(async () => ({
    status: "incomplete",
    output_parsed: { partA, partB },
  }));
  const missingPart = new OpenAILanguageLessonSplitter(async () => ({
    status: "completed",
    output_parsed: { partA },
  }));

  assert.equal(await errorCode(identical.split(input)), "invalid_response");
  assert.equal(await errorCode(incomplete.split(input)), "invalid_response");
  assert.equal(await errorCode(missingPart.split(input)), "invalid_response");
});

test("splitter distinguishes refusal, empty, provider and missing configuration errors", async () => {
  const refusal = new OpenAILanguageLessonSplitter(async () => ({
    status: "completed",
    output_parsed: null,
    output: [{ content: [{ type: "refusal" }] }],
  }));
  const empty = new OpenAILanguageLessonSplitter(async () => ({
    status: "completed",
    output_parsed: null,
    output: [],
  }));
  const provider = new OpenAILanguageLessonSplitter(async () => {
    throw new Error("SDK failed");
  });
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const notConfigured = new OpenAILanguageLessonSplitter();

  try {
    assert.equal(await errorCode(refusal.split(input)), "refusal");
    assert.equal(await errorCode(empty.split(input)), "empty_response");
    assert.equal(await errorCode(provider.split(input)), "provider_error");
    assert.equal(await errorCode(notConfigured.split(input)), "not_configured");
  } finally {
    if (previousApiKey !== undefined) process.env.OPENAI_API_KEY = previousApiKey;
  }
});

test("Kanji is normalized independently for A and B and cleared for other languages", async () => {
  const school = {
    word: "学校",
    reading: "がっこう",
    meaning: "escuela",
    components: [
      { character: "学", readingInWord: "がく", meaning: "estudio" },
      { character: "校", readingInWord: "こう", meaning: "escuela" },
    ],
  };
  const tea = {
    word: "茶",
    reading: "ちゃ",
    meaning: "té",
    components: [{ character: "茶", readingInWord: "ちゃ", meaning: "té" }],
  };
  const japaneseA: GeneratedStructuredLanguageLesson = {
    ...partA,
    vocabulary: [{ term: "学校", meaning: "escuela", example: "学校へ行きます。" }],
    miniStory: { text: "学校へ行きます。" },
    kanji: [school, tea],
  };
  const japaneseB: GeneratedStructuredLanguageLesson = {
    ...partB,
    vocabulary: [{ term: "茶", meaning: "té", example: "茶を飲みます。" }],
    miniStory: { text: "茶を飲みます。" },
    kanji: [tea, school],
  };
  const requester = async () => ({
    status: "completed",
    output_parsed: { partA: japaneseA, partB: japaneseB },
  });

  const japanese = await new OpenAILanguageLessonSplitter(requester).split({
    ...input,
    language: "日本語",
  });
  const german = await new OpenAILanguageLessonSplitter(requester).split(input);

  assert.deepEqual(japanese.partA.kanji, [school]);
  assert.deepEqual(japanese.partB.kanji, [tea]);
  assert.deepEqual(german.partA.kanji, []);
  assert.deepEqual(german.partB.kanji, []);
});
