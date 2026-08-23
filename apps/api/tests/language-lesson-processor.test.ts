import assert from "node:assert/strict";
import test from "node:test";
import {
  generatedStructuredLanguageLessonSchema,
  structuredLanguageLessonSchema,
  type GeneratedStructuredLanguageLesson,
  type StructuredLanguageLesson,
} from "../src/languages/contracts.js";
import {
  isJapaneseLanguage,
  LanguageLessonProcessingError,
  normalizeLanguageLessonKanji,
  OpenAILanguageLessonProcessor,
} from "../src/languages/lesson-processor.js";

const validLesson: StructuredLanguageLesson = {
  vocabulary: [{ term: "bonjour", meaning: "hola", example: null }],
  phrases: [{ text: "Bonjour !", translation: "¡Hola!", note: null }],
  patterns: [
    {
      name: "Je suis …",
      explanation: "Sirve para describirse.",
      examples: ["Je suis prêt."],
    },
  ],
  miniStory: { text: "Paul dit bonjour." },
  automaticThoughts: [{ text: "Je suis prêt." }],
  dialogue: [{ speaker: "Paul", text: "Bonjour !" }],
  nextLevelBridge: [
    {
      base: "Je suis prêt.",
      advanced: "Je suis tout à fait prêt.",
      note: "Añade énfasis.",
    },
  ],
  review: { keyVocabulary: ["bonjour"], keyPatterns: ["Je suis …"] },
  kanji: [],
};

const schoolKanji = {
  word: "学校",
  reading: "がっこう",
  meaning: "escuela",
  components: [
    { character: "学", readingInWord: "がく", meaning: "estudio / aprender" },
    { character: "校", readingInWord: "こう", meaning: "escuela / institución" },
  ],
};

function japaneseLesson(
  kanji: GeneratedStructuredLanguageLesson["kanji"],
): GeneratedStructuredLanguageLesson {
  return {
    ...validLesson,
    vocabulary: [{ term: "学校", meaning: "escuela", example: "学校へ行きます。" }],
    phrases: [{ text: "学校へ行きます。", translation: "Voy a la escuela.", note: null }],
    patterns: [{ name: "へ行きます", explanation: "Indica destino.", examples: ["学校へ行きます。"] }],
    miniStory: { text: "私は毎日学校へ行きます。" },
    automaticThoughts: [{ text: "学校へ行こう。" }],
    dialogue: [{ speaker: "葵", text: "学校へ行きますか。" }],
    nextLevelBridge: [{ base: "学校へ行く。", advanced: "学校へ通う。", note: "Forma más específica." }],
    review: { keyVocabulary: ["学校"], keyPatterns: ["へ行きます"] },
    kanji,
  };
}

const input = {
  language: "Francés",
  level: "Nivel 1",
  sourceContent: "Bonjour !",
};

async function processingErrorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof LanguageLessonProcessingError);
    return error.code;
  }

  assert.fail("Expected lesson processing to fail.");
}

test("persisted and generated lesson schemas separate historical compatibility", () => {
  const { kanji: _kanji, ...historicalLesson } = validLesson;

  assert.equal(structuredLanguageLessonSchema.safeParse(historicalLesson).success, true);
  assert.equal(structuredLanguageLessonSchema.safeParse(validLesson).success, true);
  assert.equal(generatedStructuredLanguageLessonSchema.safeParse(historicalLesson).success, false);
  assert.equal(generatedStructuredLanguageLessonSchema.safeParse({ ...historicalLesson, kanji: [] }).success, true);
  assert.equal(generatedStructuredLanguageLessonSchema.safeParse(japaneseLesson([schoolKanji])).success, true);
  assert.equal(
    generatedStructuredLanguageLessonSchema.safeParse(
      japaneseLesson(Array.from({ length: 4 }, (_, index) => ({
        ...schoolKanji,
        word: `${schoolKanji.word}${index}`,
      }))),
    ).success,
    true,
  );
  assert.equal(
    generatedStructuredLanguageLessonSchema.safeParse(
      japaneseLesson(Array.from({ length: 5 }, () => schoolKanji)),
    ).success,
    false,
  );
  assert.equal(
    generatedStructuredLanguageLessonSchema.safeParse(
      japaneseLesson([{ ...schoolKanji, components: [] }]),
    ).success,
    false,
  );
  assert.equal(
    generatedStructuredLanguageLessonSchema.safeParse(
      japaneseLesson([
        {
          ...schoolKanji,
          components: Array.from({ length: 5 }, () => schoolKanji.components[0]!),
        },
      ]),
    ).success,
    false,
  );
  assert.equal(
    generatedStructuredLanguageLessonSchema.safeParse(
      japaneseLesson([
        {
          ...schoolKanji,
          components: [
            { ...schoolKanji.components[0]!, readingInWord: null },
            schoolKanji.components[1]!,
          ],
        },
      ]),
    ).success,
    true,
  );
  assert.equal(
    generatedStructuredLanguageLessonSchema.safeParse({
      ...japaneseLesson([schoolKanji]),
      unexpected: true,
    }).success,
    false,
  );
});

