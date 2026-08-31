import assert from "node:assert/strict";
import test from "node:test";
import type {
  GeneratedStructuredLanguageLesson,
  StructuredLanguageLesson,
} from "../src/languages/contracts.js";
import { LanguageLessonProcessingError } from "../src/languages/lesson-processor.js";
import {
  languageLessonMiniStoryLines,
  OpenAILanguageLessonVerySimplifier,
  type LanguageLessonVerySimplificationRequest,
  validateVerySimplifiedLanguageLessonDensity,
  VERY_SIMPLIFICATION_INSTRUCTIONS,
} from "../src/languages/lesson-very-simplifier.js";

const validLesson: GeneratedStructuredLanguageLesson = {
  vocabulary: [
    { term: "ich", meaning: "yo", example: "Ich bin hier." },
    { term: "hier", meaning: "aquí", example: "Ich bin hier." },
    { term: "müde", meaning: "cansado", example: "Ich bin müde." },
  ],
  phrases: [
    { text: "Ich bin hier.", translation: "Estoy aquí.", note: null },
    { text: "Ich bin müde.", translation: "Estoy cansado.", note: null },
    { text: "Ich schlafe.", translation: "Duermo.", note: null },
  ],
  patterns: [
    {
      name: "Ich bin …",
      explanation: "Describe un estado.",
      examples: ["Ich bin hier."],
    },
  ],
  miniStory: { text: "Mia ist hier.\nMia ist müde." },
  automaticThoughts: [
    { text: "Ich bin hier." },
    { text: "Ich bin müde." },
    { text: "Ich schlafe." },
  ],
  dialogue: [
    { speaker: "Mia", text: "Ich bin müde." },
    { speaker: "Tom", text: "Schlaf gut." },
  ],
  nextLevelBridge: [
    {
      base: "Ich bin müde.",
      advanced: "Ich bin sehr müde.",
      note: "Añade intensidad.",
    },
  ],
  review: {
    keyVocabulary: ["müde"],
    keyPatterns: ["Ich bin …"],
  },
  kanji: [],
};

function changedLesson(
  change: (lesson: GeneratedStructuredLanguageLesson) => void,
) {
  const lesson = structuredClone(validLesson);
  change(lesson);
  return lesson;
}

async function processingErrorCode(action: () => Promise<unknown>) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof LanguageLessonProcessingError);
    assert.equal(error.code, "invalid_response");
    return true;
  });
}

test("very simplifier accepts one strict compact structured response", async () => {
  const requests: LanguageLessonVerySimplificationRequest[] = [];
  const simplifier = new OpenAILanguageLessonVerySimplifier(async (request) => {
    requests.push(request);
    return { status: "completed", output_parsed: validLesson };
  });

  const result = await simplifier.simplifyVery({
    language: "Deutsch",
    level: "A1 Beginner",
    splitPart: "A",
    structuredContent: validLesson,
  });

  assert.deepEqual(result, validLesson);
  assert.equal(requests.length, 1);
});

test("very simplifier rejects missing and extra structured fields", async () => {
  for (const output of [
    Object.fromEntries(
      Object.entries(validLesson).filter(([key]) => key !== "dialogue"),
    ),
    { ...validLesson, unexpected: true },
  ]) {
    const simplifier = new OpenAILanguageLessonVerySimplifier(async () => ({
      status: "completed",
      output_parsed: output,
    }));
    await processingErrorCode(() =>
      simplifier.simplifyVery({
        language: "Deutsch",
        level: "A1",
        splitPart: "A",
        structuredContent: validLesson,
      }),
    );
  }
});

