import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OpenAICurriculumDocumentExtractor,
  validateCurriculumDocumentCandidate,
} from "../src/languages/ai/document-curriculum-extractor.js";
import type { LanguageDecision } from "../src/languages/decisions/language-decision-registry.js";
import type {
  CurriculumUnitReviewRecord,
  CurriculumUnitReviewStore,
} from "../src/languages/documents/unit-review.js";
import { CurriculumUnitReviewService } from "../src/languages/documents/unit-review.js";
import type { RealCurriculumDocumentWorkflow } from "../src/languages/documents/real-document-workflow.js";
import type { LessonGenerationWithOutput } from "../src/languages/generation/repository.js";
import type { LessonSpec } from "../src/languages/lessons/lesson-spec.js";
import type {
  CurriculumOrchestrationRunRecord,
  CurriculumOrchestrationStore,
  PlanningBundleRecord,
  TrustedPlanningBundlePayload,
} from "../src/languages/orchestration/repository.js";
import { CurriculumOrchestrationService } from "../src/languages/orchestration/service.js";
import {
  OpenAIAdaptedCurriculumPlanner,
} from "../src/languages/planning/adapted-curriculum-planner.js";
import { AdaptedCurriculumPlanningService } from "../src/languages/planning/service.js";
import { RealA1PilotRunner } from "../src/languages/pilot/real-a1-pilot.js";
import type { ProfileResearchService } from "../src/languages/profile-research/service.js";
import type {
  AdaptationResolutionContext,
  AdaptationResolutionRunRecord,
  AdaptationResolutionStore,
} from "../src/languages/resolution/repository.js";
import { AdaptationResolutionService } from "../src/languages/resolution/service.js";
import type { LessonRoute } from "../src/languages/routing/lesson-route.js";
import { germanA1U01AdaptedUnitFixture } from "./fixtures/adapted-curriculum/german-a1-u01.js";
import { germanM5DecisionRegistryFixture } from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";
import { germanA1U01LessonRouteFixture } from "./fixtures/lesson-route/german-a1-u01.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UNIT_RECORD_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_RECORD_ID = "33333333-3333-4333-8333-333333333333";
const REGISTRY_RECORD_ID = "44444444-4444-4444-8444-444444444444";
const DOCUMENT_ID = "pilot.marco.a1.u01";
const DOCUMENT_VERSION = "1.0.0";

const notRun = () => ({ status: "not_run" as const, findings: [] as string[] });

function reviewCurriculumFromRealSource() {
  const unit = structuredClone(a1U01CurriculumFixture);
  unit.status = "review";
  const existingPrimary = unit.provenance.sources.find((source) => source.role === "primary");
  if (existingPrimary) existingPrimary.role = "supporting";
  unit.provenance.sources.unshift({
    sourceId: DOCUMENT_ID,
    role: "primary",
    reference: `${DOCUMENT_ID}@${DOCUMENT_VERSION}`,
    title: "Marco maestro neutro A1 - Unidad 1",
  });
  return unit;
}

class MemoryCurriculumReviewStore implements CurriculumUnitReviewStore {
  review: CurriculumUnitReviewRecord | null = null;
  constructor(readonly candidate = reviewCurriculumFromRealSource()) {}

  async findOwnedCandidate(userId: string, unitRecordId: string) {
    if (userId !== USER_ID || unitRecordId !== UNIT_RECORD_ID) return null;
    return { sourceUnitRecordId: UNIT_RECORD_ID, spec: structuredClone(this.candidate) };
  }

  async createReview(input: {
    userId: string;
    sourceUnitRecordId: string;
    action: CurriculumUnitReviewRecord["action"];
    reviewNote: string;
    promotedSpec: CurriculumUnitReviewRecord["promotedSpec"];
    promotedSpecSha256: string | null;
  }) {
    if (input.userId !== USER_ID || input.sourceUnitRecordId !== UNIT_RECORD_ID || this.review) {
      return null;
    }
    this.review = {
      id: randomUUID(),
      userId: input.userId,
      sourceUnitRecordId: input.sourceUnitRecordId,
      action: input.action,
      reviewNote: input.reviewNote,
      promotedSpec: structuredClone(input.promotedSpec),
      promotedSpecSha256: input.promotedSpecSha256,
      reviewedAt: new Date(),
    };
    return structuredClone(this.review);
  }

