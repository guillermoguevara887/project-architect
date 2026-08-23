import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredLanguageLesson } from "../src/languages/contracts.js";
import {
  LanguageLessonProcessingError,
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
};

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

test("the OpenAI lesson processor validates and returns all eight sections", async () => {
  let request: { input?: string; store?: boolean } | null = null;
  const processor = new OpenAILanguageLessonProcessor(async (received) => {
    request = received;
    return { status: "completed", output_parsed: validLesson };
  });

  assert.deepEqual(await processor.process(input), validLesson);
  assert.equal(request?.store, false);
  assert.match(request?.input ?? "", /Idioma objetivo: Francés/);
  assert.match(request?.input ?? "", /Nivel del proyecto: Nivel 1/);
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
  assert.match(request?.instructions ?? "", /mismas ocho secciones/i);
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