test("very simplification density rejects every out-of-range section", () => {
  const invalidLessons = [
    changedLesson((lesson) => lesson.vocabulary.splice(0, 1)),
    changedLesson((lesson) =>
      lesson.vocabulary.push(
        { term: "eins", meaning: "uno", example: null },
        { term: "zwei", meaning: "dos", example: null },
        { term: "drei", meaning: "tres", example: null },
      ),
    ),
    changedLesson((lesson) => lesson.phrases.splice(0, 1)),
    changedLesson((lesson) =>
      lesson.phrases.push(
        { text: "Hallo.", translation: "Hola.", note: null },
        { text: "Tschüss.", translation: "Adiós.", note: null },
        { text: "Danke.", translation: "Gracias.", note: null },
      ),
    ),
    changedLesson((lesson) => lesson.patterns.splice(0)),
    changedLesson((lesson) => lesson.patterns.push(lesson.patterns[0]!)),
    changedLesson((lesson) =>
      lesson.patterns[0]!.examples.push("Ich bin da.", "Ich bin ruhig."),
    ),
    changedLesson((lesson) =>
      lesson.automaticThoughts.push(
        { text: "Ich bin da." },
        { text: "Ich bin ruhig." },
        { text: "Ich bin wach." },
      ),
    ),
    changedLesson((lesson) =>
      lesson.dialogue.push(
        { speaker: "Mia", text: "Danke." },
        { speaker: "Tom", text: "Bitte." },
        { speaker: "Mia", text: "Tschüss." },
      ),
    ),
    changedLesson((lesson) =>
      lesson.nextLevelBridge.push(lesson.nextLevelBridge[0]!),
    ),
    changedLesson((lesson) =>
      lesson.review.keyVocabulary.push("hier", "ich", "schlafen"),
    ),
    changedLesson((lesson) =>
      lesson.review.keyPatterns.push("Ich schlafe."),
    ),
  ];

  for (const lesson of invalidLessons) {
    assert.throws(
      () => validateVerySimplifiedLanguageLessonDensity(lesson),
      (error: unknown) =>
        error instanceof LanguageLessonProcessingError &&
        error.code === "invalid_response",
    );
  }
});

test("mini story accepts one to three non-empty lines and ignores blank lines", () => {
  for (const text of [
    "Eine Zeile.",
    "Eine Zeile.\nZwei Zeilen.",
    "Eine.\nZwei.\nDrei.",
    "\n  Eine.  \n\n Zwei. \n",
  ]) {
    const lesson = changedLesson((candidate) => {
      candidate.miniStory.text = text;
    });
    assert.doesNotThrow(() =>
      validateVerySimplifiedLanguageLessonDensity(lesson),
    );
  }

  assert.deepEqual(languageLessonMiniStoryLines("\n Uno. \n\n Dos.\n"), [
    "Uno.",
    "Dos.",
  ]);
});

test("mini story rejects four non-empty lines without truncation", () => {
  const lesson = changedLesson((candidate) => {
    candidate.miniStory.text = "Eine.\nZwei.\nDrei.\nVier.";
  });
  assert.throws(
    () => validateVerySimplifiedLanguageLessonDensity(lesson),
    LanguageLessonProcessingError,
  );
});

test("very simplifier normalizes Japanese kanji, enforces three, and clears other languages", async () => {
  const JapaneseLesson = changedLesson((lesson) => {
    lesson.vocabulary = [
      { term: "学校", meaning: "escuela", example: "学校です。" },
      { term: "先生", meaning: "profesor", example: "先生です。" },
      { term: "学生", meaning: "estudiante", example: "学生です。" },
    ];
    lesson.kanji = [
      {
        word: "学校",
        reading: "がっこう",
        meaning: "escuela",
        components: [
          { character: "学", readingInWord: "がっ", meaning: "estudio" },
          { character: "校", readingInWord: "こう", meaning: "escuela" },
        ],
      },
      {
        word: "先生",
        reading: "せんせい",
        meaning: "profesor",
        components: [
          { character: "先", readingInWord: "せん", meaning: "antes" },
          { character: "生", readingInWord: "せい", meaning: "vida" },
        ],
      },
      {
        word: "学生",
        reading: "がくせい",
        meaning: "estudiante",
        components: [
          { character: "学", readingInWord: "がく", meaning: "estudio" },
          { character: "生", readingInWord: "せい", meaning: "vida" },
        ],
      },
      {
        word: "不在",
        reading: "ふざい",
        meaning: "ausencia",
        components: [
          { character: "不", readingInWord: "ふ", meaning: "no" },
          { character: "在", readingInWord: "ざい", meaning: "estar" },
        ],
      },
    ];
  });

  const JapaneseSimplifier = new OpenAILanguageLessonVerySimplifier(
    async () => ({ status: "completed", output_parsed: JapaneseLesson }),
  );
  const Japanese = await JapaneseSimplifier.simplifyVery({
    language: "日本語",
    level: "A1",
    splitPart: "B",
    structuredContent: JapaneseLesson,
  });
  assert.deepEqual(
    Japanese.kanji.map(({ word }) => word),
    ["学校", "先生", "学生"],
  );

  const fourGroundedKanji = structuredClone(JapaneseLesson);
  fourGroundedKanji.miniStory.text = "学校。\n先生と学生。\n不在です。";
  await processingErrorCode(() =>
    new OpenAILanguageLessonVerySimplifier(async () => ({
      status: "completed",
      output_parsed: fourGroundedKanji,
    })).simplifyVery({
      language: "日本語",
      level: "A1",
      splitPart: "A",
      structuredContent: JapaneseLesson,
    }),
  );

  const German = await new OpenAILanguageLessonVerySimplifier(async () => ({
    status: "completed",
    output_parsed: { ...JapaneseLesson, kanji: JapaneseLesson.kanji.slice(0, 3) },
  })).simplifyVery({
    language: "Deutsch",
    level: "A1",
    splitPart: "A",
    structuredContent: validLesson,
  });
  assert.deepEqual(German.kanji, []);
});

