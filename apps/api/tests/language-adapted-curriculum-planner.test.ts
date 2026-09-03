import assert from "node:assert/strict";
import test from "node:test";
import { compileInitialAdaptationPlan } from "../src/languages/adaptation/adaptation-plan.js";
import { StructuredCandidateBoundaryError } from "../src/languages/ai/structured-candidate-boundary.js";
import type { LessonSpec } from "../src/languages/lessons/lesson-spec.js";
import {
  OpenAIAdaptedCurriculumPlanner,
} from "../src/languages/planning/adapted-curriculum-planner.js";
import { evaluateLanguageOrchestration } from "../src/languages/orchestration/orchestration-runtime.js";
import type { LessonRoute } from "../src/languages/routing/lesson-route.js";
import { germanA1U01AdaptedUnitFixture } from "./fixtures/adapted-curriculum/german-a1-u01.js";
import {
  buildReadyGermanAdaptationPlanFixture,
  germanM5DecisionRegistryFixture,
} from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";
import { germanA1U01LessonRouteFixture } from "./fixtures/lesson-route/german-a1-u01.js";

const notRun = () => ({ status: "not_run" as const, findings: [] as string[] });

function reviewAdaptedUnit() {
  const value = structuredClone(germanA1U01AdaptedUnitFixture);
  value.status = "review";
  value.validation = Object.fromEntries(
    Object.keys(value.validation).map((key) => [key, notRun()]),
  ) as typeof value.validation;
  return value;
}

function reviewRoute() {
  const value = structuredClone(germanA1U01LessonRouteFixture);
  value.status = "review";
  value.validation = Object.fromEntries(
    Object.keys(value.validation).map((key) => [key, notRun()]),
  ) as typeof value.validation;
  return value;
}

function loadValue(value: "none" | "light" | "moderate" | "heavy") {
  return value;
}

