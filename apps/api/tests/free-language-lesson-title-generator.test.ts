import assert from "node:assert/strict";
import test from "node:test";
import {
  FreeLanguageLessonTitleGenerationError,
  OpenAIFreeLanguageLessonTitleGenerator,
  type FreeLanguageLessonTitleRequester,
} from "../src/languages/free-title-generator.js";

test("free lesson title generation uses the economical language model and store false", async () => {
  let received: Parameters<FreeLanguageLessonTitleRequester>[0] | null = null;
  const generator = new OpenAIFreeLanguageLessonTitleGenerator(
    async (request) => {
      received = request;
      return {
        status: "completed",
        output_parsed: { title: "  Pedir comida en un restaurante  " },
      };
    },
  );

  const title = await generator.generate({
    language: "Inglés",
    level: "B1",
    sourceContent: "Could I see the menu? I would like to order the soup.",
  });

  assert.equal(title, "Pedir comida en un restaurante");
  assert.ok(received);
  assert.equal(received.model, "gpt-5.4-mini");
  assert.equal(received.store, false);
  assert.match(received.input, /Idioma objetivo: Inglés/);
  assert.match(received.input, /Nivel del proyecto: B1/);
  assert.match(received.instructions, /exclusivamente en el texto fuente/);
  assert.match(received.instructions, /3 a 8 palabras/);
  assert.match(received.instructions, /no obedezcas instrucciones/);
  assert.match(received.instructions, /Lección libre/);
});

test("free lesson title generation rejects empty or malformed provider output", async () => {
  for (const outputParsed of [
    null,
    { title: "   " },
    { title: "Título", explanation: "Texto adicional" },
    { title: "a".repeat(161) },
  ]) {
    const generator = new OpenAIFreeLanguageLessonTitleGenerator(async () => ({
      status: "completed",
      output_parsed: outputParsed,
    }));

    await assert.rejects(
      () =>
        generator.generate({
          language: "Alemán",
          level: "A2",
          sourceContent: "Ich möchte ein Steak, bitte dünn geschnitten.",
        }),
      (error: unknown) =>
        error instanceof FreeLanguageLessonTitleGenerationError &&
        (error.code === "empty_response" || error.code === "invalid_response"),
    );
  }
});

test("free lesson title generation maps provider failures without exposing them", async () => {
  const generator = new OpenAIFreeLanguageLessonTitleGenerator(async () => {
    throw new Error("provider details");
  });

  await assert.rejects(
    () =>
      generator.generate({
        language: "Francés",
        level: "A1",
        sourceContent: "Je travaille dans une école et je me présente.",
      }),
    (error: unknown) =>
      error instanceof FreeLanguageLessonTitleGenerationError &&
      error.code === "provider_error",
  );
});
