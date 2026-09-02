import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAIProjectTextImprover,
  PROJECT_TEXT_IMPROVEMENT_INSTRUCTIONS,
  ProjectTextImproverError,
} from "../src/architect-projects/text-improver.js";

test("the OpenAI adapter improves only the supplied text with private structured output", async () => {
  const previousModel = process.env.OPENAI_PROJECT_TEXT_MODEL;
  process.env.OPENAI_PROJECT_TEXT_MODEL = "test-project-model";
  const requests: unknown[] = [];
  const improver = new OpenAIProjectTextImprover(async (request) => {
    requests.push(request);
    return {
      status: "completed",
      output_parsed: { improvedText: "Texto claro y profesional." },
    };
  });

  try {
    assert.equal(
      await improver.improve("texto de voz con con repeticiones"),
      "Texto claro y profesional.",
    );
    assert.equal(requests.length, 1);
    const request = requests[0] as {
      model: string;
      instructions: string;
      input: string;
      store: boolean;
      text: unknown;
    };
    assert.equal(request.model, "test-project-model");
    assert.equal(request.instructions, PROJECT_TEXT_IMPROVEMENT_INSTRUCTIONS);
    assert.equal(request.input, "texto de voz con con repeticiones");
    assert.equal(request.store, false);
    assert.ok(request.text);
  } finally {
    if (previousModel === undefined) delete process.env.OPENAI_PROJECT_TEXT_MODEL;
    else process.env.OPENAI_PROJECT_TEXT_MODEL = previousModel;
  }
});

test("the OpenAI adapter maps provider, refusal, empty and invalid responses", async () => {
  const cases: Array<{
    expected: string;
    improver: OpenAIProjectTextImprover;
  }> = [
    {
      expected: "provider_error",
      improver: new OpenAIProjectTextImprover(async () => {
        throw new Error("network");
      }),
    },
    {
      expected: "refusal",
      improver: new OpenAIProjectTextImprover(async () => ({
        status: "completed",
        output: [{ content: [{ type: "refusal" }] }],
      })),
    },
    {
      expected: "empty_response",
      improver: new OpenAIProjectTextImprover(async () => ({
        status: "completed",
      })),
    },
    {
      expected: "invalid_response",
      improver: new OpenAIProjectTextImprover(async () => ({
        status: "completed",
        output_parsed: { improvedText: "" },
      })),
    },
  ];

  for (const { expected, improver } of cases) {
    await assert.rejects(
      () => improver.improve("Texto"),
      (error: unknown) =>
        error instanceof ProjectTextImproverError && error.code === expected,
    );
  }
});