function makeGenericLesson(node: LessonRoute["nodes"][number], route: LessonRoute): LessonSpec {
  const order = String(node.orderHint).padStart(2, "0");
  const assessmentCriterionRefs = route.assessmentDistribution
    .filter((entry) => entry.nodeRefs.includes(node.nodeId))
    .map((entry) => entry.criterionRef);
  const primaryTarget = node.capabilityRefs[0]!;
  const finalBlockType =
    node.primaryRole === "assessment"
      ? "assessment"
      : node.primaryRole === "literacy"
        ? "literacy"
        : node.primaryRole === "integration"
          ? "integration"
          : "communicative_practice";
  const evidenceItems =
    node.assessmentRole === "none"
      ? []
      : [
          {
            evidenceItemId: `EV.${node.nodeId}.checkpoint`,
            evidenceType: "selection" as const,
            capabilityRefs: [primaryTarget],
            realizationRefs: [],
            observableRequirements: ["Demonstrate the node mission under the authorized support ceiling."],
            performanceConditions: {
              supportCeiling: node.supportLevel,
              contextFamiliarity: "rehearsed" as const,
              resourcePolicy: "Only bounded support authorized by the route node may be visible.",
            },
            required: true,
          },
        ];

  return {
    identity: {
      lessonSpecId: `lesson.A1-U01.de.standard.L${order}`,
      routeNodeRef: node.nodeId,
      adaptedUnitRef: { id: "adapted.A1-U01.de.standard", version: "1.0.0" },
      languageId: "de",
      varietyId: "de.standard",
      levelId: "A1",
      unitId: "A1-U01",
      lessonOrderHint: node.orderHint,
    },
    sourceBinding: {
      lessonRouteRef: { id: route.identity.routeId, version: route.version },
      adaptedUnitSpecRef: { id: "adapted.A1-U01.de.standard", version: "1.0.0" },
    },
    generationIntent: "canonical",
    mission: {
      functionalGoal: node.mission,
      observableOutcome: `Complete ${node.nodeId} with the capabilities and production targets authorized by the route.`,
      successContext: "A bounded German A1 context using the route-defined support level.",
    },
    curriculumBinding: {
      capabilityRefs: [...node.capabilityRefs],
      realizationRefs: [...node.realizationRefs],
      sourceAdaptedStepRefs: [...node.sourceAdaptedStepRefs],
      assessmentCriterionRefs,
    },
    inputTargets: {
      mustRecognize: [...node.realizationRefs],
      mayEncounter: [],
      comprehensionFunctions: [],
      supportAllowed: node.supportLevel !== "independent",
    },
    productiveTargets: {
      requiredFunctions: [],
      requiredPatternRefs: [],
      productionTargetRefs: node.productionTargets.map((target) => target.productionTargetId),
      acceptableVariation: ["Natural variation is accepted when it preserves the node mission."],
      deferredAlternatives: [],
      supportCeiling: node.supportLevel,
    },
    languageInventory: {
      patterns: [],
      coreLexicon: [],
      supportingLexicon: [],
      recycledLexicon: [],
      functionItems: [],
      pronunciationItems: [],
      literacyItems: [],
    },
    loadPolicy: {
      newStructuralLoad: 0,
      newCoreLexicalCount: 0,
      newSupportingLexicalCount: 0,
      newPhonologicalLoad: loadValue(node.newLoad.phonological),
      newLiteracyLoad: loadValue(node.newLoad.literacy),
      newDiscourseLoad: loadValue(node.newLoad.discourse),
      knownContentTargetRatio: node.orderHint === 13 ? 0.9 : 0.8,
      coreLexicalHardMax: 12,
    },
    contentArchitecture: {
      blocks: [
        {
          blockId: `B.${node.nodeId}.context`,
          blockType: "context",
          purpose: "Establish the bounded communicative context for this route node.",
          targetRefs: [primaryTarget],
        },
        {
          blockId: `B.${node.nodeId}.input`,
          blockType: "input",
          purpose: "Provide authorized input for the node mission without adding downstream structure.",
          targetRefs: [...node.realizationRefs],
          inputSpec: {
            inputType: "short_dialogue",
            noveltyCeiling: "low",
            supportMode: node.supportLevel,
          },
        },
        {
          blockId: `B.${node.nodeId}.work`,
          blockType: finalBlockType,
          purpose: "Practice or collect evidence for the route-node mission.",
          targetRefs: node.productionTargets.map((target) => target.productionTargetId),
        },
      ],
    },
    practicePlan:
      node.productionTargets.length === 0
        ? []
        : [
            {
              practiceId: `PRAC.${node.nodeId}.required`,
              practiceType: node.primaryRole === "assessment" ? "interaction" : "guided_production",
              targetRefs: [primaryTarget],
              supportLevel: node.supportLevel,
              required: true,
            },
          ],
    pronunciationPlan: {
      targetRefs: [],
      perceptionGoal: "",
      productionGoal: "",
      practiceTypes: [],
      audioRequired: false,
      tolerance: "",
    },
    literacyPlan: {
      scriptRefs: [],
      recognitionItems: [],
      productionItems: [],
      displayPolicy: node.primaryRole === "literacy" ? "Use the authorized standard orthography." : "",
      transliterationPolicy: "",
      supportLevel: node.supportLevel,
      withdrawalRule: "",
    },
    assessmentPlan: {
      evidenceItems,
      successRule: {
        priority: ["communicative_success", "comprehensibility", "appropriateness", "target_form_control"],
        minimumRequiredEvidenceItems: evidenceItems.length,
      },
      criticalErrors: ["Failure to communicate the node mission."],
      nonCriticalErrors: ["Secondary form errors that preserve the intended meaning."],
      supportPolicy: "Do not exceed the route-node support ceiling.",
    },
    feedbackPolicy: {
      priority: ["meaning", "comprehensibility", "lesson_target", "secondary_form"],
      correctionDensity: "focused",
      explanationDepth: "micro",
      retryPolicy: "retry_with_hint",
    },
    generationConstraints: {
      mustUse: [],
      mustIncludeFunctions: [],
      mustNotIntroduce: [],
      forbiddenPatternRefs: [],
      allowedLexicalDomains: [],
      registerConstraint: "Use only the register authorized by the adapted unit and route.",
      difficultyCeiling: "A1 bounded content only.",
      privacyConstraint: "real_personal_data_not_required",
      culturalConstraint: "Use neutral, non-stereotyped contexts and allow fictitious personal data.",
      outputLanguagePolicy: {
        targetLanguage: "German",
        explanationLanguage: "Spanish",
        translationVisibility: "optional",
        transliteration: "none",
      },
    },
    variationPolicy: {
      frozen: ["mission", "productive_targets", "assessment", "load_ceilings"],
      variable: ["names", "scenes", "examples", "characters"],
    },
    validation: {
      missionAudit: notRun(),
      sourceTraceAudit: notRun(),
      coverageAudit: notRun(),
      inventoryAudit: notRun(),
      loadAudit: notRun(),
      recyclingAudit: notRun(),
      levelAudit: notRun(),
      projectionAudit: notRun(),
      naturalnessAudit: notRun(),
      assessmentAlignmentAudit: notRun(),
      deferredScopeAudit: notRun(),
      privacyAudit: notRun(),
      variationAudit: notRun(),
    },
    version: "1.0.0",
    status: "review",
  };
}

function reviewL05() {
  const value = structuredClone(germanA1U01L05LessonSpecFixture);
  value.status = "review";
  value.validation = Object.fromEntries(
    Object.keys(value.validation).map((key) => [key, notRun()]),
  ) as typeof value.validation;
  return value;
}

function readyInput() {
  return {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
    explanationLanguage: "Spanish",
  };
}