  async findReview(userId: string, unitRecordId: string) {
    if (userId !== USER_ID || unitRecordId !== UNIT_RECORD_ID || !this.review) return null;
    return structuredClone(this.review);
  }
}

class MemoryResolutionStore implements AdaptationResolutionStore {
  runs: AdaptationResolutionRunRecord[] = [];
  contexts = new Map<string, AdaptationResolutionContext>();

  addContext(context: AdaptationResolutionContext) {
    this.contexts.set(
      `${context.profileRecordId}:${context.registryRecordId}`,
      structuredClone(context),
    );
  }

  async loadContext(input: {
    userId: string;
    curriculumUnitRecordId: string;
    profileRecordId: string;
    registryRecordId: string;
  }) {
    if (input.userId !== USER_ID || input.curriculumUnitRecordId !== UNIT_RECORD_ID) return null;
    return structuredClone(
      this.contexts.get(`${input.profileRecordId}:${input.registryRecordId}`) ?? null,
    );
  }

  async createRun(input: {
    userId: string;
    context: AdaptationResolutionContext;
    previousRunId?: string | null;
    stage: AdaptationResolutionRunRecord["stage"];
    adaptationPlan: AdaptationResolutionRunRecord["adaptationPlan"];
    activeResearchTaskRef?: string | null;
    blockedResearchTaskRefs?: string[];
    proposalIds?: string[];
    detail?: string | null;
    contentSha256: string;
  }) {
    if (input.userId !== USER_ID) return null;
    const run: AdaptationResolutionRunRecord = {
      id: randomUUID(),
      userId: input.userId,
      curriculumUnitRecordId: input.context.curriculumUnitRecordId,
      profileRecordId: input.context.profileRecordId,
      registryRecordId: input.context.registryRecordId,
      previousRunId: input.previousRunId ?? null,
      stage: input.stage,
      adaptationPlan: structuredClone(input.adaptationPlan),
      activeResearchTaskRef: input.activeResearchTaskRef ?? null,
      blockedResearchTaskRefs: [...(input.blockedResearchTaskRefs ?? [])],
      proposalIds: [...(input.proposalIds ?? [])],
      detail: input.detail ?? null,
      contentSha256: input.contentSha256,
      createdAt: new Date(),
    };
    this.runs.push(run);
    return structuredClone(run);
  }

  async findRunForUser(userId: string, runId: string) {
    const run = this.runs.find((entry) => entry.userId === userId && entry.id === runId);
    return run ? structuredClone(run) : null;
  }
}