test("Japanese language detection recognizes supported aliases only", () => {
  for (const language of ["Japanese", " japanese ", "Japonés", "Japones", "日本語"]) {
    assert.equal(isJapaneseLanguage(language), true);
  }
  assert.equal(isJapaneseLanguage("Alemán"), false);
});

test("kanji normalization is language-aware, grounded, ordered and deduplicated", () => {
  const valid = japaneseLesson([schoolKanji]);
  assert.deepEqual(normalizeLanguageLessonKanji("Japonés", valid).kanji, [schoolKanji]);
  assert.deepEqual(normalizeLanguageLessonKanji("Alemán", valid).kanji, []);
  assert.deepEqual(
    normalizeLanguageLessonKanji("Japanese", japaneseLesson([schoolKanji, schoolKanji])).kanji,
    [schoolKanji],
  );
  assert.deepEqual(
    normalizeLanguageLessonKanji(
      "日本語",
      japaneseLesson([{ ...schoolKanji, word: "大学", reading: "だいがく" }]),
    ).kanji,
    [],
  );
  assert.deepEqual(
    normalizeLanguageLessonKanji(
      "日本語",
      japaneseLesson([{ ...schoolKanji, word: "がっこう" }]),
    ).kanji,
    [],
  );
  assert.deepEqual(
    normalizeLanguageLessonKanji(
      "日本語",
      japaneseLesson([{ ...schoolKanji, components: [...schoolKanji.components].reverse() }]),
    ).kanji,
    [],
  );

  const repeated = Array.from({ length: 6 }, (_, index) => ({
    ...schoolKanji,
    word: `学校${index}`,
  })) as GeneratedStructuredLanguageLesson["kanji"];
  const lessonWithManyKanji = japaneseLesson(repeated);
  lessonWithManyKanji.miniStory.text = repeated.map(({ word }) => word).join("。");
  assert.equal(normalizeLanguageLessonKanji("日本語", lessonWithManyKanji).kanji.length, 4);
});

test("the OpenAI lesson processor validates the base sections and required kanji field", async () => {
  let request: {
    input?: string;
    store?: boolean;
    text?: { format?: unknown };
  } | null = null;
  const processor = new OpenAILanguageLessonProcessor(async (received) => {
    request = received;
    return { status: "completed", output_parsed: validLesson };
  });

  assert.deepEqual(await processor.process(input), validLesson);
  assert.equal(request?.store, false);
  assert.match(request?.input ?? "", /Idioma objetivo: Francés/);
  assert.match(request?.input ?? "", /Nivel del proyecto: Nivel 1/);
  const format = request?.text?.format as
    | { schema?: { required?: string[] } }
    | undefined;
  assert.ok(format?.schema?.required?.includes("kanji"));
});

test("a new model response without kanji is invalid", async () => {
  const { kanji: _kanji, ...missingKanji } = validLesson;
  const processor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: missingKanji,
  }));

  assert.equal(await processingErrorCode(processor.process(input)), "invalid_response");
});

test("Japanese generation keeps grounded kanji and non-Japanese generation clears it", async () => {
  const generated = japaneseLesson([schoolKanji]);
  const japaneseProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: generated,
  }));
  const germanProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: generated,
  }));

  assert.deepEqual(
    (await japaneseProcessor.process({ ...input, language: "Japonés" })).kanji,
    [schoolKanji],
  );
  assert.deepEqual(
    (await germanProcessor.process({ ...input, language: "Alemán" })).kanji,
    [],
  );
});

