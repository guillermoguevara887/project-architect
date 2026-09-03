import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import {
  ProductionLessonGenerationServiceError,
} from "../src/languages/generation/service.js";
import type { LessonGenerationWithOutput } from "../src/languages/generation/repository.js";
import {
  CurriculumOrchestrationService,
  CurriculumOrchestrationServiceError,
} from "../src/languages/orchestration/service.js";
import type {
  CurriculumOrchestrationRunRecord,
  CurriculumOrchestrationStore,
  PlanningBundleRecord,
  TrustedPlanningBundlePayload,
} from "../src/languages/orchestration/repository.js";
import { germanA1U01AdaptedUnitFixture } from "./fixtures/adapted-curriculum/german-a1-u01.js";
import {
  buildReadyGermanAdaptationPlanFixture,
  germanM5DecisionRegistryFixture,
} from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";
import { germanA1U01LessonRouteFixture } from "./fixtures/lesson-route/german-a1-u01.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UNIT_RECORD_ID = "22222222-2222-4222-8222-222222222222";

function uuid(counter: number) {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function readyBundle(): TrustedPlanningBundlePayload {
  const route = structuredClone(germanA1U01LessonRouteFixture);
  route.nodes.forEach((node) => {
    node.optional = node.nodeId !== "N05";
  });
  return {
    curriculum: structuredClone(a1U01CurriculumFixture),
    languageProfile: structuredClone(germanLanguageProfileFixture),
    registry: structuredClone(germanM5DecisionRegistryFixture),
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
    adaptedUnit: structuredClone(germanA1U01AdaptedUnitFixture),
    route,
    lessonSpecs: [structuredClone(germanA1U01L05LessonSpecFixture)],
  };
}

class InMemoryOrchestrationStore implements CurriculumOrchestrationStore {
  bundles: PlanningBundleRecord[] = [];
  runs: CurriculumOrchestrationRunRecord[] = [];
  ownedUnitIds = new Set([UNIT_RECORD_ID]);
  private counter = 1;

  async createPlanningBundle(input: {
    userId: string;
    curriculumUnitRecordId: string;
    payload: TrustedPlanningBundlePayload;
    contentSha256: string;
  }) {
    if (!this.ownedUnitIds.has(input.curriculumUnitRecordId)) return null;
    const existing = this.bundles.find(
      (bundle) =>
        bundle.userId === input.userId &&
        bundle.curriculumUnitRecordId === input.curriculumUnitRecordId &&
        bundle.contentSha256 === input.contentSha256,
    );
    if (existing) return existing;
    const record: PlanningBundleRecord = {
      id: uuid(this.counter++),
      userId: input.userId,
      curriculumUnitRecordId: input.curriculumUnitRecordId,
      languageId: input.payload.languageProfile.identity.languageId,
      varietyId: input.payload.languageProfile.identity.varietyId,
      levelId: input.payload.curriculum.identity.levelId,
      unitId: input.payload.curriculum.identity.unitId,
      payload: structuredClone(input.payload),
      contentSha256: input.contentSha256,
      createdAt: new Date(),
    };
    this.bundles.push(record);
    return record;
  }

  async findPlanningBundleForUser(userId: string, bundleId: string) {
    return (
      this.bundles.find(
        (bundle) => bundle.id === bundleId && bundle.userId === userId,
      ) ?? null
    );
  }

  async beginRun(input: {
    userId: string;
    planningBundleId: string;
    expectedLessonCount: number;
  }) {
    const bundle = await this.findPlanningBundleForUser(
      input.userId,
      input.planningBundleId,
    );
    if (!bundle) return null;
    const run: CurriculumOrchestrationRunRecord = {
      id: uuid(this.counter++),
      userId: input.userId,
      planningBundleId: input.planningBundleId,
      status: "running",
      expectedLessonCount: input.expectedLessonCount,
      generationRunIds: [],
      errorCode: null,
      startedAt: new Date(),
      completedAt: null,
    };
    this.runs.push(run);
    return structuredClone(run);
  }

  async appendGenerationRun(input: {
    userId: string;
    runId: string;
    generationRunId: string;
  }) {
    const run = this.runs.find(
      (candidate) =>
        candidate.id === input.runId &&
        candidate.userId === input.userId &&
        candidate.status === "running",
    );
    if (!run || run.generationRunIds.includes(input.generationRunId)) return null;
    run.generationRunIds.push(input.generationRunId);
    return structuredClone(run);
  }

  async completeRun(userId: string, runId: string) {
    const run = this.runs.find(
      (candidate) =>
        candidate.id === runId &&
        candidate.userId === userId &&
        candidate.status === "running",
    );
    if (!run || run.generationRunIds.length !== run.expectedLessonCount) return null;
    run.status = "ready";
    run.completedAt = new Date();
    return structuredClone(run);
  }

  async failRun(input: { userId: string; runId: string; errorCode: string }) {
    const run = this.runs.find(
      (candidate) =>
        candidate.id === input.runId &&
        candidate.userId === input.userId &&
        candidate.status === "running",
    );
    if (!run) return null;
    run.status = "failed";
    run.errorCode = input.errorCode;
    run.completedAt = new Date();
    return structuredClone(run);
  }

  async findRunForUser(userId: string, runId: string) {
    const run = this.runs.find(
      (candidate) => candidate.id === runId && candidate.userId === userId,
    );
    return run ? structuredClone(run) : null;
  }
}

class CapturingLessonGeneration {
  receivedLessonIds: string[] = [];
  fail = false;
  private counter = 100;

  async generate(userId: string, lessonSpec: typeof germanA1U01L05LessonSpecFixture): Promise<LessonGenerationWithOutput> {
    this.receivedLessonIds.push(lessonSpec.identity.lessonSpecId);
    if (this.fail) {
      throw new ProductionLessonGenerationServiceError(
        "generation_failed",
        "fixture_generation_failure",
      );
    }
    const now = new Date();
    const runId = uuid(this.counter++);
    return {
      run: {
        id: runId,
        userId,
        lessonSpecId: lessonSpec.identity.lessonSpecId,
        lessonSpecVersion: lessonSpec.version,
        languageId: lessonSpec.identity.languageId,
        varietyId: lessonSpec.identity.varietyId,
        levelId: lessonSpec.identity.levelId,
        unitId: lessonSpec.identity.unitId,
        routeNodeRef: lessonSpec.identity.routeNodeRef,
        generationIntent: lessonSpec.generationIntent,
        lessonSpec,
        generatorKey: "fixture",
        provider: "fixture",
        model: null,
        status: "ready",
        attempts: 1,
        validationHistory: [],
        errorCode: null,
        startedAt: now,
        completedAt: now,
      },
      lesson: null,
    };
  }
}

function makeService() {
  const store = new InMemoryOrchestrationStore();
  const generation = new CapturingLessonGeneration();
  const service = new CurriculumOrchestrationService(store, generation);
  return { store, generation, service };
}

test("M9 registers only a fully ready trusted planning bundle and deduplicates identical content", async () => {
  const { store, service } = makeService();
  const first = await service.registerTrustedPlanningBundle(
    USER_ID,
    UNIT_RECORD_ID,
    readyBundle(),
  );
  const second = await service.registerTrustedPlanningBundle(
    USER_ID,
    UNIT_RECORD_ID,
    readyBundle(),
  );
  assert.equal(first.id, second.id);
  assert.equal(first.contentSha256.length, 64);
  assert.equal(store.bundles.length, 1);
});

test("M9 refuses to register a bundle against a curriculum unit the user does not own", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.registerTrustedPlanningBundle(USER_ID, uuid(999), readyBundle()),
    (error: unknown) =>
      error instanceof CurriculumOrchestrationServiceError &&
      error.code === "source_unit_not_found",
  );
});

