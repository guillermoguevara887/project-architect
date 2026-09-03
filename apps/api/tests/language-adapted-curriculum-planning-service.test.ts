import assert from "node:assert/strict";
import test from "node:test";
import type { AdaptedCurriculumPlanner } from "../src/languages/planning/adapted-curriculum-planner.js";
import { AdaptedCurriculumPlanningService } from "../src/languages/planning/service.js";
import type { PlanningBundleRecord } from "../src/languages/orchestration/repository.js";
import { germanA1U01AdaptedUnitFixture } from "./fixtures/adapted-curriculum/german-a1-u01.js";
import {
  buildReadyGermanAdaptationPlanFixture,
  germanM5DecisionRegistryFixture,
} from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";
import { germanA1U01LessonRouteFixture } from "./fixtures/lesson-route/german-a1-u01.js";

function fixtureBundle() {
  return {
    curriculum: structuredClone(a1U01CurriculumFixture),
    languageProfile: structuredClone(germanLanguageProfileFixture),
    registry: structuredClone(germanM5DecisionRegistryFixture),
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
    adaptedUnit: structuredClone(germanA1U01AdaptedUnitFixture),
    route: structuredClone(germanA1U01LessonRouteFixture),
    lessonSpecs: [structuredClone(germanA1U01L05LessonSpecFixture)],
  };
}

test("M10 planning service registers exactly the planner-produced bundle through M9", async () => {
  const bundle = fixtureBundle();
  const planning = {
    bundle,
    stageHistory: [
      {
        stage: "adapted_unit" as const,
        artifactRef: bundle.adaptedUnit.identity.adaptedUnitId,
        attempts: 1,
        validationHistory: [
          { attempt: 1, outcome: "accepted" as const, issues: [] },
        ],
      },
    ],
  };
  const planner: AdaptedCurriculumPlanner = {
    async plan() {
      return planning;
    },
  };

  const captured: Array<{
    userId: string;
    curriculumUnitRecordId: string;
    payload: typeof bundle;
  }> = [];
  const record: PlanningBundleRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    curriculumUnitRecordId: "unit-record-1",
    languageId: "de",
    varietyId: "de.standard",
    levelId: "A1",
    unitId: "A1-U01",
    payload: bundle,
    contentSha256: "a".repeat(64),
    createdAt: new Date("2026-09-03T00:00:00Z"),
  };
  const orchestration = {
    async registerTrustedPlanningBundle(
      userId: string,
      curriculumUnitRecordId: string,
      payload: typeof bundle,
    ) {
      captured.push({ userId, curriculumUnitRecordId, payload });
      return record;
    },
  };

  const service = new AdaptedCurriculumPlanningService(planner, orchestration);
  const input = {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
    explanationLanguage: "Spanish",
  };
  const result = await service.planAndRegister(
    "user-1",
    "unit-record-1",
    input,
  );

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.userId, "user-1");
  assert.equal(captured[0]?.curriculumUnitRecordId, "unit-record-1");
  assert.equal(captured[0]?.payload, planning.bundle);
  assert.equal(result.planning, planning);
  assert.equal(result.planningBundle, record);
});
