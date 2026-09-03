import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import { StructuredCandidateBoundaryError } from "../src/languages/ai/structured-candidate-boundary.js";
import type { ProductionLessonGenerator } from "../src/languages/generation/lesson-generator.js";
import {
  ProductionLessonGenerationService,
  ProductionLessonGenerationServiceError,
} from "../src/languages/generation/service.js";
import { germanA1U01L05GeneratedCandidateFixture } from "./fixtures/generated-lesson/german-a1-u01-l05.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";
import { InMemoryProductionLessonGenerationStore } from "./fixtures/production-lesson-generation-store.js";

function acceptedCandidate() {
  return {
    value: structuredClone(germanA1U01L05GeneratedCandidateFixture),
    attempts: 1,
    validationHistory: [
      { attempt: 1, outcome: "accepted" as const, issues: [] },
    ],
  };
}

function makeService(generator?: ProductionLessonGenerator) {
  const store = new InMemoryProductionLessonGenerationStore();
  const resolvedGenerator: ProductionLessonGenerator =
    generator ?? {
      async generate() {
        return acceptedCandidate();
      },
    };
  const service = new ProductionLessonGenerationService(store, resolvedGenerator, {
    provider: "test-provider",
    model: "test-model",
  });
  return { store, service };
}

test("M8 seals validated candidates as accepted generated lessons", async () => {
  const { store, service } = makeService();
  const result = await service.generate(
    "user-1",
    germanA1U01L05LessonSpecFixture,
  );

  assert.equal(result.run.status, "ready");
  assert.equal(result.run.lessonSpecId, "lesson.A1-U01.de.standard.L05");
  assert.equal(result.run.provider, "test-provider");
  assert.equal(result.run.model, "test-model");
  assert.equal(result.run.attempts, 1);
  assert.ok(result.lesson);
  assert.equal(result.lesson?.generatedLesson.status, "accepted");
  assert.deepEqual(result.lesson?.generatedLesson.identity.lessonSpecRef, {
    id: germanA1U01L05LessonSpecFixture.identity.lessonSpecId,
    version: germanA1U01L05LessonSpecFixture.version,
  });
  assert.equal(result.lesson?.generatedLesson.identity.generationRunId, result.run.id);
  assert.equal(result.lesson?.contentSha256.length, 64);
  assert.equal(store.runs.length, 1);
  assert.equal(store.lessons.length, 1);
});

test("M8 regeneration is append-only and does not overwrite prior accepted output", async () => {
  const { store, service } = makeService();
  const first = await service.generate(
    "user-1",
    germanA1U01L05LessonSpecFixture,
  );
  const second = await service.generate(
    "user-1",
    germanA1U01L05LessonSpecFixture,
  );

  assert.notEqual(first.run.id, second.run.id);
  assert.notEqual(first.lesson?.id, second.lesson?.id);
  assert.equal(store.runs.length, 2);
  assert.equal(store.lessons.length, 2);
  assert.equal(store.runs.every((run) => run.status === "ready"), true);
});

test("M8 refuses invalid LessonSpec without creating a generation run", async () => {
  const { store, service } = makeService();
  const lesson = structuredClone(germanA1U01L05LessonSpecFixture);
  lesson.status = "review";

  await assert.rejects(
    service.generate("user-1", lesson),
    (error: unknown) =>
      error instanceof ProductionLessonGenerationServiceError &&
      error.code === "invalid_lesson_spec",
  );
  assert.equal(store.runs.length, 0);
  assert.equal(store.lessons.length, 0);
});

test("M8 records provider/boundary failures after a run starts", async () => {
  const history = [
    {
      attempt: 1,
      outcome: "invalid_candidate" as const,
      issues: [],
    },
  ];
  const generator: ProductionLessonGenerator = {
    async generate() {
      throw new StructuredCandidateBoundaryError("retry_exhausted", history);
    },
  };
  const { store, service } = makeService(generator);

  await assert.rejects(
    service.generate("user-1", germanA1U01L05LessonSpecFixture),
    (error: unknown) =>
      error instanceof ProductionLessonGenerationServiceError &&
      error.code === "generation_failed" &&
      error.detail === "retry_exhausted",
  );

  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0]?.status, "failed");
  assert.equal(store.runs[0]?.errorCode, "retry_exhausted");
  assert.deepEqual(store.runs[0]?.validationHistory, history);
  assert.equal(store.lessons.length, 0);
});

test("M8 generation lookup is ownership-aware", async () => {
  const { service } = makeService();
  const generated = await service.generate(
    "user-1",
    germanA1U01L05LessonSpecFixture,
  );

  const owned = await service.get("user-1", generated.run.id);
  assert.equal(owned.run.id, generated.run.id);

  await assert.rejects(
    service.get("user-2", generated.run.id),
    (error: unknown) =>
      error instanceof ProductionLessonGenerationServiceError &&
      error.code === "not_found",
  );
});

test("M8 migration is additive and stores immutable run snapshots and accepted output", async () => {
  const migration = await readFile(
    new URL("../drizzle/0020_create_language_generated_lessons.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE language_lesson_generation_runs/u);
  assert.match(migration, /CREATE TABLE language_generated_lessons/u);
  assert.match(migration, /lesson_spec jsonb NOT NULL/u);
  assert.match(migration, /generation_run_id uuid NOT NULL UNIQUE/u);
  assert.match(migration, /status IN \('running', 'ready', 'failed'\)/u);
  assert.match(migration, /content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/iu);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/iu);
});

test("M8 routes require auth and return accepted output without exposing LessonSpec snapshot", async () => {
  const { service } = makeService();
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "memo",
    passwordHash: "hash",
    createdAt: new Date(),
  };
  const authStore: AuthStore = {
    async findById(userId) {
      return userId === user.id ? user : null;
    },
    async findByUsername(username) {
      return username === user.username ? user : null;
    },
  };
  const server = createServer(
    { logger: false },
    { authStore, productionLessonGenerationService: service },
  );

  const unauthorized = await server.inject({
    method: "POST",
    url: "/languages/lesson-generations",
    payload: { lessonSpec: germanA1U01L05LessonSpecFixture },
  });
  assert.equal(unauthorized.statusCode, 401);

  const cookie = createSessionCookie(user.id).split(";", 1)[0] ?? "";
  const generated = await server.inject({
    method: "POST",
    url: "/languages/lesson-generations",
    headers: { cookie },
    payload: { lessonSpec: germanA1U01L05LessonSpecFixture },
  });
  assert.equal(generated.statusCode, 201, generated.body);
  const body = generated.json();
  assert.equal(body.run.status, "ready");
  assert.equal("lessonSpec" in body.run, false);
  assert.equal(body.lesson.generatedLesson.status, "accepted");

  const fetched = await server.inject({
    method: "GET",
    url: `/languages/lesson-generations/${body.run.id}`,
    headers: { cookie },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().lesson.id, body.lesson.id);

  await server.close();
});
