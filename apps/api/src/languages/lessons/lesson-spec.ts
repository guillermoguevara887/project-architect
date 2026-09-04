import { z } from "zod";
import {
  domainIdSchema,
  requiredTextSchema,
  semanticVersionSchema,
  supportLevelSchema,
  versionedRefSchema,
} from "../curriculum/primitives.js";
import {
  validationIssue,
  validationResult,
  zodIssuesToValidationIssues,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";
import {
  productiveStatusSchema,
  type AdaptedUnitSpec,
} from "../adapted/adapted-unit-spec.js";
import type { LessonRoute } from "../routing/lesson-route.js";

const idListSchema = z.array(domainIdSchema);
const textListSchema = z.array(requiredTextSchema);

const scalePolicySchema = z
  .object({
    metric: z.enum([
      "words",
      "characters",
      "utterances",
      "turns",
      "clauses",
      "semantic_units",
      "task_completion",
    ]),
    min: z.number().nonnegative().optional(),
    target: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
    equivalenceAllowed: z.boolean(),
  })
  .strict();

const patternInventoryItemSchema = z
  .object({
    patternRef: domainIdSchema,
    role: z.enum(["central", "supporting", "recycled"]),
    productiveStatus: productiveStatusSchema,
    exampleSlotSchema: z.array(requiredTextSchema),
    constraints: textListSchema,
  })
  .strict();

const lexiconItemSchema = z
  .object({
    lexemeId: domainIdSchema,
    lemmaOrCanonicalForm: requiredTextSchema,
    meaningFunction: requiredTextSchema,
    grammaticalPackage: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    productiveStatus: productiveStatusSchema,
    isNew: z.boolean(),
  })
  .strict();

const recycledLexiconItemSchema = lexiconItemSchema.extend({
  sourceLessonRef: domainIdSchema,
  recyclingPurpose: requiredTextSchema,
});

const functionItemSchema = z
  .object({
    itemId: domainIdSchema,
    canonicalForm: requiredTextSchema,
    function: requiredTextSchema,
    category: z.enum([
      "particle",
      "determiner",
      "interrogative",
      "auxiliary",
      "connector",
      "classifier",
      "discourse_marker",
      "other",
    ]),
    productiveStatus: productiveStatusSchema,
  })
  .strict();

const pronunciationItemSchema = z
  .object({
    targetRef: domainIdSchema,
    formOrCue: requiredTextSchema,
    perceptionGoal: requiredTextSchema,
    productionGoal: requiredTextSchema,
    tolerance: requiredTextSchema,
  })
  .strict();

const literacyItemSchema = z
  .object({
    targetRef: domainIdSchema,
    formOrCue: requiredTextSchema,
    recognitionRequired: z.boolean(),
    productionRequired: z.boolean(),
    supportAllowed: z.boolean(),
  })
  .strict();

const contentBlockSchema = z
  .object({
    blockId: domainIdSchema,
    blockType: z.enum([
      "context",
      "input",
      "notice",
      "micro_explanation",
      "guided_practice",
      "retrieval",
      "communicative_practice",
      "pronunciation",
      "literacy",
      "integration",
      "assessment",
    ]),
    purpose: requiredTextSchema,
    targetRefs: idListSchema,
    inputSpec: z
      .object({
        inputType: z.enum([
          "short_dialogue",
          "microtext",
          "audio_exchange",
          "visual_context",
          "microstory",
          "profile",
          "list",
        ]),
        noveltyCeiling: z.enum(["low", "moderate", "high"]),
        supportMode: supportLevelSchema,
        scalePolicy: scalePolicySchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const practiceItemSchema = z
  .object({
    practiceId: domainIdSchema,
    practiceType: z.enum([
      "recognition",
      "discrimination",
      "mapping",
      "completion",
      "transformation",
      "retrieval",
      "guided_production",
      "communicative_production",
      "interaction",
      "repair",
    ]),
    targetRefs: idListSchema.min(1),
    supportLevel: supportLevelSchema,
    required: z.boolean(),
  })
  .strict();

const performanceConditionsSchema = z
  .object({
    supportCeiling: supportLevelSchema,
    contextFamiliarity: z.enum(["rehearsed", "similar", "novel_but_bounded"]),
    resourcePolicy: requiredTextSchema,
  })
  .strict();

const evidenceItemSchema = z
  .object({
    evidenceItemId: domainIdSchema,
    evidenceType: z.enum([
      "comprehension",
      "spoken_response",
      "spoken_exchange",
      "written_response",
      "reconstruction",
      "selection",
      "interaction",
    ]),
    capabilityRefs: idListSchema.min(1),
    realizationRefs: idListSchema,
    observableRequirements: textListSchema.min(1),
    performanceConditions: performanceConditionsSchema,
    required: z.boolean(),
  })
  .strict();

const auditSchema = z
  .object({
    status: z.enum(["not_run", "pass", "fail"]),
    findings: textListSchema,
  })
  .strict();

export const lessonSpecSchema = z
  .object({
    identity: z
      .object({
        lessonSpecId: domainIdSchema,
        routeNodeRef: domainIdSchema,
        adaptedUnitRef: versionedRefSchema,
        languageId: domainIdSchema,
        varietyId: domainIdSchema,
        levelId: domainIdSchema,
        unitId: domainIdSchema,
        lessonOrderHint: z.number().int().positive(),
      })
      .strict(),
    sourceBinding: z
      .object({
        lessonRouteRef: versionedRefSchema,
        adaptedUnitSpecRef: versionedRefSchema,
      })
      .strict(),
    generationIntent: z.enum([
      "canonical",
      "variant",
      "regeneration",
      "simplified_variant",
    ]),
    mission: z
      .object({
        functionalGoal: requiredTextSchema,
        observableOutcome: requiredTextSchema,
        successContext: requiredTextSchema,
      })
      .strict(),
    curriculumBinding: z
      .object({
        capabilityRefs: idListSchema.min(1),
        realizationRefs: idListSchema,
        sourceAdaptedStepRefs: idListSchema.min(1),
        assessmentCriterionRefs: idListSchema,
      })
      .strict(),
    inputTargets: z
      .object({
        mustRecognize: idListSchema,
        mayEncounter: idListSchema,
        comprehensionFunctions: idListSchema,
        supportAllowed: z.boolean(),
      })
      .strict(),
    productiveTargets: z
      .object({
        requiredFunctions: idListSchema,
        requiredPatternRefs: idListSchema,
        productionTargetRefs: idListSchema,
        acceptableVariation: textListSchema,
        deferredAlternatives: idListSchema,
        supportCeiling: supportLevelSchema,
      })
      .strict(),
    languageInventory: z
      .object({
        patterns: z.array(patternInventoryItemSchema),
        coreLexicon: z.array(lexiconItemSchema),
        supportingLexicon: z.array(lexiconItemSchema),
        recycledLexicon: z.array(recycledLexiconItemSchema),
        functionItems: z.array(functionItemSchema),
        pronunciationItems: z.array(pronunciationItemSchema),
        literacyItems: z.array(literacyItemSchema),
      })
      .strict(),
    loadPolicy: z
      .object({
        newStructuralLoad: z.number().int().nonnegative().max(3),
        newCoreLexicalCount: z.number().int().nonnegative(),
        newSupportingLexicalCount: z.number().int().nonnegative(),
        newPhonologicalLoad: z.enum(["none", "light", "moderate", "heavy"]),
        newLiteracyLoad: z.enum(["none", "light", "moderate", "heavy"]),
        newDiscourseLoad: z.enum(["none", "light", "moderate", "heavy"]),
        knownContentTargetRatio: z.number().min(0).max(1),
        coreLexicalHardMax: z.number().int().positive().default(12),
      })
      .strict(),
    contentArchitecture: z
      .object({
        blocks: z.array(contentBlockSchema).min(1),
      })
      .strict(),
    practicePlan: z.array(practiceItemSchema),
    pronunciationPlan: z
      .object({
        targetRefs: idListSchema,
        perceptionGoal: z.string(),
        productionGoal: z.string(),
        practiceTypes: idListSchema,
        audioRequired: z.boolean(),
        tolerance: z.string(),
      })
      .strict(),
    literacyPlan: z
      .object({
        scriptRefs: idListSchema,
        recognitionItems: idListSchema,
        productionItems: idListSchema,
        displayPolicy: z.string(),
        transliterationPolicy: z.string(),
        supportLevel: supportLevelSchema,
        withdrawalRule: z.string(),
      })
      .strict(),
    assessmentPlan: z
      .object({
        evidenceItems: z.array(evidenceItemSchema),
        successRule: z
          .object({
            priority: z.array(
              z.enum([
                "communicative_success",
                "comprehensibility",
                "appropriateness",
                "target_form_control",
                "secondary_accuracy",
              ]),
            ).min(1),
            minimumRequiredEvidenceItems: z.number().int().nonnegative(),
          })
          .strict(),
        criticalErrors: textListSchema,
        nonCriticalErrors: textListSchema,
        supportPolicy: requiredTextSchema,
      })
      .strict(),
    feedbackPolicy: z
      .object({
        priority: z.array(
          z.enum([
            "meaning",
            "comprehensibility",
            "social_appropriateness",
            "lesson_target",
            "secondary_form",
            "style",
          ]),
        ).min(1),
        correctionDensity: z.enum(["minimal", "focused", "moderate", "comprehensive"]),
        explanationDepth: z.enum(["none", "micro", "brief", "extended"]),
        retryPolicy: z.enum([
          "immediate_retry",
          "retry_with_hint",
          "model_then_retry",
          "no_retry_required",
        ]),
      })
      .strict(),
    generationConstraints: z
      .object({
        mustUse: idListSchema,
        mustIncludeFunctions: idListSchema,
        mustNotIntroduce: idListSchema,
        forbiddenPatternRefs: idListSchema,
        allowedLexicalDomains: idListSchema,
        registerConstraint: requiredTextSchema,
        difficultyCeiling: requiredTextSchema,
        privacyConstraint: z.enum([
          "real_personal_data_not_required",
          "fictitious_preferred",
          "neutral",
        ]),
        culturalConstraint: requiredTextSchema,
        outputLanguagePolicy: z
          .object({
            targetLanguage: requiredTextSchema,
            explanationLanguage: requiredTextSchema,
            translationVisibility: z.enum(["hidden", "optional", "visible"]),
            transliteration: z.enum(["none", "temporary", "optional", "visible"]),
          })
          .strict(),
      })
      .strict(),
    variationPolicy: z
      .object({
        frozen: z.array(
          z.enum([
            "mission",
            "productive_targets",
            "required_patterns",
            "core_lexicon",
            "register",
            "assessment",
            "load_ceilings",
          ]),
        ).min(1),
        variable: z.array(
          z.enum([
            "names",
            "scenes",
            "surface_order",
            "narrative_details",
            "examples",
            "characters",
            "supporting_lexicon",
          ]),
        ),
      })
      .strict(),
    validation: z
      .object({
        missionAudit: auditSchema,
        sourceTraceAudit: auditSchema,
        coverageAudit: auditSchema,
        inventoryAudit: auditSchema,
        loadAudit: auditSchema,
        recyclingAudit: auditSchema,
        levelAudit: auditSchema,
        projectionAudit: auditSchema,
        naturalnessAudit: auditSchema,
        assessmentAlignmentAudit: auditSchema,
        deferredScopeAudit: auditSchema,
        privacyAudit: auditSchema,
        variationAudit: auditSchema,
      })
      .strict(),
    version: semanticVersionSchema,
    status: z.enum(["draft", "review", "canonical", "deprecated"]),
  })
  .strict();

export type LessonSpec = z.infer<typeof lessonSpecSchema>;

export type LessonSpecValidationContext = {
  route?: LessonRoute;
  adaptedUnit?: AdaptedUnitSpec;
};

const supportRank = {
  independent: 0,
  scaffolded: 1,
  guided: 2,
  highly_guided: 3,
} as const;

function refEqual(
  left: { id: string; version: string },
  right: { id: string; version: string },
) {
  return left.id === right.id && left.version === right.version;
}

function pushDuplicateIds(
  issues: ValidationIssue[],
  entries: Array<{ id: string; path: string }>,
  label: string,
) {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push(
        validationIssue(
          "DUPLICATE_DOMAIN_ID",
          entry.path,
          `Duplicate ${label} ${entry.id}.`,
          { relatedRefs: [entry.id] },
        ),
      );
    }
    seen.add(entry.id);
  }
}

function isProductiveEvidenceType(type: z.infer<typeof evidenceItemSchema>["evidenceType"]) {
  return [
    "spoken_response",
    "spoken_exchange",
    "written_response",
    "interaction",
  ].includes(type);
}

export function validateLessonSpec(
  input: unknown,
  context: LessonSpecValidationContext = {},
): ValidationResult {
  const parsed = lessonSpecSchema.safeParse(input);
  if (!parsed.success) return validationResult(zodIssuesToValidationIssues(parsed.error));

  const lesson = parsed.data;
  const issues: ValidationIssue[] = [];

  pushDuplicateIds(
    issues,
    lesson.languageInventory.patterns.map((entry, index) => ({
      id: entry.patternRef,
      path: `languageInventory.patterns.${index}.patternRef`,
    })),
    "lesson pattern",
  );
  pushDuplicateIds(
    issues,
    lesson.languageInventory.coreLexicon.map((entry, index) => ({
      id: entry.lexemeId,
      path: `languageInventory.coreLexicon.${index}.lexemeId`,
    })),
    "core lexeme",
  );
  pushDuplicateIds(
    issues,
    lesson.contentArchitecture.blocks.map((entry, index) => ({
      id: entry.blockId,
      path: `contentArchitecture.blocks.${index}.blockId`,
    })),
    "content block",
  );
  pushDuplicateIds(
    issues,
    lesson.practicePlan.map((entry, index) => ({
      id: entry.practiceId,
      path: `practicePlan.${index}.practiceId`,
    })),
    "practice item",
  );
  pushDuplicateIds(
    issues,
    lesson.assessmentPlan.evidenceItems.map((entry, index) => ({
      id: entry.evidenceItemId,
      path: `assessmentPlan.evidenceItems.${index}.evidenceItemId`,
    })),
    "evidence item",
  );

  const newCoreCount = lesson.languageInventory.coreLexicon.filter((item) => item.isNew).length;
  const newSupportingCount = lesson.languageInventory.supportingLexicon.filter(
    (item) => item.isNew,
  ).length;
  if (newCoreCount !== lesson.loadPolicy.newCoreLexicalCount) {
    issues.push(
      validationIssue(
        "CORE_LEXICAL_LOAD_MISMATCH",
        "loadPolicy.newCoreLexicalCount",
        `Declared new core lexical count ${lesson.loadPolicy.newCoreLexicalCount} does not match inventory count ${newCoreCount}.`,
      ),
    );
  }
  if (newSupportingCount !== lesson.loadPolicy.newSupportingLexicalCount) {
    issues.push(
      validationIssue(
        "SUPPORTING_LEXICAL_LOAD_MISMATCH",
        "loadPolicy.newSupportingLexicalCount",
        `Declared new supporting lexical count ${lesson.loadPolicy.newSupportingLexicalCount} does not match inventory count ${newSupportingCount}.`,
      ),
    );
  }
  if (newCoreCount > lesson.loadPolicy.coreLexicalHardMax) {
    issues.push(
      validationIssue(
        "CORE_LEXICAL_HARD_MAX_EXCEEDED",
        "languageInventory.coreLexicon",
        `New core lexicon count ${newCoreCount} exceeds hard maximum ${lesson.loadPolicy.coreLexicalHardMax}.`,
      ),
    );
  }
  const centralNewPatterns = lesson.languageInventory.patterns.filter(
    (pattern) => pattern.role === "central" && pattern.productiveStatus !== "recognition_only",
  );
  if (centralNewPatterns.length > 1 || lesson.loadPolicy.newStructuralLoad > 1) {
    issues.push(
      validationIssue(
        "STRUCTURAL_LOAD_CEILING_EXCEEDED",
        "languageInventory.patterns",
        "A lesson may introduce at most one central productive structural pattern by default.",
      ),
    );
  }

  const mustUse = new Set(lesson.generationConstraints.mustUse);
  for (const ref of lesson.generationConstraints.mustNotIntroduce) {
    if (mustUse.has(ref)) {
      issues.push(
        validationIssue(
          "GENERATION_CONSTRAINT_CONFLICT",
          "generationConstraints",
          `Item ${ref} is both required and forbidden.`,
          { relatedRefs: [ref] },
        ),
      );
    }
  }

  if (
    lesson.generationIntent === "simplified_variant" &&
    !lesson.variationPolicy.frozen.includes("productive_targets")
  ) {
    issues.push(
      validationIssue(
        "SIMPLIFIED_VARIANT_MAY_WEAKEN_PRODUCTIVE_TARGETS",
        "variationPolicy.frozen",
        "Simplified variants must freeze productive targets.",
      ),
    );
  }

  if (context.adaptedUnit) {
    const unit = context.adaptedUnit;
    if (
      !refEqual(lesson.sourceBinding.adaptedUnitSpecRef, {
        id: unit.identity.adaptedUnitId,
        version: unit.version,
      }) ||
      !refEqual(lesson.identity.adaptedUnitRef, {
        id: unit.identity.adaptedUnitId,
        version: unit.version,
      })
    ) {
      issues.push(
        validationIssue(
          "ADAPTED_UNIT_SOURCE_REF_MISMATCH",
          "sourceBinding.adaptedUnitSpecRef",
          "LessonSpec is not pinned to the supplied AdaptedUnitSpec.",
        ),
      );
    }

    const capabilities = new Set(unit.capabilityRealizations.map((entry) => entry.capabilityRef));
    const realizations = new Map(
      unit.languageRealizations.map((entry) => [entry.realizationId, entry] as const),
    );
    const patterns = new Map(
      unit.linguisticTargets.patterns.map((entry) => [entry.patternId, entry] as const),
    );
    const adaptedSteps = new Set(unit.adaptedLearningRoute.map((entry) => entry.adaptedStepId));

    lesson.curriculumBinding.capabilityRefs.forEach((ref, index) => {
      if (!capabilities.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_CAPABILITY_REFERENCE",
            `curriculumBinding.capabilityRefs.${index}`,
            `LessonSpec references unknown capability ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
    lesson.curriculumBinding.realizationRefs.forEach((ref, index) => {
      if (!realizations.has(ref)) {
        issues.push(
          validationIssue(
            "DOWNSTREAM_REALIZATION_INVENTION",
            `curriculumBinding.realizationRefs.${index}`,
            `LessonSpec introduces unknown realization ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
    lesson.curriculumBinding.sourceAdaptedStepRefs.forEach((ref, index) => {
      if (!adaptedSteps.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_ADAPTED_STEP_REFERENCE",
            `curriculumBinding.sourceAdaptedStepRefs.${index}`,
            `LessonSpec references unknown adapted step ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });

    lesson.languageInventory.patterns.forEach((item, index) => {
      const upstream = patterns.get(item.patternRef);
      if (!upstream) {
        issues.push(
          validationIssue(
            "DOWNSTREAM_PATTERN_INVENTION",
            `languageInventory.patterns.${index}.patternRef`,
            `Pattern ${item.patternRef} is absent from AdaptedUnitSpec.`,
            { relatedRefs: [item.patternRef] },
          ),
        );
      } else if (
        item.productiveStatus !== "recognition_only" &&
        upstream.productiveStatus === "recognition_only"
      ) {
        issues.push(
          validationIssue(
            "RECOGNITION_ONLY_PATTERN_PROMOTED_PRODUCTIVELY",
            `languageInventory.patterns.${index}.productiveStatus`,
            `Pattern ${item.patternRef} is recognition-only upstream.`,
            { relatedRefs: [item.patternRef] },
          ),
        );
      }
    });

    lesson.productiveTargets.requiredPatternRefs.forEach((ref, index) => {
      const upstream = patterns.get(ref);
      if (!upstream) {
        issues.push(
          validationIssue(
            "DOWNSTREAM_PATTERN_INVENTION",
            `productiveTargets.requiredPatternRefs.${index}`,
            `Required productive pattern ${ref} is absent upstream.`,
            { relatedRefs: [ref] },
          ),
        );
      } else if (upstream.productiveStatus === "recognition_only") {
        issues.push(
          validationIssue(
            "RECOGNITION_ONLY_PATTERN_ASSESSED_PRODUCTIVELY",
            `productiveTargets.requiredPatternRefs.${index}`,
            `Recognition-only pattern ${ref} cannot be a productive target.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });

    lesson.inputTargets.mustRecognize.forEach((ref, index) => {
      if (!realizations.has(ref) && !patterns.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_INPUT_TARGET_REFERENCE",
            `inputTargets.mustRecognize.${index}`,
            `Input target ${ref} is not authorized upstream.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });

    for (const deferred of lesson.productiveTargets.deferredAlternatives) {
      const realization = [...realizations.values()].find((entry) =>
        entry.deferredScope.includes(deferred),
      );
      if (!realization) {
        issues.push(
          validationIssue(
            "UNKNOWN_DEFERRED_SCOPE_REFERENCE",
            "productiveTargets.deferredAlternatives",
            `Deferred alternative ${deferred} is not declared upstream.`,
            { relatedRefs: [deferred] },
          ),
        );
      }
    }

    lesson.assessmentPlan.evidenceItems.forEach((item, itemIndex) => {
      item.capabilityRefs.forEach((ref, refIndex) => {
        if (!lesson.curriculumBinding.capabilityRefs.includes(ref)) {
          issues.push(
            validationIssue(
              "ASSESSMENT_TARGET_NOT_BOUND_TO_LESSON",
              `assessmentPlan.evidenceItems.${itemIndex}.capabilityRefs.${refIndex}`,
              `Assessment capability ${ref} is outside the lesson binding.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
      item.realizationRefs.forEach((ref, refIndex) => {
        const realization = realizations.get(ref);
        if (!realization) {
          issues.push(
            validationIssue(
              "DOWNSTREAM_REALIZATION_INVENTION",
              `assessmentPlan.evidenceItems.${itemIndex}.realizationRefs.${refIndex}`,
              `Assessment references unknown realization ${ref}.`,
              { relatedRefs: [ref] },
            ),
          );
        } else if (isProductiveEvidenceType(item.evidenceType) && realization.productiveCore.length === 0) {
          issues.push(
            validationIssue(
              "RECOGNITION_ONLY_REALIZATION_ASSESSED_PRODUCTIVELY",
              `assessmentPlan.evidenceItems.${itemIndex}.realizationRefs.${refIndex}`,
              `Realization ${ref} has no productive core.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
    });
  }

  if (context.route) {
    const route = context.route;
    if (
      !refEqual(lesson.sourceBinding.lessonRouteRef, {
        id: route.identity.routeId,
        version: route.version,
      })
    ) {
      issues.push(
        validationIssue(
          "LESSON_ROUTE_SOURCE_REF_MISMATCH",
          "sourceBinding.lessonRouteRef",
          "LessonSpec is not pinned to the supplied LessonRoute.",
        ),
      );
    }
    const node = route.nodes.find((candidate) => candidate.nodeId === lesson.identity.routeNodeRef);
    if (!node) {
      issues.push(
        validationIssue(
          "ORPHAN_LESSON_SPEC",
          "identity.routeNodeRef",
          `LessonSpec references missing route node ${lesson.identity.routeNodeRef}.`,
          { relatedRefs: [lesson.identity.routeNodeRef] },
        ),
      );
    } else {
      for (const ref of lesson.curriculumBinding.capabilityRefs) {
        if (!node.capabilityRefs.includes(ref)) {
          issues.push(
            validationIssue(
              "LESSON_CAPABILITY_OUTSIDE_ROUTE_NODE",
              "curriculumBinding.capabilityRefs",
              `Capability ${ref} is outside route node ${node.nodeId}.`,
              { relatedRefs: [ref, node.nodeId] },
            ),
          );
        }
      }
      for (const ref of lesson.curriculumBinding.realizationRefs) {
        if (!node.realizationRefs.includes(ref)) {
          issues.push(
            validationIssue(
              "LESSON_REALIZATION_OUTSIDE_ROUTE_NODE",
              "curriculumBinding.realizationRefs",
              `Realization ${ref} is outside route node ${node.nodeId}.`,
              { relatedRefs: [ref, node.nodeId] },
            ),
          );
        }
      }
      const productionTargetIds = new Set(node.productionTargets.map((target) => target.productionTargetId));
      lesson.productiveTargets.productionTargetRefs.forEach((ref, index) => {
        if (!productionTargetIds.has(ref)) {
          issues.push(
            validationIssue(
              "BROKEN_PRODUCTION_TARGET_REFERENCE",
              `productiveTargets.productionTargetRefs.${index}`,
              `Production target ${ref} is absent from route node ${node.nodeId}.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
      if (
        supportRank[lesson.productiveTargets.supportCeiling] > supportRank[node.supportLevel]
      ) {
        issues.push(
          validationIssue(
            "LESSON_SUPPORT_EXCEEDS_ROUTE_NODE",
            "productiveTargets.supportCeiling",
            `Lesson support ceiling ${lesson.productiveTargets.supportCeiling} exceeds route node support ${node.supportLevel}.`,
          ),
        );
      }
      if (
        node.assessmentRole === "terminal_evidence" &&
        lesson.loadPolicy.newStructuralLoad > 0
      ) {
        issues.push(
          validationIssue(
            "TERMINAL_LESSON_INTRODUCES_NEW_STRUCTURE",
            "loadPolicy.newStructuralLoad",
            "Terminal evidence lessons cannot introduce new central structure.",
          ),
        );
      }
    }
  }

  return validationResult(issues);
}