test("simplification transforms structured content with the dedicated prompt and shared schema", async () => {
  let request: {
    input?: string;
    instructions?: string;
    store?: boolean;
  } | null = null;
  const processor = new OpenAILanguageLessonProcessor(async (received) => {
    request = received;
    return { status: "completed", output_parsed: validLesson };
  });

  assert.deepEqual(
    await processor.simplify({
      language: "Francés",
      level: "B2",
      structuredContent: validLesson,
    }),
    validLesson,
  );
  assert.equal(request?.store, false);
  assert.match(request?.instructions ?? "", /simplificador pedagógico/i);
  assert.match(request?.instructions ?? "", /ocho secciones pedagógicas base/i);
  assert.match(request?.instructions ?? "", /kanji: para japonés/i);
  assert.match(request?.instructions ?? "", /vocabulary: 5-7/);
  assert.match(request?.instructions ?? "", /phrases: 4-6/);
  assert.match(request?.instructions ?? "", /patterns: 1-2/);
  assert.match(request?.instructions ?? "", /60-100 palabras/);
  assert.match(request?.instructions ?? "", /automaticThoughts: 5-8/);
  assert.match(request?.instructions ?? "", /dialogue: 6-8/);
  assert.match(request?.instructions ?? "", /nextLevelBridge: 1-2/);
  assert.match(request?.instructions ?? "", /máximo tres elementos/);
  assert.match(request?.instructions ?? "", /MATERIALMENTE/);
  assert.match(request?.input ?? "", /Idioma objetivo: Francés/);
  assert.match(request?.input ?? "", /Nivel del proyecto: B2/);
  assert.match(request?.input ?? "", /Nivel pedagógico objetivo aproximado: B1/);
  assert.match(request?.input ?? "", /LECCIÓN ESTRUCTURADA ORIGINAL/);
  assert.match(request?.input ?? "", /"miniStory"/);
});

test("historical content without kanji can be simplified and Japanese output is normalized", async () => {
  const { kanji: _kanji, ...historicalLesson } = validLesson;
  const historicalProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: validLesson,
  }));
  const japaneseProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: japaneseLesson([schoolKanji, schoolKanji]),
  }));

  assert.deepEqual(
    (
      await historicalProcessor.simplify({
        language: "Francés",
        level: "A2",
        structuredContent: historicalLesson,
      })
    ).kanji,
    [],
  );
  assert.deepEqual(
    (
      await japaneseProcessor.simplify({
        language: "日本語",
        level: "A2",
        structuredContent: historicalLesson,
      })
    ).kanji,
    [schoolKanji],
  );
});

test("simplification rejects output that does not match the existing lesson schema", async () => {
  const { dialogue: _dialogue, ...invalidSimplification } = validLesson;
  const processor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: invalidSimplification,
  }));

  assert.equal(
    await processingErrorCode(
      processor.simplify({
        language: "Francés",
        level: "Nivel 1",
        structuredContent: validLesson,
      }),
    ),
    "invalid_response",
  );
});

test("simplification gives internal levels an explicit complexity reduction target", async () => {
  let requestInput = "";
  const processor = new OpenAILanguageLessonProcessor(async (received) => {
    requestInput = received.input;
    return { status: "completed", output_parsed: validLesson };
  });

  await processor.simplify({
    language: "Francés",
    level: "Nivel 2",
    structuredContent: validLesson,
  });

  assert.match(requestInput, /reducir aproximadamente 35-45% la complejidad/);
});

test("the processor rejects a missing section and arbitrary properties", async () => {
  const { review: _review, ...missingReview } = validLesson;
  const missingProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: missingReview,
  }));
  const extraProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: { ...validLesson, ninthSection: [] },
  }));

  assert.equal(
    await processingErrorCode(missingProcessor.process(input)),
    "invalid_response",
  );
  assert.equal(
    await processingErrorCode(extraProcessor.process(input)),
    "invalid_response",
  );
});

test("the processor rejects incorrect nested structure", async () => {
  const processor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: { ...validLesson, dialogue: "Paul: Bonjour" },
  }));

  assert.equal(
    await processingErrorCode(processor.process(input)),
    "invalid_response",
  );
});

test("the processor distinguishes empty output and refusal", async () => {
  const emptyProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: null,
    output: [],
  }));
  const refusalProcessor = new OpenAILanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: null,
    output: [{ content: [{ type: "refusal", refusal: "Refused" }] }],
  }));

  assert.equal(
    await processingErrorCode(emptyProcessor.process(input)),
    "empty_response",
  );
  assert.equal(
    await processingErrorCode(refusalProcessor.process(input)),
    "refusal",
  );
});

test("the processor converts SDK failures into a provider error", async () => {
  const processor = new OpenAILanguageLessonProcessor(async () => {
    throw new Error("SDK request failed");
  });

  assert.equal(
    await processingErrorCode(processor.process(input)),
    "provider_error",
  );
});