function uuid(counter: number) {
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

class MemoryOrchestrationStore implements CurriculumOrchestrationStore {
  bundles: PlanningBundleRecord[] = [];
  runs: CurriculumOrchestrationRunRecord[] = [];
  private counter = 1;

  async createPlanningBundle(input: {
    userId: string;
    curriculumUnitRecordId: string;
    payload: TrustedPlanningBundlePayload;
    contentSha256: string;
  }) {
    if (input.userId !== USER_ID || input.curriculumUnitRecordId !== UNIT_RECORD_ID) return null;
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
    return structuredClone(record);
  }

  async findPlanningBundleForUser(userId: string, bundleId: string) {
    return structuredClone(
      this.bundles.find((bundle) => bundle.userId === userId && bundle.id === bundleId) ?? null,
    );
  }

  async beginRun(input: { userId: string; planningBundleId: string; expectedLessonCount: number }) {
    const bundle = await this.findPlanningBundleForUser(input.userId, input.planningBundleId);
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

  async appendGenerationRun(input: { userId: string; runId: string; generationRunId: string }) {
    const run = this.runs.find(
      (entry) => entry.userId === input.userId && entry.id === input.runId && entry.status === "running",
    );
    if (!run || run.generationRunIds.includes(input.generationRunId)) return null;
    run.generationRunIds.push(input.generationRunId);
    return structuredClone(run);
  }

  async completeRun(userId: string, runId: string) {
    const run = this.runs.find(
      (entry) => entry.userId === userId && entry.id === runId && entry.status === "running",
    );
    if (!run || run.generationRunIds.length !== run.expectedLessonCount) return null;
    run.status = "ready";
    run.completedAt = new Date();
    return structuredClone(run);
  }

  async failRun(input: { userId: string; runId: string; errorCode: string }) {
    const run = this.runs.find(
      (entry) => entry.userId === input.userId && entry.id === input.runId && entry.status === "running",
    );
    if (!run) return null;
    run.status = "failed";
    run.errorCode = input.errorCode;
    run.completedAt = new Date();
    return structuredClone(run);
  }

  async findRunForUser(userId: string, runId: string) {
    return structuredClone(
      this.runs.find((entry) => entry.userId === userId && entry.id === runId) ?? null,
    );
  }
}

class CapturingGeneration {
  lessonIds: string[] = [];
  private counter = 100;

  async generate(userId: string, lessonSpec: LessonSpec): Promise<LessonGenerationWithOutput> {
    this.lessonIds.push(lessonSpec.identity.lessonSpecId);
    const now = new Date();
    return {
      run: {
        id: uuid(this.counter++),
        userId,
        lessonSpecId: lessonSpec.identity.lessonSpecId,
        lessonSpecVersion: lessonSpec.version,
        languageId: lessonSpec.identity.languageId,
        varietyId: lessonSpec.identity.varietyId,
        levelId: lessonSpec.identity.levelId,
        unitId: lessonSpec.identity.unitId,
        routeNodeRef: lessonSpec.identity.routeNodeRef,
        generationIntent: lessonSpec.generationIntent,
        lessonSpec: structuredClone(lessonSpec),
        generatorKey: "m15-pilot-fixture",
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

function reviewAdaptedUnit(curriculumVersion: string, adaptationPlanVersion: string) {
  const value = structuredClone(germanA1U01AdaptedUnitFixture);
  value.sourceBinding.curriculumUnitSpecRef.version = curriculumVersion;
  value.sourceBinding.adaptationPlanRef.version = adaptationPlanVersion;
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

function reviewL05() {
  const value = structuredClone(germanA1U01L05LessonSpecFixture);
  value.status = "review";
  value.validation = Object.fromEntries(
    Object.keys(value.validation).map((key) => [key, notRun()]),
  ) as typeof value.validation;
  return value;
}

function makeGenericLesson(node: LessonRoute["nodes"][number], route: LessonRoute): LessonSpec {
  const order = String(node.orderHint).padStart(2, "0");
  const primaryTarget = node.capabilityRefs[0]!;
  const assessmentCriterionRefs = route.assessmentDistribution
    .filter((entry) => entry.nodeRefs.includes(node.nodeId))
    .map((entry) => entry.criterionRef);
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
      newPhonologicalLoad: node.newLoad.phonological,
      newLiteracyLoad: node.newLoad.literacy,
      newDiscourseLoad: node.newLoad.discourse,
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
        priority: [
          "communicative_success",
          "comprehensibility",
          "appropriateness",
          "target_form_control",
        ],
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

function fakeDocumentWorkflow(unit = reviewCurriculumFromRealSource()) {
  return {
    async process() {
      return {
        version: {} as never,
        extractionPerformed: false,
        compilation: {
          run: {} as never,
          units: [
            {
              id: UNIT_RECORD_ID,
              compilationRunId: randomUUID(),
              unitId: unit.identity.unitId,
              specVersion: unit.specVersion,
              unitOrder: unit.identity.unitOrder,
              status: unit.status,
              spec: structuredClone(unit),
              createdAt: new Date(),
            },
          ],
        },
      };
    },
  } as unknown as RealCurriculumDocumentWorkflow;
}

function noResearchService() {
  return {
    async researchBlockedRun() {
      throw new Error("M15 resolved replay must not invoke profile research.");
    },
  } as unknown as ProfileResearchService;
}

function resolvedResolutionService(store: MemoryResolutionStore) {
  const proposer = {
    async propose() {
      throw new Error("M15 resolved replay must not invoke M6 decision reasoning.");
    },
  };
  const knowledge = {
    async persistDecisionCandidate() {
      throw new Error("unexpected proposal persistence");
    },
    async getProposal() {
      throw new Error("unexpected proposal read");
    },
  };
  return new AdaptationResolutionService(store, proposer as never, knowledge as never);
}

test("M15 real A1 source snapshot passes the M6 structured curriculum boundary", async () => {
  const sourceText = await readFile(
    new URL("./fixtures/real-a1/marco-maestro-neutro-a1-unidad-1.txt", import.meta.url),
    "utf8",
  );
  assert.match(sourceText, /A1_1011V_DE/u);
  assert.match(sourceText, /A1_1018S_DE/u);
  assert.match(sourceText, /ruta recomendada de 13 lecciones/iu);
  assert.match(sourceText, /no depende del alemán/iu);

  let providerCalls = 0;
  const extractor = new OpenAICurriculumDocumentExtractor(async (request) => {
    providerCalls += 1;
    assert.match(request.input, /Unidad 1: primer contacto, identidad y supervivencia comunicativa/u);
    assert.match(request.input, /A1_1018S_DE/u);
    const unit = reviewCurriculumFromRealSource();
    return {
      output_parsed: {
        documentRef: { id: DOCUMENT_ID, version: DOCUMENT_VERSION },
        curriculumId: "memoos-core-language",
        levelId: "A1",
        units: [unit],
      },
    };
  }, "m15-fixture-model");

  const result = await extractor.extract({
    documentId: DOCUMENT_ID,
    documentVersion: DOCUMENT_VERSION,
    sourceTitle: "Marco maestro neutro A1 - Unidad 1",
    sourceFormat: "docx_extracted_text",
    sourceLanguageHint: "es",
    curriculumId: "memoos-core-language",
    levelId: "A1",
    sourceText,
    unitCountHint: { min: 1, max: 1 },
  });

  assert.equal(providerCalls, 1);
  assert.equal(result.value.units.length, 1);
  const unit = result.value.units[0]!;
  assert.equal(unit.status, "review");
  assert.equal(unit.identity.unitId, "A1-U01");
  assert.equal(unit.competencies.length, 8);
  assert.equal(unit.adaptationRequirements.length, 10);
  assert.equal(unit.learningRoute.steps.length, 13);
  assert.equal(
    validateCurriculumDocumentCandidate(result.value, {
      documentId: DOCUMENT_ID,
      documentVersion: DOCUMENT_VERSION,
      sourceTitle: "Marco maestro neutro A1 - Unidad 1",
      sourceFormat: "docx_extracted_text",
      sourceLanguageHint: "es",
      curriculumId: "memoos-core-language",
      levelId: "A1",
      sourceText,
      unitCountHint: { min: 1, max: 1 },
    }).valid,
    true,
  );
});

test("M15 curriculum promotion keeps the M6 candidate immutable and creates canonical 1.0.1", async () => {
  const store = new MemoryCurriculumReviewStore();
  const service = new CurriculumUnitReviewService(store);
  const before = structuredClone(store.candidate);
  const review = await service.review(USER_ID, UNIT_RECORD_ID, {
    action: "accept",
    note: "Reviewed against the real Unit 1 Marco; competency, route, assessment and anti-projection intent are preserved.",
  });

  assert.equal(review.action, "accepted");
  assert.equal(review.promotedSpec?.status, "canonical");
  assert.equal(review.promotedSpec?.specVersion, "1.0.1");
  assert.deepEqual(store.candidate, before, "source review candidate must remain immutable");
  const normalizedPromoted = structuredClone(review.promotedSpec!);
  normalizedPromoted.status = "review";
  normalizedPromoted.specVersion = before.specVersion;
  assert.deepEqual(normalizedPromoted, before, "promotion may only change lifecycle status/version");
  await assert.rejects(
    service.review(USER_ID, UNIT_RECORD_ID, { action: "reject", note: "second review" }),
    /already_reviewed/u,
  );
});

test("M15 cold-start pilot stops before M13 until the real extracted curriculum is reviewed", async () => {
  const reviewStore = new MemoryCurriculumReviewStore();
  const reviewService = new CurriculumUnitReviewService(reviewStore);
  let resolutionCalls = 0;
  const runner = new RealA1PilotRunner(
    fakeDocumentWorkflow(),
    reviewService,
    { async start() { resolutionCalls += 1; throw new Error("must not run"); } } as never,
    new MemoryResolutionStore(),
    noResearchService(),
    {} as never,
    {} as never,
  );

  const result = await runner.run({
    userId: USER_ID,
    documentId: DOCUMENT_ID,
    documentVersion: DOCUMENT_VERSION,
    expectedUnitId: "A1-U01",
    profileRecordId: PROFILE_RECORD_ID,
    registryRecordId: REGISTRY_RECORD_ID,
    explanationLanguage: "Spanish",
  });

  assert.equal(result.status, "awaiting_curriculum_review");
  assert.equal(resolutionCalls, 0);
});

test("M15 resolved replay runs canonical real A1-U01 through M13 -> M10 -> M9 and launches 13 generation runs", async () => {
  const reviewStore = new MemoryCurriculumReviewStore();
  const reviewService = new CurriculumUnitReviewService(reviewStore);
  const review = await reviewService.review(USER_ID, UNIT_RECORD_ID, {
    action: "accept",
    note: "M15 pilot approval of the real A1 Unit 1 curriculum candidate.",
  });
  assert.ok(review.promotedSpec);

  const resolutionStore = new MemoryResolutionStore();
  resolutionStore.addContext({
    curriculumUnitRecordId: UNIT_RECORD_ID,
    curriculum: structuredClone(review.promotedSpec),
    profileRecordId: PROFILE_RECORD_ID,
    languageProfile: structuredClone(germanLanguageProfileFixture),
    registryRecordId: REGISTRY_RECORD_ID,
    registry: structuredClone(germanM5DecisionRegistryFixture),
  });
  const resolutionService = resolvedResolutionService(resolutionStore);

  const route = reviewRoute();
  let lessonIndex = 0;
  const planner = new OpenAIAdaptedCurriculumPlanner(async (request) => {
    if (request.stage === "adapted_unit") {
      return {
        output_parsed: reviewAdaptedUnit(
          review.promotedSpec!.specVersion,
          germanM5DecisionRegistryFixture.version,
        ),
      };
    }
    if (request.stage === "lesson_route") return { output_parsed: route };
    const node = route.nodes
      .slice()
      .sort((left, right) => left.orderHint - right.orderHint)[lessonIndex++]!;
    return {
      output_parsed: node.nodeId === "N05" ? reviewL05() : makeGenericLesson(node, route),
    };
  }, "m15-planner-fixture");

  const orchestrationStore = new MemoryOrchestrationStore();
  const generation = new CapturingGeneration();
  const orchestration = new CurriculumOrchestrationService(orchestrationStore, generation);
  const planning = new AdaptedCurriculumPlanningService(planner, orchestration);

  const runner = new RealA1PilotRunner(
    fakeDocumentWorkflow(),
    reviewService,
    resolutionService,
    resolutionStore,
    noResearchService(),
    planning,
    orchestration,
  );

  const result = await runner.run({
    userId: USER_ID,
    documentId: DOCUMENT_ID,
    documentVersion: DOCUMENT_VERSION,
    expectedUnitId: "A1-U01",
    profileRecordId: PROFILE_RECORD_ID,
    registryRecordId: REGISTRY_RECORD_ID,
    explanationLanguage: "Spanish",
  });

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.canonicalCurriculumVersion, "1.0.1");
  assert.equal(result.generatedLessonCount, 13);
  assert.equal(generation.lessonIds.length, 13);
  assert.equal(new Set(generation.lessonIds).size, 13);
  assert.equal(orchestrationStore.bundles.length, 1);
  assert.equal(orchestrationStore.runs[0]?.status, "ready");
  assert.equal(orchestrationStore.bundles[0]?.payload.curriculum.status, "canonical");
  assert.equal(orchestrationStore.bundles[0]?.payload.curriculum.specVersion, "1.0.1");
  assert.equal(orchestrationStore.bundles[0]?.payload.lessonSpecs.length, 13);
});

test("M15 migration adds the review gate without destructive SQL", async () => {
  const migration = await readFile(
    new URL("../drizzle/0025_create_language_curriculum_unit_reviews.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE language_curriculum_unit_reviews/u);
  assert.match(migration, /UNIQUE \(source_unit_record_id\)/u);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b/iu);
});
