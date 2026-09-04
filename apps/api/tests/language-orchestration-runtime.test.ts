import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLanguageOrchestration,
} from "../src/languages/orchestration/orchestration-runtime.js";
import type { LessonSpec } from "../src/languages/lessons/lesson-spec.js";
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

function orchestrationBase() {
  return {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  };
}

function minimalLessonForNode(
  node: (typeof germanA1U01LessonRouteFixture.nodes)[number],
  index: number,
): LessonSpec {
  const lesson = structuredClone(germanA1U01L05LessonSpecFixture);
  lesson.identity.lessonSpecId = `lesson.A1-U01.de.standard.M9-${String(index + 1).padStart(2, "0")}`;
  lesson.identity.routeNodeRef = node.nodeId;
  lesson.identity.lessonOrderHint = index + 1;
  lesson.mission = {
    functionalGoal: `Execute the bounded mission for route node ${node.nodeId}.`,
    observableOutcome: `Complete route node ${node.nodeId} within its authorized scope.`,
    successContext: "M9 orchestration completeness fixture.",
  };
  lesson.curriculumBinding = {
    capabilityRefs: [node.capabilityRefs[0]!],
    realizationRefs: [],
    sourceAdaptedStepRefs: [germanA1U01AdaptedUnitFixture.adaptedLearningRoute[0]!.adaptedStepId],
    assessmentCriterionRefs: [],
  };
  lesson.inputTargets = {
    mustRecognize: [],
    mayEncounter: [],
    comprehensionFunctions: [],
    supportAllowed: true,
  };
  lesson.productiveTargets = {
    requiredFunctions: [],
    requiredPatternRefs: [],
    productionTargetRefs: [],
    acceptableVariation: [],
    deferredAlternatives: [],
    supportCeiling: node.supportLevel,
  };
  lesson.languageInventory = {
    patterns: [],
    coreLexicon: [],
    supportingLexicon: [],
    recycledLexicon: [],
    functionItems: [],
    pronunciationItems: [],
    literacyItems: [],
  };
  lesson.loadPolicy = {
    newStructuralLoad: 0,
    newCoreLexicalCount: 0,
    newSupportingLexicalCount: 0,
    newPhonologicalLoad: "none",
    newLiteracyLoad: "none",
    newDiscourseLoad: "none",
    knownContentTargetRatio: 1,
    coreLexicalHardMax: 12,
  };
  lesson.contentArchitecture = {
    blocks: [
      {
        blockId: `B.${node.nodeId}`,
        blockType: "context",
        purpose: `Represent ${node.nodeId} without introducing downstream language material.`,
        targetRefs: [],
      },
    ],
  };
  lesson.practicePlan = [];
  lesson.pronunciationPlan = {
    targetRefs: [],
    perceptionGoal: "",
    productionGoal: "",
    practiceTypes: [],
    audioRequired: false,
    tolerance: "",
  };
  lesson.literacyPlan = {
    scriptRefs: [],
    recognitionItems: [],
    productionItems: [],
    displayPolicy: "Standard orthography.",
    transliterationPolicy: "None.",
    supportLevel: node.supportLevel,
    withdrawalRule: "Not applicable in this orchestration fixture.",
  };
  lesson.assessmentPlan = {
    evidenceItems: [],
    successRule: {
      priority: ["communicative_success"],
      minimumRequiredEvidenceItems: 0,
    },
    criticalErrors: [],
    nonCriticalErrors: [],
    supportPolicy: "No extra standard is introduced by this fixture.",
  };
  lesson.feedbackPolicy = {
    priority: ["meaning"],
    correctionDensity: "minimal",
    explanationDepth: "none",
    retryPolicy: "no_retry_required",
  };
  lesson.generationConstraints = {
    mustUse: [],
    mustIncludeFunctions: [],
    mustNotIntroduce: [],
    forbiddenPatternRefs: [],
    allowedLexicalDomains: [],
    registerConstraint: "Remain inside the upstream authorized register.",
    difficultyCeiling: "A1",
    privacyConstraint: "neutral",
    culturalConstraint: "No new cultural assumptions.",
    outputLanguagePolicy: {
      targetLanguage: "German",
      explanationLanguage: "Spanish",
      translationVisibility: "optional",
      transliteration: "none",
    },
  };
  lesson.variationPolicy = {
    frozen: ["mission", "productive_targets"],
    variable: [],
  };
  lesson.validation = Object.fromEntries(
    Object.keys(lesson.validation).map((key) => [key, { status: "pass", findings: [] }]),
  ) as LessonSpec["validation"];
  lesson.generationIntent = "canonical";
  lesson.status = "canonical";
  lesson.version = "1.0.0";
  return lesson;
}

test("M9 stops the current German A1 pipeline at registry reasoning instead of inventing M5 artifacts", () => {
  const result = evaluateLanguageOrchestration(orchestrationBase());
  assert.equal(result.stage, "awaiting_registry_reasoning");
  assert.equal(result.nextAction, "propose_registry_decisions");
  assert.equal(result.researchTaskRefs.length, 5);
  assert.equal(result.blockingGapRefs.length, 8);
  assert.equal(result.validation.valid, true);
});

test("M9 rejects downstream artifacts while the adaptation plan still has blocking gaps", () => {
  const result = evaluateLanguageOrchestration({
    ...orchestrationBase(),
    adaptedUnit: germanA1U01AdaptedUnitFixture,
    route: germanA1U01LessonRouteFixture,
    lessonSpecs: [germanA1U01L05LessonSpecFixture],
  });
  assert.equal(result.stage, "awaiting_registry_reasoning");
  assert.equal(
    result.validation.issues.some(
      (issue) => issue.code === "DOWNSTREAM_ARTIFACTS_BEFORE_ADAPTATION_READY",
    ),
    true,
  );
});

test("M9 asks for adapted curriculum only after a ready audited AdaptationPlan exists", () => {
  const result = evaluateLanguageOrchestration({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
  });
  assert.equal(result.stage, "awaiting_adapted_curriculum");
  assert.equal(result.nextAction, "produce_adapted_curriculum");
  assert.equal(result.validation.valid, true);
});

test("M9 refuses to launch a whole route when required route nodes lack LessonSpecs", () => {
  const result = evaluateLanguageOrchestration({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
    adaptedUnit: germanA1U01AdaptedUnitFixture,
    route: germanA1U01LessonRouteFixture,
    lessonSpecs: [germanA1U01L05LessonSpecFixture],
  });
  assert.equal(result.stage, "blocked_invalid_input");
  assert.equal(
    result.validation.issues.some((issue) => issue.code === "ROUTE_NODE_WITHOUT_LESSON_SPEC"),
    true,
  );
});

test("M9 reaches production only with a complete validated LessonSpec set", () => {
  const lessonSpecs = germanA1U01LessonRouteFixture.nodes
    .filter((node) => !node.optional)
    .map(minimalLessonForNode);
  const result = evaluateLanguageOrchestration({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
    adaptationPlan: buildReadyGermanAdaptationPlanFixture(),
    adaptedUnit: germanA1U01AdaptedUnitFixture,
    route: germanA1U01LessonRouteFixture,
    lessonSpecs,
  });
  assert.equal(result.stage, "ready_for_generation", JSON.stringify(result.validation.issues, null, 2));
  assert.equal(result.nextAction, "generate_lessons");
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues, null, 2));
  assert.equal(result.readyLessonSpecRefs.length, lessonSpecs.length);
});
