import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSIMIL_LESSON_INSTRUCTIONS,
  assimilationPhaseForLessonNumber,
  isAssimilReviewLessonNumber,
  normalizeAssimilLanguageLessonContent,
  OpenAIAssimilLanguageLessonProcessor,
  type ProcessAssimilLanguageLessonInput,
} from "../src/languages/assimil-processor.js";
import {
  assimilLanguageLessonContentSchema,
  generatedAssimilLanguageLessonContentSchema,
  type AssimilLanguageLessonContent,
} from "../src/languages/contracts.js";
import { LanguageLessonProcessingError } from "../src/languages/lesson-processor.js";

const sourceContent =
  "Guten Morgen. Ich bin müde. Ich bin bereit. Bis morgen.";

function validContent(
  overrides: Partial<AssimilLanguageLessonContent> = {},
): AssimilLanguageLessonContent {
  return {
    kind: "assimil_v1",
    dialogue: [
      { speaker: "Anna", text: "Guten Morgen." },
      { speaker: "Ben", text: "Ich bin müde." },
    ],
    comprehension: [
      { line: "Guten Morgen.", translation: "Buenos días.", note: null },
      { line: "Ich bin müde.", translation: "Estoy cansado.", note: null },
    ],
    notes: [
      { title: "Gruß", explanation: "Saludo de mañana." },
      { title: "sein", explanation: "Bin es la primera persona." },
      { title: "müde", explanation: "Expresa cansancio." },
    ],
    patterns: [
      {
        pattern: "Ich bin …",
        explanation: "Describe un estado.",
        examples: ["Ich bin bereit."],
      },
    ],
    keyPhrases: [
      { text: "Guten Morgen.", meaning: "Buenos días." },
      { text: "Ich bin müde.", meaning: "Estoy cansado." },
      { text: "Bis morgen.", meaning: "Hasta mañana." },
    ],
    practice: {
      instructions: "Completa.",
      items: [
        { prompt: "Ich ___ müde.", answer: "bin" },
        { prompt: "Bis ___.", answer: "morgen" },
      ],
    },
    review: null,
    ...overrides,
  };
}

const input: ProcessAssimilLanguageLessonInput = {
  language: "Alemán",
  level: "A1",
  sourceLessonNumber: 15,
  sourceContent,
};

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof LanguageLessonProcessingError);
    return error.code;
  }
  assert.fail("Expected Assimil processing to fail.");
}

test("Assimil phase and review helpers derive only from the real lesson number", () => {
  assert.equal(assimilationPhaseForLessonNumber(1), "impregnation");
  assert.equal(assimilationPhaseForLessonNumber(49), "impregnation");
  assert.equal(assimilationPhaseForLessonNumber(50), "activation");
  assert.equal(assimilationPhaseForLessonNumber(9_999), "activation");
  assert.equal(isAssimilReviewLessonNumber(6), false);
  assert.equal(isAssimilReviewLessonNumber(7), true);
  assert.equal(isAssimilReviewLessonNumber(49), true);
  assert.equal(isAssimilReviewLessonNumber(50), false);
  assert.equal(isAssimilReviewLessonNumber(56), true);
});

test("Assimil content schema is strict and enforces independent section bounds", () => {
  assert.equal(assimilLanguageLessonContentSchema.safeParse(validContent()).success, true);
  assert.equal(
    assimilLanguageLessonContentSchema.safeParse({
      ...validContent(),
      miniStory: { text: "No pertenece al contrato Assimil." },
    }).success,
    false,
  );
  assert.equal(
    assimilLanguageLessonContentSchema.safeParse({
      ...validContent(),
      kind: "wrong",
    }).success,
    false,
  );
  assert.equal(
    assimilLanguageLessonContentSchema.safeParse(
      validContent({
        comprehension: Array.from({ length: 31 }, () => ({
          line: "Guten Morgen.",
          translation: "Buenos días.",
          note: null,
        })),
      }),
    ).success,
    false,
  );
  assert.equal(
    assimilLanguageLessonContentSchema.safeParse(
      validContent({ notes: validContent().notes.slice(0, 2) }),
    ).success,
    false,
  );
  assert.equal(
    assimilLanguageLessonContentSchema.safeParse(
      validContent({ patterns: [] }),
    ).success,
    false,
  );
  assert.equal(
    assimilLanguageLessonContentSchema.safeParse(
      validContent({ keyPhrases: validContent().keyPhrases.slice(0, 2) }),
    ).success,
    false,
  );
});