test("M9 launches M8 only from the trusted stored LessonSpec and records the generation run", async () => {
  const { store, generation, service } = makeService();
  const bundle = await service.registerTrustedPlanningBundle(
    USER_ID,
    UNIT_RECORD_ID,
    readyBundle(),
  );
  const run = await service.generatePlanningBundle(USER_ID, bundle.id);
  assert.equal(run.status, "ready");
  assert.equal(run.expectedLessonCount, 1);
  assert.equal(run.generationRunIds.length, 1);
  assert.deepEqual(generation.receivedLessonIds, [
    germanA1U01L05LessonSpecFixture.identity.lessonSpecId,
  ]);
  assert.equal(store.runs[0]?.status, "ready");
});

test("M9 preserves a failed orchestration run when downstream generation fails", async () => {
  const { store, generation, service } = makeService();
  const bundle = await service.registerTrustedPlanningBundle(
    USER_ID,
    UNIT_RECORD_ID,
    readyBundle(),
  );
  generation.fail = true;
  await assert.rejects(
    service.generatePlanningBundle(USER_ID, bundle.id),
    (error: unknown) =>
      error instanceof CurriculumOrchestrationServiceError &&
      error.code === "orchestration_failed" &&
      error.detail === "fixture_generation_failure",
  );
  assert.equal(store.runs[0]?.status, "failed");
  assert.equal(store.runs[0]?.errorCode, "fixture_generation_failure");
  assert.equal(store.runs[0]?.generationRunIds.length, 0);
});

test("M9 migration is additive and stores trusted bundles separately from generation runs", async () => {
  const migration = await readFile(
    new URL("../drizzle/0021_create_language_curriculum_orchestration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE language_curriculum_planning_bundles/u);
  assert.match(migration, /CREATE TABLE language_curriculum_orchestration_runs/u);
  assert.match(migration, /REFERENCES language_curriculum_units\(id\)/u);
  assert.match(migration, /generation_run_ids jsonb/u);
  assert.match(migration, /content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/iu);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/iu);
});

test("M9 public routes require auth and cannot replace the trusted LessonSpec through request body", async () => {
  const { generation, service } = makeService();
  const bundle = await service.registerTrustedPlanningBundle(
    USER_ID,
    UNIT_RECORD_ID,
    readyBundle(),
  );
  const user = {
    id: USER_ID,
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
    { authStore, curriculumOrchestrationService: service },
  );

  const unauthorized = await server.inject({
    method: "POST",
    url: `/languages/curriculum-planning-bundles/${bundle.id}/generate`,
  });
  assert.equal(unauthorized.statusCode, 401);

  const cookie = createSessionCookie(user.id).split(";", 1)[0] ?? "";
  const response = await server.inject({
    method: "POST",
    url: `/languages/curriculum-planning-bundles/${bundle.id}/generate`,
    headers: { cookie },
    payload: {
      lessonSpec: {
        identity: { lessonSpecId: "attacker.supplied.lesson" },
      },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(generation.receivedLessonIds, [
    germanA1U01L05LessonSpecFixture.identity.lessonSpecId,
  ]);
  assert.equal(response.json().run.expectedLessonCount, 1);

  const publicBundleCreation = await server.inject({
    method: "POST",
    url: "/languages/curriculum-planning-bundles",
    headers: { cookie },
    payload: readyBundle(),
  });
  assert.equal(publicBundleCreation.statusCode, 404);

  await server.close();
});
