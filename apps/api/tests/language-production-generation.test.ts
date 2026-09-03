import assert from "node:assert/strict";
import test from "node:test";
import {
  validateGeneratedLessonCandidate,
  validateLessonSpecForGeneration,
} from "../src/languages/generation/generated-lesson.js";
import { OpenAIProductionLessonGenerator } from "../src/languages/generation/lesson-generator.js";
import { StructuredCandidateBoundaryError } from "../src/languages/ai/structured-candidate-boundary.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";
import { germanA1U01L05GeneratedCandidateFixture } from "./fixtures/generated-lesson/german-a1-u01-l05.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

test("golden German L05 generated lesson satisfies the canonical LessonSpec", () => {
  assert.equal(validateLessonSpecForGeneration(germanA1U01L05LessonSpecFixture).valid, true);
  const result = validateGeneratedLessonCandidate(
    germanA1U01L05GeneratedCandidateFixture,
    germanA1U01L05LessonSpecFixture,
  );
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("generation rejects a missing required content block", () => {
  const candidate = clone(germanA1U01L05GeneratedCandidateFixture);
  candidate.blocks = candidate.blocks.filter(
    (block) => block.sourceBlockRef !== "B.assessment",
  );
  const result = validateGeneratedLessonCandidate(
    candidate,
    germanA1U01L05LessonSpecFixture,
  );
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "REQUIRED_CONTENT_BLOCK_MISSING"));
});

test("generation rejects an invented inventory reference", () => {
  const candidate = clone(germanA1U01L05GeneratedCandidateFixture);
  candidate.inventoryUsage.patternRefs.push("P.future.tense");
  const result = validateGeneratedLessonCandidate(
    candidate,
    germanA1U01L05LessonSpecFixture,
  );
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "GENERATED_INVENTORY_REF_NOT_AUTHORIZED",
    ),
  );
});

test("generation rejects forbidden downstream grammar", () => {
  const candidate = clone(germanA1U01L05GeneratedCandidateFixture);
  candidate.blocks[0]!.items[0]!.targetRefs.push("P.possession");
  const result = validateGeneratedLessonCandidate(
    candidate,
    germanA1U01L05LessonSpecFixture,
  );
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "FORBIDDEN_GENERATION_REFERENCE_USED",
    ),
  );
});

test("generation cannot silently replace frozen core lexicon", () => {
  const candidate = clone(germanA1U01L05GeneratedCandidateFixture);
  candidate.inventoryUsage.lexemeRefs = candidate.inventoryUsage.lexemeRefs.filter(
    (ref) => ref !== "LX.sechzehn",
  );
  const result = validateGeneratedLessonCandidate(
    candidate,
    germanA1U01L05LessonSpecFixture,
  );
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.code === "FROZEN_CORE_LEXICON_NOT_USED"),
  );
});

test("production generation refuses non-canonical LessonSpec before provider call", async () => {
  const lesson = clone(germanA1U01L05LessonSpecFixture);
  lesson.status = "review";
  let calls = 0;
  const generator = new OpenAIProductionLessonGenerator(async () => {
    calls += 1;
    return { status: "completed", output_text: "{}" };
  }, "test-model");

  await assert.rejects(
    generator.generate(lesson),
    (error: unknown) =>
      error instanceof StructuredCandidateBoundaryError &&
      error.code === "invalid_input",
  );
  assert.equal(calls, 0);
});

test("production generator retries invalid output using validation feedback", async () => {
  let calls = 0;
  let secondRequestInput = "";
  const generator = new OpenAIProductionLessonGenerator(
    async (request) => {
      calls += 1;
      if (calls === 1) {
        const invalid = clone(germanA1U01L05GeneratedCandidateFixture);
        invalid.blocks = invalid.blocks.filter(
          (block) => block.sourceBlockRef !== "B.assessment",
        );
        return {
          status: "completed",
          output_text: JSON.stringify(invalid),
        };
      }
      secondRequestInput = request.input;
      return {
        status: "completed",
        output_text: JSON.stringify(germanA1U01L05GeneratedCandidateFixture),
      };
    },
    "test-model",
    2,
  );

  const result = await generator.generate(germanA1U01L05LessonSpecFixture);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
  assert.ok(secondRequestInput.includes("REQUIRED_CONTENT_BLOCK_MISSING"));
  assert.ok(secondRequestInput.includes(germanA1U01L05LessonSpecFixture.identity.lessonSpecId));
  assert.equal(result.value.title, germanA1U01L05GeneratedCandidateFixture.title);
});