test("Assimil dialogue is optional historically and required for new generated output", () => {
  const { dialogue: _dialogue, ...historical } = validContent();

  assert.equal(
    assimilLanguageLessonContentSchema.safeParse(historical).success,
    true,
  );
  assert.equal(
    generatedAssimilLanguageLessonContentSchema.safeParse(historical).success,
    false,
  );
  assert.equal(
    generatedAssimilLanguageLessonContentSchema.safeParse(
      validContent({ dialogue: [] }),
    ).success,
    true,
  );
  assert.equal(
    generatedAssimilLanguageLessonContentSchema.safeParse(
      validContent({
        dialogue: Array.from({ length: 17 }, (_, index) => ({
          speaker: `Speaker ${index}`,
          text: `Line ${index}`,
        })),
      }),
    ).success,
    false,
  );
  assert.equal(
    generatedAssimilLanguageLessonContentSchema.safeParse(
      validContent({ dialogue: [{ speaker: "", text: "Guten Morgen." }] }),
    ).success,
    false,
  );
  assert.equal(
    generatedAssimilLanguageLessonContentSchema.safeParse(
      validContent({ dialogue: [{ speaker: "Anna", text: "   " }] }),
    ).success,
    false,
  );
});

test("Assimil normalization grounds, deduplicates and source-orders comprehension and key phrases", () => {
  const content = validContent({
    comprehension: [
      { line: "Ich bin müde.", translation: "Estoy cansado.", note: null },
      { line: "Invented.", translation: "Inventada.", note: null },
      { line: "Guten Morgen.", translation: "Buenos días.", note: null },
      { line: "Ich bin müde.", translation: "Duplicada.", note: null },
    ],
    keyPhrases: [
      { text: "Bis morgen.", meaning: "Hasta mañana." },
      { text: "No está.", meaning: "Inventada." },
      { text: "Ich bin müde.", meaning: "Estoy cansado." },
      { text: "Guten Morgen.", meaning: "Buenos días." },
      { text: "Bis morgen.", meaning: "Duplicada." },
    ],
  });
  const normalized = normalizeAssimilLanguageLessonContent(input, content);

  assert.deepEqual(
    normalized.comprehension.map(({ line }) => line),
    ["Guten Morgen.", "Ich bin müde."],
  );
  assert.deepEqual(
    normalized.keyPhrases.map(({ text }) => text),
    ["Guten Morgen.", "Ich bin müde.", "Bis morgen."],
  );
});

test("Assimil dialogue normalization keeps literal unique lines in source order", () => {
  const exactSource = input.sourceContent;
  const normalized = normalizeAssimilLanguageLessonContent(
    input,
    validContent({
      dialogue: [
        { speaker: "Ben", text: "Ich bin müde." },
        { speaker: "Invented", text: "Das wurde erfunden." },
        { speaker: "Anna", text: "Guten Morgen." },
        { speaker: "Ben again", text: "Ich bin müde." },
        { speaker: "Clara", text: "Ich bin bereit." },
      ],
    }),
  );

  assert.deepEqual(normalized.dialogue, [
    { speaker: "Anna", text: "Guten Morgen." },
    { speaker: "Ben", text: "Ich bin müde." },
    { speaker: "Clara", text: "Ich bin bereit." },
  ]);
  assert.equal(input.sourceContent, exactSource);
});

test("Assimil normalization rejects ungrounded comprehension and too few grounded key phrases", () => {
  assert.throws(
    () =>
      normalizeAssimilLanguageLessonContent(
        input,
        validContent({
          comprehension: [
            { line: "Invented.", translation: "Inventada.", note: null },
          ],
        }),
      ),
    LanguageLessonProcessingError,
  );
  assert.throws(
    () =>
      normalizeAssimilLanguageLessonContent(
        input,
        validContent({
          keyPhrases: [
            { text: "Guten Morgen.", meaning: "Buenos días." },
            { text: "Invented one.", meaning: "Inventada." },
            { text: "Invented two.", meaning: "Inventada." },
          ],
        }),
      ),
    LanguageLessonProcessingError,
  );
});