test("M10 refuses to call a planner while M4 still has open German gaps", async () => {
  const initial = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
  assert.ok(initial.plan);
  let calls = 0;
  const planner = new OpenAIAdaptedCurriculumPlanner(async () => {
    calls += 1;
    return { output_parsed: {} };
  }, "fixture-model");

  await assert.rejects(
    planner.plan({
      curriculum: a1U01CurriculumFixture,
      languageProfile: germanLanguageProfileFixture,
      registry: germanDecisionRegistryFixture,
      adaptationPlan: initial.plan!,
      explanationLanguage: "Spanish",
    }),
    (error: unknown) =>
      error instanceof StructuredCandidateBoundaryError && error.code === "invalid_input",
  );
  assert.equal(calls, 0);
});

test("M10 plans and server-seals a complete German A1-U01 bundle", async () => {
  const route = reviewRoute();
  let lessonIndex = 0;
  const planner = new OpenAIAdaptedCurriculumPlanner(async (request) => {
    if (request.stage === "adapted_unit") return { output_parsed: reviewAdaptedUnit() };
    if (request.stage === "lesson_route") return { output_parsed: route };
    const node = route.nodes.slice().sort((a, b) => a.orderHint - b.orderHint)[lessonIndex++]!;
    if (node.nodeId === "N05") return { output_parsed: reviewL05() };
    return { output_parsed: makeGenericLesson(node, route) };
  }, "fixture-model");

  const result = await planner.plan(readyInput());
  assert.equal(result.bundle.adaptedUnit.status, "canonical");
  assert.equal(result.bundle.route.status, "canonical");
  assert.equal(result.bundle.lessonSpecs.length, 13);
  assert.equal(result.bundle.lessonSpecs.every((lesson) => lesson.status === "canonical"), true);
  assert.equal(result.stageHistory.length, 15);
  assert.equal(result.stageHistory.filter((entry) => entry.stage === "lesson_spec").length, 13);
  assert.equal(
    Object.values(result.bundle.adaptedUnit.validation).every((audit) => audit.status === "pass"),
    true,
  );
  assert.equal(
    result.bundle.lessonSpecs.every((lesson) =>
      Object.values(lesson.validation).every((audit) => audit.status === "pass"),
    ),
    true,
  );

  const orchestration = evaluateLanguageOrchestration(result.bundle);
  assert.equal(orchestration.stage, "ready_for_generation", JSON.stringify(orchestration.validation.issues, null, 2));
  assert.equal(orchestration.validation.valid, true, JSON.stringify(orchestration.validation.issues, null, 2));
});

test("M10 retries when the model tries to self-approve the AdaptedUnitSpec", async () => {
  const route = reviewRoute();
  let adaptedAttempts = 0;
  let lessonIndex = 0;
  const planner = new OpenAIAdaptedCurriculumPlanner(async (request) => {
    if (request.stage === "adapted_unit") {
      adaptedAttempts += 1;
      if (adaptedAttempts === 1) return { output_parsed: structuredClone(germanA1U01AdaptedUnitFixture) };
      return { output_parsed: reviewAdaptedUnit() };
    }
    if (request.stage === "lesson_route") return { output_parsed: route };
    const node = route.nodes.slice().sort((a, b) => a.orderHint - b.orderHint)[lessonIndex++]!;
    return { output_parsed: node.nodeId === "N05" ? reviewL05() : makeGenericLesson(node, route) };
  }, "fixture-model");

  const result = await planner.plan(readyInput());
  assert.equal(adaptedAttempts, 2);
  assert.equal(result.stageHistory[0]?.attempts, 2);
  assert.equal(result.stageHistory[0]?.validationHistory[0]?.outcome, "invalid_candidate");
});

test("M10 rejects future-lesson recycling and accepts a corrected retry", async () => {
  const route = reviewRoute();
  let lessonIndex = 0;
  let n01Attempts = 0;
  const planner = new OpenAIAdaptedCurriculumPlanner(async (request) => {
    if (request.stage === "adapted_unit") return { output_parsed: reviewAdaptedUnit() };
    if (request.stage === "lesson_route") return { output_parsed: route };

    const ordered = route.nodes.slice().sort((a, b) => a.orderHint - b.orderHint);
    const node = ordered[lessonIndex]!;
    if (node.nodeId === "N01") {
      n01Attempts += 1;
      const lesson = makeGenericLesson(node, route);
      if (n01Attempts === 1) {
        lesson.languageInventory.recycledLexicon.push({
          lexemeId: "LX.future",
          lemmaOrCanonicalForm: "future",
          meaningFunction: "invalid future recycling fixture",
          grammaticalPackage: {},
          productiveStatus: "recognition_only",
          isNew: false,
          sourceLessonRef: "lesson.A1-U01.de.standard.L02",
          recyclingPurpose: "This must be rejected because L02 has not been planned yet.",
        });
      } else {
        lessonIndex += 1;
      }
      return { output_parsed: lesson };
    }
    lessonIndex += 1;
    return { output_parsed: node.nodeId === "N05" ? reviewL05() : makeGenericLesson(node, route) };
  }, "fixture-model");

  const result = await planner.plan(readyInput());
  assert.equal(n01Attempts, 2);
  const n01History = result.stageHistory.find((entry) => entry.artifactRef.endsWith("L01"));
  assert.equal(n01History?.attempts, 2);
});
