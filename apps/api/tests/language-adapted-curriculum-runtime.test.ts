import assert from "node:assert/strict";
import test from "node:test";
import {
  compileInitialAdaptationPlan,
  validateAdaptationPlan,
} from "../src/languages/adaptation/adaptation-plan.js";
import {
  validateAdaptedCurriculumRuntime,
} from "../src/languages/adapted/adapted-curriculum-runtime.js";
import {
  validateAdaptedUnitSpec,
} from "../src/languages/adapted/adapted-unit-spec.js";
import {
  validateLanguageDecisionRegistry,
} from "../src/languages/decisions/language-decision-registry.js";
import {
  validateLessonSpec,
} from "../src/languages/lessons/lesson-spec.js";
import {
  validateLessonRoute,
} from "../src/languages/routing/lesson-route.js";
import { germanA1U01AdaptedUnitFixture } from "./fixtures/adapted-curriculum/german-a1-u01.js";
import {
  buildReadyGermanAdaptationPlanFixture,
  germanM5DecisionRegistryFixture,
} from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";
import { germanA1U01LessonRouteFixture } from "./fixtures/lesson-route/german-a1-u01.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

function codes(result: { issues: Array<{ code: string }> }) {
  return result.issues.map((issue) => issue.code);
}

test("M5 resolved German registry remains valid against LanguageProfile", () => {
  const result = validateLanguageDecisionRegistry(germanM5DecisionRegistryFixture, {
    languageProfile: germanLanguageProfileFixture,
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("M5 ready adaptation fixture satisfies AdaptationPlan semantics", () => {
  const plan = buildReadyGermanAdaptationPlanFixture();
  const result = validateAdaptationPlan(plan, {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.equal(plan.readiness.state, "ready");
  assert.equal(plan.gapAnalysis.length, 0);
});

test("German A1-U01 AdaptedUnitSpec passes structural, upstream and decision-trace validation", () => {
  const result = validateAdaptedUnitSpec(germanA1U01AdaptedUnitFixture, {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("German A1-U01 LessonRoute distributes only authorized capabilities and realizations", () => {
  const result = validateLessonRoute(germanA1U01LessonRouteFixture, {
    adaptedUnit: germanA1U01AdaptedUnitFixture,
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("German L05 LessonSpec is authorized by N05 and AdaptedUnitSpec", () => {
  const result = validateLessonSpec(germanA1U01L05LessonSpecFixture, {
    route: germanA1U01LessonRouteFixture,
    adaptedUnit: germanA1U01AdaptedUnitFixture,
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("M5 golden runtime validates end to end from adapted unit to a concrete LessonSpec", () => {
  const result = validateAdaptedCurriculumRuntime({
    adaptedUnit: germanA1U01AdaptedUnitFixture,
    route: germanA1U01LessonRouteFixture,
    lessonSpecs: [germanA1U01L05LessonSpecFixture],
    upstream: {
      curriculum: a1U01CurriculumFixture,
      languageProfile: germanLanguageProfileFixture,
      registry: germanM5DecisionRegistryFixture,
      adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
    },
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("AdaptedUnitSpec refuses an initial M4 plan that still has unresolved gaps", () => {
  const compilation = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
  assert.ok(compilation.plan);

  const result = validateAdaptedUnitSpec(germanA1U01AdaptedUnitFixture, {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    adaptationPlan: compilation.plan!,
  });
  assert.equal(codes(result).includes("UPSTREAM_ADAPTATION_NOT_READY"), true);
});

test("AdaptedUnitSpec rejects productive material outside recognition range", () => {
  const fixture = structuredClone(germanA1U01AdaptedUnitFixture);
  fixture.languageRealizations[0]!.productiveCore.push("de.unseen.productive_item");

  const result = validateAdaptedUnitSpec(fixture);
  assert.equal(codes(result).includes("PRODUCTIVE_CORE_EXCEEDS_RECOGNITION_RANGE"), true);
});

test("LessonRoute rejects downstream invention of a language realization", () => {
  const fixture = structuredClone(germanA1U01LessonRouteFixture);
  fixture.nodes[4]!.realizationRefs.push("R.invented.downstream");

  const result = validateLessonRoute(fixture, {
    adaptedUnit: germanA1U01AdaptedUnitFixture,
  });
  assert.equal(codes(result).includes("DOWNSTREAM_REALIZATION_INVENTION"), true);
});

test("LessonRoute rejects hard dependency cycles", () => {
  const fixture = structuredClone(germanA1U01LessonRouteFixture);
  fixture.edges.push({ fromNodeRef: "N04", toNodeRef: "N05", relation: "requires" });

  const result = validateLessonRoute(fixture, {
    adaptedUnit: germanA1U01AdaptedUnitFixture,
  });
  assert.equal(codes(result).includes("CYCLE_DETECTED"), true);
});

test("LessonSpec cannot promote an upstream recognition-only pattern to production", () => {
  const adapted = structuredClone(germanA1U01AdaptedUnitFixture);
  const agePattern = adapted.linguisticTargets.patterns.find(
    (pattern) => pattern.patternId === "P.age",
  )!;
  agePattern.productiveStatus = "recognition_only";

  const result = validateLessonSpec(germanA1U01L05LessonSpecFixture, {
    route: germanA1U01LessonRouteFixture,
    adaptedUnit: adapted,
  });
  assert.equal(
    codes(result).includes("RECOGNITION_ONLY_PATTERN_PROMOTED_PRODUCTIVELY") ||
      codes(result).includes("RECOGNITION_ONLY_PATTERN_ASSESSED_PRODUCTIVELY"),
    true,
  );
});

test("LessonSpec rejects an orphan route node", () => {
  const fixture = structuredClone(germanA1U01L05LessonSpecFixture);
  fixture.identity.routeNodeRef = "N99";

  const result = validateLessonSpec(fixture, {
    route: germanA1U01LessonRouteFixture,
    adaptedUnit: germanA1U01AdaptedUnitFixture,
  });
  assert.equal(codes(result).includes("ORPHAN_LESSON_SPEC"), true);
});

test("LessonSpec load policy must match concrete new lexical inventory", () => {
  const fixture = structuredClone(germanA1U01L05LessonSpecFixture);
  fixture.loadPolicy.newCoreLexicalCount = 9;

  const result = validateLessonSpec(fixture, {
    route: germanA1U01LessonRouteFixture,
    adaptedUnit: germanA1U01AdaptedUnitFixture,
  });
  assert.equal(codes(result).includes("CORE_LEXICAL_LOAD_MISMATCH"), true);
});

test("terminal-evidence LessonSpecs cannot introduce a new central structure", () => {
  const route = structuredClone(germanA1U01LessonRouteFixture);
  route.nodes[4]!.assessmentRole = "terminal_evidence";

  const result = validateLessonSpec(germanA1U01L05LessonSpecFixture, {
    route,
    adaptedUnit: germanA1U01AdaptedUnitFixture,
  });
  assert.equal(codes(result).includes("TERMINAL_LESSON_INTRODUCES_NEW_STRUCTURE"), true);
});

test("runtime can require one LessonSpec per non-optional route node when requested", () => {
  const result = validateAdaptedCurriculumRuntime({
    adaptedUnit: germanA1U01AdaptedUnitFixture,
    route: germanA1U01LessonRouteFixture,
    lessonSpecs: [germanA1U01L05LessonSpecFixture],
    requireCompleteLessonSet: true,
  });
  assert.equal(codes(result).includes("ROUTE_NODE_WITHOUT_LESSON_SPEC"), true);
});
