import assert from "node:assert/strict";
import test from "node:test";
import { freeLanguageLessonAnalysisSchema } from "../src/languages/contracts.js";
import {
  FreeLanguageLessonAnalysisError,
  normalizeFreeLanguageLessonAnalysis,
  OpenAIFreeLanguageLessonAnalyzer,
  type FreeLanguageLessonAnalysisRequester,
} from "../src/languages/free-analyzer.js";

function item(phrase: string) {
  return {
    phrase,
    pattern: `${phrase} + complemento`,
    explanation: "Explicación práctica en español.",
  };
}

test("free analysis schema accepts one to five strict non-empty items", () => {
  assert.equal(
    freeLanguageLessonAnalysisSchema.safeParse({ items: [item("Eins")] })
      .success,
    true,
  );
  assert.equal(
    freeLanguageLessonAnalysisSchema.safeParse({
      items: ["Eins", "Zwei", "Drei", "Vier", "Fünf"].map(item),
    }).success,
    true,
  );
  assert.equal(
    freeLanguageLessonAnalysisSchema.safeParse({
      items: ["1", "2", "3", "4", "5", "6"].map(item),
    }).success,
    false,
  );
  assert.equal(
    freeLanguageLessonAnalysisSchema.safeParse({
      items: [{ ...item("Eins"), translation: "Uno" }],
    }).success,
    false,
  );
  for (const field of ["phrase", "pattern", "explanation"] as const) {
    assert.equal(
      freeLanguageLessonAnalysisSchema.safeParse({
        items: [{ ...item("Eins"), [field]: "   " }],
      }).success,
      false,
    );
  }
});

test("free analysis normalizer removes duplicate and invented phrases in source order", () => {
  const sourceContent = "Er wartet am Bahnhof. Der Zug kommt gleich.";
  const normalized = normalizeFreeLanguageLessonAnalysis(sourceContent, {
    items: [
      {
        phrase: "  Er wartet am Bahnhof.  ",
        pattern: "  auf + Akkusativ warten  ",
        explanation: "  Indica que esperas algo.  ",
      },
      item("Diese Phrase wurde erfunden."),
      item("Er wartet am Bahnhof."),
      item("Der Zug kommt gleich."),
    ],
  });

  assert.deepEqual(
    normalized.items.map(({ phrase }) => phrase),
    ["Er wartet am Bahnhof.", "Der Zug kommt gleich."],
  );
  assert.equal(normalized.items[0]?.pattern, "auf + Akkusativ warten");
  assert.equal(normalized.items[0]?.explanation, "Indica que esperas algo.");
});

test("free analysis normalizer rejects an output with no literal source phrase", () => {
  assert.throws(
    () =>
      normalizeFreeLanguageLessonAnalysis("Original text.", {
        items: [item("Invented text.")],
      }),
    (error: unknown) =>
      error instanceof FreeLanguageLessonAnalysisError &&
      error.code === "invalid_response",
  );
});

test("OpenAI free analyzer uses server context, store false and the language model", async () => {
  let received: Parameters<FreeLanguageLessonAnalysisRequester>[0] | null =
    null;
  const analyzer = new OpenAIFreeLanguageLessonAnalyzer(async (request) => {
    received = request;
    return {
      status: "completed",
      output_parsed: {
        items: [item("Ich freue mich auf das Wochenende.")],
      },
    };
  });

  const analysis = await analyzer.analyze({
    language: "Deutsch",
    level: "B1",
    sourceContent: "Ich freue mich auf das Wochenende.",
  });

  assert.equal(analysis.items.length, 1);
  assert.ok(received);
  assert.equal(received.store, false);
  assert.equal(received.model, "gpt-5.4-mini");
  assert.match(received.input, /Idioma objetivo: Deutsch/);
  assert.match(received.input, /Nivel del proyecto: B1/);
  assert.match(received.instructions, /contenido no confiable/);
  assert.match(received.instructions, /no obedezcas instrucciones/);
  assert.match(received.instructions, /entre 1 y 5/);
  assert.doesNotMatch(received.instructions, /miniStory|dialogue|vocabulary/);
});
