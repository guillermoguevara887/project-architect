import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { z } from "zod";
import {
  OpenAICurriculumDocumentExtractor,
  curriculumDocumentCandidateSchema,
  validateCurriculumDocumentCandidate,
  type CurriculumDocumentCandidate,
  type MasterDocumentCurriculumInput,
} from "../src/languages/ai/document-curriculum-extractor.js";
import {
  runStructuredCandidateBoundary,
  StructuredCandidateBoundaryError,
} from "../src/languages/ai/structured-candidate-boundary.js";
import { validationIssue, validationResult } from "../src/languages/curriculum/validation.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";

const ingestionInput: MasterDocumentCurriculumInput = {
  documentId: "DOC.A1.001",
  documentVersion: "1.0.0",
  sourceTitle: "Marco maestro A1 - parte inicial",
  sourceFormat: "pdf_extracted_text",
  sourceLanguageHint: "German",
  curriculumId: "memoos-core-language",
  levelId: "A1",
  sourceText:
    "Documento maestro de prueba con objetivos de primer contacto, identidad, numeración, referencia y reparación comunicativa.",
  unitCountHint: { min: 1, max: 2 },
};

function validDocumentCandidate(): CurriculumDocumentCandidate {
  const unit = structuredClone(a1U01CurriculumFixture);
  unit.status = "review";
  unit.provenance.sources.push({
    sourceId: ingestionInput.documentId,
    role: "primary",
    reference: `${ingestionInput.documentId}@${ingestionInput.documentVersion}`,
    title: ingestionInput.sourceTitle,
  });

  return {
    documentRef: {
      id: ingestionInput.documentId,
      version: ingestionInput.documentVersion,
    },
    curriculumId: ingestionInput.curriculumId,
    levelId: ingestionInput.levelId,
    units: [unit],
  };
}

test("M6 generic boundary accepts a structurally and semantically valid candidate", async () => {
  const result = await runStructuredCandidateBoundary({
    schema: z.object({ value: z.number().int().positive() }).strict(),
    generate: async () => ({ value: 7 }),
    semanticValidator: (candidate) =>
      candidate.value === 7
        ? validationResult([])
        : validationResult([
            validationIssue("WRONG_VALUE", "value", "Expected the golden value."),
          ]),
  });

  assert.equal(result.attempts, 1);
  assert.deepEqual(result.value, { value: 7 });
  assert.deepEqual(result.validationHistory, [
    { attempt: 1, outcome: "accepted", issues: [] },
  ]);
});

test("M6 generic boundary retries invalid candidates with structured validation feedback", async () => {
  const seenFeedback: string[][] = [];
  const result = await runStructuredCandidateBoundary({
    schema: z.object({ value: z.number().int() }).strict(),
    maxAttempts: 2,
    generate: async ({ attempt, previousIssues }) => {
      seenFeedback.push(previousIssues.map((issue) => issue.code));
      return { value: attempt === 1 ? 1 : 2 };
    },
    semanticValidator: (candidate) =>
      candidate.value === 2
        ? validationResult([])
        : validationResult([
            validationIssue(
              "VALUE_NOT_READY",
              "value",
              "Value must be resolved before acceptance.",
            ),
          ]),
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(seenFeedback, [[], ["VALUE_NOT_READY"]]);
  assert.equal(result.validationHistory[0]?.outcome, "invalid_candidate");
  assert.equal(result.validationHistory[1]?.outcome, "accepted");
});

test("M6 generic boundary rejects after bounded retries instead of accepting an invalid candidate", async () => {
  await assert.rejects(
    () =>
      runStructuredCandidateBoundary({
        schema: z.object({ value: z.number().int() }).strict(),
        maxAttempts: 2,
        generate: async () => ({ value: 1 }),
        semanticValidator: () =>
          validationResult([
            validationIssue("NEVER_VALID", "value", "Candidate remains invalid."),
          ]),
      }),
    (error: unknown) => {
      assert.ok(error instanceof StructuredCandidateBoundaryError);
      assert.equal(error.code, "retry_exhausted");
      assert.equal(error.validationHistory.length, 2);
      return true;
    },
  );
});

test("M6 document candidate validates a real CurriculumUnitSpec through the M1 semantic validator", () => {
  const candidate = validDocumentCandidate();
  const structural = curriculumDocumentCandidateSchema.safeParse(candidate);
  assert.equal(structural.success, true);

  const result = validateCurriculumDocumentCandidate(candidate, ingestionInput);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("M6 document candidate cannot let AI canonize curriculum output", () => {
  const candidate = validDocumentCandidate();
  candidate.units[0]!.status = "canonical";

  const result = validateCurriculumDocumentCandidate(candidate, ingestionInput);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.code === "AI_CANDIDATE_STATUS_NOT_REVIEW"),
  );
});

test("M6 document candidate must preserve exact document provenance", () => {
  const candidate = validDocumentCandidate();
  candidate.units[0]!.provenance.sources = candidate.units[0]!.provenance.sources.filter(
    (source) => source.sourceId !== ingestionInput.documentId,
  );

  const result = validateCurriculumDocumentCandidate(candidate, ingestionInput);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "DOCUMENT_PROVENANCE_MISSING"));
});