test("very simplifier sends one server-built request with configured model and store false", async () => {
  const previousModel = process.env.OPENAI_LANGUAGE_MODEL;
  process.env.OPENAI_LANGUAGE_MODEL = "configured-language-model";
  const requests: LanguageLessonVerySimplificationRequest[] = [];

  try {
    const simplifier = new OpenAILanguageLessonVerySimplifier(
      async (request) => {
        requests.push(request);
        return { status: "completed", output_parsed: validLesson };
      },
    );
    await simplifier.simplifyVery({
      language: "Deutsch",
      level: "A1 Beginner",
      splitPart: "B",
      structuredContent: validLesson,
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.model, "configured-language-model");
    assert.equal(requests[0]?.store, false);
    assert.match(requests[0]?.input ?? "", /Idioma objetivo: Deutsch/u);
    assert.match(requests[0]?.input ?? "", /Nivel del proyecto: A1 Beginner/u);
    assert.match(requests[0]?.input ?? "", /Parte de la unidad: B/u);
    assert.match(requests[0]?.input ?? "", /datos no confiables/u);
    assert.match(requests[0]?.input ?? "", /Ich bin hier/u);
  } finally {
    if (previousModel === undefined) delete process.env.OPENAI_LANGUAGE_MODEL;
    else process.env.OPENAI_LANGUAGE_MODEL = previousModel;
  }
});

test("very simplifier uses gpt-5.4-mini fallback and the pedagogical prompt contract", async () => {
  const previousModel = process.env.OPENAI_LANGUAGE_MODEL;
  delete process.env.OPENAI_LANGUAGE_MODEL;
  let request: LanguageLessonVerySimplificationRequest | undefined;

  try {
    await new OpenAILanguageLessonVerySimplifier(async (value) => {
      request = value;
      return { status: "completed", output_parsed: validLesson };
    }).simplifyVery({
      language: "Deutsch",
      level: "A1",
      splitPart: "A",
      structuredContent: validLesson,
    });

    assert.equal(request?.model, "gpt-5.4-mini");
    for (const requirement of [
      /MUY SIMPLIFICADA/u,
      /no infantilices/u,
      /No cambies de tema/u,
      /carga cognitiva/u,
      /único patrón principal/u,
      /1-3 líneas/u,
      /2-4 intervenciones/u,
      /contenido educativo no confiable/u,
    ]) {
      assert.match(VERY_SIMPLIFICATION_INSTRUCTIONS, requirement);
    }
  } finally {
    if (previousModel === undefined) delete process.env.OPENAI_LANGUAGE_MODEL;
    else process.env.OPENAI_LANGUAGE_MODEL = previousModel;
  }
});

test("very simplifier distinguishes refusal, empty, invalid and provider failures", async () => {
  const cases: Array<{
    response?: unknown;
    error?: Error;
    expected: LanguageLessonProcessingError["code"];
  }> = [
    {
      response: {
        output: [{ content: [{ type: "refusal" }] }],
        output_parsed: null,
      },
      expected: "refusal",
    },
    { response: { output_parsed: null }, expected: "empty_response" },
    {
      response: { status: "incomplete", output_parsed: validLesson },
      expected: "invalid_response",
    },
    {
      response: {
        status: "completed",
        output_parsed: changedLesson((lesson) => lesson.vocabulary.splice(0, 1)),
      },
      expected: "invalid_response",
    },
    { error: new Error("provider unavailable"), expected: "provider_error" },
  ];

  for (const entry of cases) {
    const simplifier = new OpenAILanguageLessonVerySimplifier(async () => {
      if (entry.error) throw entry.error;
      return entry.response as {
        status?: string;
        output_parsed?: unknown;
        output?: unknown;
      };
    });
    await assert.rejects(
      () =>
        simplifier.simplifyVery({
          language: "Deutsch",
          level: "A1",
          splitPart: "A",
          structuredContent: validLesson as StructuredLanguageLesson,
        }),
      (error: unknown) => {
        assert.ok(error instanceof LanguageLessonProcessingError);
        assert.equal(error.code, entry.expected);
        return true;
      },
    );
  }
});