test("Assimil phase controls practice density and review is required only every seventh lesson", () => {
  assert.throws(
    () =>
      normalizeAssimilLanguageLessonContent(
        { ...input, sourceLessonNumber: 50 },
        validContent(),
      ),
    LanguageLessonProcessingError,
  );
  const activation = validContent({
    practice: {
      instructions: "Produce.",
      items: [
        { prompt: "A", answer: "A" },
        { prompt: "B", answer: "B" },
        { prompt: "C", answer: "C" },
      ],
    },
  });
  assert.equal(
    normalizeAssimilLanguageLessonContent(
      { ...input, sourceLessonNumber: 50 },
      activation,
    ).practice.items.length,
    3,
  );
  assert.throws(
    () =>
      normalizeAssimilLanguageLessonContent(
        { ...input, sourceLessonNumber: 14 },
        validContent(),
      ),
    LanguageLessonProcessingError,
  );
  assert.equal(
    normalizeAssimilLanguageLessonContent(
      { ...input, sourceLessonNumber: 14 },
      validContent({ review: { points: ["Punto 1", "Punto 2"] } }),
    ).review?.points.length,
    2,
  );
  assert.throws(
    () =>
      normalizeAssimilLanguageLessonContent(
        input,
        validContent({ review: { points: ["Punto 1", "Punto 2"] } }),
      ),
    LanguageLessonProcessingError,
  );
});

test("OpenAI Assimil processor makes one private structured request with server context", async () => {
  const previousModel = process.env.OPENAI_LANGUAGE_MODEL;
  delete process.env.OPENAI_LANGUAGE_MODEL;
  const requests: Array<Record<string, unknown>> = [];
  const processor = new OpenAIAssimilLanguageLessonProcessor(async (request) => {
    requests.push(request);
    return { status: "completed", output_parsed: validContent() };
  });

  try {
    assert.deepEqual(await processor.process(input), validContent());
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.model, "gpt-5.4-mini");
    assert.equal(requests[0]?.store, false);
    assert.match(String(requests[0]?.input), /Idioma objetivo: Alemán/);
    assert.match(String(requests[0]?.input), /Nivel del proyecto: A1/);
    assert.match(String(requests[0]?.input), /Número real de la lección Assimil: 15/);
    assert.match(String(requests[0]?.input), /Fase Assimil: impregnation/);
    assert.match(String(requests[0]?.input), /Lección de repaso: no/);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /filosofía Assimil/i);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /contenido no confiable/i);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /dialogue extrae únicamente/i);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /Cada text debe ser literal/i);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /No inventes diálogo/i);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /2-16 líneas/i);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /Mini historia/);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /automaticThoughts/);
    assert.match(ASSIMIL_LESSON_INSTRUCTIONS, /nextLevelBridge/);
  } finally {
    if (previousModel === undefined) {
      delete process.env.OPENAI_LANGUAGE_MODEL;
    } else {
      process.env.OPENAI_LANGUAGE_MODEL = previousModel;
    }
  }
});

test("OpenAI Assimil processor honors the shared language model environment variable", async () => {
  const previousModel = process.env.OPENAI_LANGUAGE_MODEL;
  process.env.OPENAI_LANGUAGE_MODEL = "test-assimil-model";
  let model: string | undefined;
  const processor = new OpenAIAssimilLanguageLessonProcessor(async (request) => {
    model = request.model;
    return { status: "completed", output_parsed: validContent() };
  });

  try {
    await processor.process(input);
    assert.equal(model, "test-assimil-model");
  } finally {
    if (previousModel === undefined) delete process.env.OPENAI_LANGUAGE_MODEL;
    else process.env.OPENAI_LANGUAGE_MODEL = previousModel;
  }
});

test("OpenAI Assimil processor distinguishes invalid, refusal, empty and provider failures", async () => {
  const invalid = new OpenAIAssimilLanguageLessonProcessor(async () => ({
    status: "completed",
    output_parsed: { ...validContent(), kind: "wrong" },
  }));
  const refusal = new OpenAIAssimilLanguageLessonProcessor(async () => ({
    status: "completed",
    output: [{ content: [{ type: "refusal" }] }],
  }));
  const empty = new OpenAIAssimilLanguageLessonProcessor(async () => ({
    status: "completed",
  }));
  const provider = new OpenAIAssimilLanguageLessonProcessor(async () => {
    throw new Error("provider failed");
  });

  assert.equal(await errorCode(invalid.process(input)), "invalid_response");
  assert.equal(await errorCode(refusal.process(input)), "refusal");
  assert.equal(await errorCode(empty.process(input)), "empty_response");
  assert.equal(await errorCode(provider.process(input)), "provider_error");
});