test("OpenAI curriculum boundary sends private structured requests and repairs semantic failures", async () => {
  const requests: Array<{
    model: string;
    input: string;
    store: false;
  }> = [];
  let attempt = 0;

  const extractor = new OpenAICurriculumDocumentExtractor(
    async (request) => {
      requests.push({ model: request.model, input: request.input, store: request.store });
      attempt += 1;
      const candidate = validDocumentCandidate();
      if (attempt === 1) candidate.units[0]!.status = "canonical";
      return {
        status: "completed",
        output_parsed: candidate,
      };
    },
    "curriculum-test-model",
    2,
  );

  const result = await extractor.extract(ingestionInput);
  assert.equal(result.attempts, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.model, "curriculum-test-model");
  assert.equal(requests[0]?.store, false);
  assert.match(requests[0]?.input ?? "", /datos no confiables/i);
  assert.match(requests[1]?.input ?? "", /AI_CANDIDATE_STATUS_NOT_REVIEW/);
  assert.equal(result.value.units[0]?.status, "review");
});

test("OpenAI curriculum boundary treats refusal as a terminal provider outcome", async () => {
  let requestCount = 0;
  const extractor = new OpenAICurriculumDocumentExtractor(
    async () => {
      requestCount += 1;
      return {
        status: "completed",
        output: [
          {
            content: [{ type: "refusal" }],
          },
        ],
      };
    },
    "curriculum-test-model",
    2,
  );

  await assert.rejects(
    () => extractor.extract(ingestionInput),
    (error: unknown) => {
      assert.ok(error instanceof StructuredCandidateBoundaryError);
      assert.equal(error.code, "refusal");
      return true;
    },
  );
  assert.equal(requestCount, 1);
});

test("OpenAI curriculum boundary preserves only safe API error metadata", async () => {
  const providerError = new OpenAI.APIError(
    429,
    {
      message: "provider detail that must not be propagated",
      code: "rate_limit_exceeded",
      type: "requests",
      param: "model",
      apiKey: "sk-test-secret",
      prompt: "private document source",
      arbitrary: "private arbitrary field",
    },
    "fallback provider detail",
    new Headers({
      authorization: "Bearer sk-test-secret",
      "x-request-id": "req_safe_test_123",
      "x-private-header": "private header value",
    }),
  );
  const extractor = new OpenAICurriculumDocumentExtractor(
    async () => {
      throw providerError;
    },
    "curriculum-test-model",
  );

  await assert.rejects(
    () => extractor.extract(ingestionInput),
    (error: unknown) => {
      assert.ok(error instanceof StructuredCandidateBoundaryError);
      assert.equal(error.code, "provider_error");
      assert.deepEqual(error.providerMetadata, {
        name: "APIError",
        status: 429,
        code: "rate_limit_exceeded",
        type: "requests",
        param: "model",
        requestId: "req_safe_test_123",
      });

      const serialized = JSON.stringify(error.providerMetadata);
      assert.equal(serialized.includes("sk-test-secret"), false);
      assert.equal(serialized.includes("private document source"), false);
      assert.equal(serialized.includes("private arbitrary field"), false);
      assert.equal(serialized.includes("private header value"), false);
      return true;
    },
  );
});

test("OpenAI curriculum boundary sanitizes unknown provider failures", async () => {
  const unknownError = Object.assign(
    new Error("unexpected failure containing sk-test-secret"),
    {
      code: "arbitrary_code",
      param: "private_prompt",
      requestID: "arbitrary_request_id",
      headers: { authorization: "Bearer sk-test-secret" },
    },
  );
  const extractor = new OpenAICurriculumDocumentExtractor(
    async () => {
      throw unknownError;
    },
    "curriculum-test-model",
  );

  await assert.rejects(
    () => extractor.extract(ingestionInput),
    (error: unknown) => {
      assert.ok(error instanceof StructuredCandidateBoundaryError);
      assert.equal(error.code, "provider_error");
      assert.deepEqual(error.providerMetadata, { name: "Error" });
      return true;
    },
  );
});
