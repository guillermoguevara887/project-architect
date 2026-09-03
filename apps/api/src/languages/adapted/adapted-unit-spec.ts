import { z } from "zod";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
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
  languageDecisionRefKey,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import type { LanguageProfile } from "../profile/language-profile.js";

const idListSchema = z.array(domainIdSchema);
const textListSchema = z.array(requiredTextSchema);

export const productiveStatusSchema = z.enum([
  "recognition_only",
  "guided_productive",
  "productive",
]);
export type ProductiveStatus = z.infer<typeof productiveStatusSchema>;

export const instructionalDepthSchema = z.enum([
  "awareness",
  "recognition",
  "controlled_production",
  "guided_production",
  "productive",
  "integration",
]);

export const loadDegreeSchema = z.enum(["none", "light", "moderate", "heavy"]);

const supportPolicySchema = z
  .object({
    initialSupport: supportLevelSchema,
    withdrawalCondition: requiredTextSchema,
    terminalSupportCeiling: supportLevelSchema,
  })
  .strict();

const capabilityRealizationSchema = z
  .object({
    capabilityRef: domainIdSchema,
    status: z.enum([
      "fully_realized",
      "partially_realized",
      "deferred",
      "not_applicable",
    ]),
    inputExpectation: requiredTextSchema,
    outputExpectation: z.string(),
    masteryExpectation: z.string(),
    realizationRefs: idListSchema,
    supportPolicy: supportPolicySchema,
    tolerance: z
      .object({
        acceptedVariation: textListSchema,
        blockingErrors: textListSchema,
        nonBlockingErrors: textListSchema,
      })
      .strict(),
    deferredScope: idListSchema,
  })
  .strict();

const languageRealizationSchema = z
  .object({
    realizationId: domainIdSchema,
    semanticTarget: requiredTextSchema,
    decisionRefs: z.array(versionedRefSchema).min(1),
    selectedMechanisms: idListSchema,
    recognitionRange: idListSchema,
    productiveCore: idListSchema,
    alternatives: idListSchema,
    contextConditions: textListSchema,
    constraints: textListSchema,
    commonRisks: textListSchema,
    deferredScope: idListSchema,
  })
  .strict();

const linguisticPatternSchema = z
  .object({
    patternId: domainIdSchema,
    functionRefs: idListSchema,
    realizationRefs: idListSchema.min(1),
    productiveStatus: productiveStatusSchema,
    frequencyPriority: z.enum(["high", "medium", "low"]),
    constraints: textListSchema,
  })
  .strict();

const lexicalFunctionSchema = z
  .object({
    lexicalFunctionId: domainIdSchema,
    semanticDomainRef: domainIdSchema,
    role: z.enum(["core", "supporting", "recycled"]),
    targetSize: z.number().int().nonnegative().optional(),
    constraints: textListSchema,
  })
  .strict();

const targetSchema = z
  .object({
    targetId: domainIdSchema,
    realizationRefs: idListSchema,
    description: requiredTextSchema,
    productiveStatus: productiveStatusSchema,
    constraints: textListSchema,
  })
  .strict();

const adaptedLearningStepSchema = z
  .object({
    adaptedStepId: domainIdSchema,
    sourceStepRefs: idListSchema,
    adaptationType: z.enum([
      "preserved",
      "merged",
      "split",
      "inserted",
      "reordered",
      "downgraded",
      "upgraded",
    ]),
    mission: requiredTextSchema,
    capabilityRefs: idListSchema.min(1),
    realizationRefs: idListSchema,
    supportLevel: supportLevelSchema,
    instructionalDepth: instructionalDepthSchema,
    newLoad: z
      .object({
        structural: loadDegreeSchema,
        lexical: loadDegreeSchema,
        phonological: loadDegreeSchema,
        literacy: loadDegreeSchema,
        discourse: loadDegreeSchema,
      })
      .strict(),
    recycledLoad: z
      .object({
        capabilityRefs: idListSchema,
        realizationRefs: idListSchema,
      })
      .strict(),
    assessmentRole: z.enum([
      "none",
      "practice_evidence",
      "checkpoint",
      "terminal_evidence",
    ]),
    adaptationReason: requiredTextSchema,
  })
  .strict();

const instructionPolicySchema = z
  .object({
    supportProgression: requiredTextSchema,
    inputOutputPolicy: requiredTextSchema,
    grammarDepthPolicy: requiredTextSchema,
    lexicalLoadPolicy: requiredTextSchema,
    correctionPriority: z.array(
      z.enum([
        "communicative_success",
        "comprehensibility",
        "appropriateness",
        "target_form_control",
        "secondary_accuracy",
      ]),
    ).min(1),
    errorTolerance: requiredTextSchema,
  })
  .strict();

const areaPolicySchema = z
  .object({
    targetRefs: idListSchema,
    policy: requiredTextSchema,
    supportPolicy: requiredTextSchema,
  })
  .strict();

const assessmentContractSchema = z
  .object({
    inheritedCriterionRefs: idListSchema,
    masteryRule: requiredTextSchema,
    linguisticEvidenceRequirements: textListSchema,
    allowedVariation: textListSchema,
    supportCeilings: z.array(
      z
        .object({
          capabilityRef: domainIdSchema,
          supportCeiling: supportLevelSchema,
        })
        .strict(),
    ),
    blockingErrors: textListSchema,
    nonBlockingErrors: textListSchema,
  })
  .strict();

const auditSchema = z
  .object({
    status: z.enum(["not_run", "pass", "fail"]),
    findings: textListSchema,
  })
  .strict();

export const adaptedUnitSpecSchema = z
  .object({
    identity: z
      .object({
        adaptedUnitId: domainIdSchema,
        curriculumId: domainIdSchema,
        unitId: domainIdSchema,
        levelId: domainIdSchema,
        languageId: domainIdSchema,
        varietyId: domainIdSchema,
        title: requiredTextSchema,
      })
      .strict(),
    sourceBinding: z
      .object({
        curriculumUnitSpecRef: versionedRefSchema,
        languageProfileRef: versionedRefSchema,
        registryRef: versionedRefSchema,
        adaptationPlanRef: versionedRefSchema,
      })
      .strict(),
    reuseBinding: z
      .object({
        inheritedRealizationRefs: idListSchema,
        extendedRealizationRefs: idListSchema,
      })
      .strict(),
    capabilityRealizations: z.array(capabilityRealizationSchema).min(1),
    languageRealizations: z.array(languageRealizationSchema).min(1),
    linguisticTargets: z
      .object({
        patterns: z.array(linguisticPatternSchema),
        lexicalFunctions: z.array(lexicalFunctionSchema),
        pronunciationTargets: z.array(targetSchema),
        literacyTargets: z.array(targetSchema),
        discourseTargets: z.array(targetSchema),
      })
      .strict(),
    adaptedLearningRoute: z.array(adaptedLearningStepSchema).min(1),
    instructionPolicy: instructionPolicySchema,
    pronunciationPolicy: areaPolicySchema,
    literacyPolicy: areaPolicySchema,
    localizationPolicy: z
      .object({
        varietyScope: requiredTextSchema,
        scenarioPolicy: requiredTextSchema,
        namingPolicy: requiredTextSchema,
        culturalConstraints: textListSchema,
      })
      .strict(),
    assessmentContract: assessmentContractSchema,
    validation: z
      .object({
        coverageAudit: auditSchema,
        projectionAudit: auditSchema,
        decisionTraceAudit: auditSchema,
        productiveCoreAudit: auditSchema,
        deferredScopeAudit: auditSchema,
        assessmentAlignmentAudit: auditSchema,
        levelAudit: auditSchema,
        consistencyAudit: auditSchema,
      })
      .strict(),
    provenance: z
      .object({
        decisionRefs: z.array(versionedRefSchema),
        notes: textListSchema,
      })
      .strict(),
    version: semanticVersionSchema,
    status: z.enum(["draft", "review", "canonical", "deprecated"]),
  })
  .strict();

export type AdaptedUnitSpec = z.infer<typeof adaptedUnitSpecSchema>;

export type AdaptedUnitValidationContext = {
  curriculum?: CurriculumUnitSpec;
  languageProfile?: LanguageProfile;
  registry?: LanguageDecisionRegistry;
  adaptationPlan?: AdaptationPlan;
};

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

function sameVersionedRef(
  left: { id: string; version: string },
  right: { id: string; version: string },
) {
  return left.id === right.id && left.version === right.version;
}

export function validateAdaptedUnitSpec(
  input: unknown,
  context: AdaptedUnitValidationContext = {},
): ValidationResult {
  const parsed = adaptedUnitSpecSchema.safeParse(input);
  if (!parsed.success) return validationResult(zodIssuesToValidationIssues(parsed.error));

  const unit = parsed.data;
  const issues: ValidationIssue[] = [];

  pushDuplicateIds(
    issues,
    unit.capabilityRealizations.map((entry, index) => ({
      id: entry.capabilityRef,
      path: `capabilityRealizations.${index}.capabilityRef`,
    })),
    "capability realization",
  );
  pushDuplicateIds(
    issues,
    unit.languageRealizations.map((entry, index) => ({
      id: entry.realizationId,
      path: `languageRealizations.${index}.realizationId`,
    })),
    "language realization",
  );
  pushDuplicateIds(
    issues,
    unit.adaptedLearningRoute.map((entry, index) => ({
      id: entry.adaptedStepId,
      path: `adaptedLearningRoute.${index}.adaptedStepId`,
    })),
    "adapted step",
  );
  pushDuplicateIds(
    issues,
    unit.linguisticTargets.patterns.map((entry, index) => ({
      id: entry.patternId,
      path: `linguisticTargets.patterns.${index}.patternId`,
    })),
    "pattern",
  );

  const capabilityByRef = new Map(
    unit.capabilityRealizations.map((entry) => [entry.capabilityRef, entry] as const),
  );
  const realizationByRef = new Map(
    unit.languageRealizations.map((entry) => [entry.realizationId, entry] as const),
  );

  unit.languageRealizations.forEach((realization, index) => {
    const recognition = new Set(realization.recognitionRange);
    const productive = new Set(realization.productiveCore);
    for (const item of productive) {
      if (!recognition.has(item)) {
        issues.push(
          validationIssue(
            "PRODUCTIVE_CORE_EXCEEDS_RECOGNITION_RANGE",
            `languageRealizations.${index}.productiveCore`,
            `Productive item ${item} is not authorized for recognition.`,
            { relatedRefs: [item] },
          ),
        );
      }
    }
    for (const item of realization.deferredScope) {
      if (productive.has(item)) {
        issues.push(
          validationIssue(
            "DEFERRED_SCOPE_IS_PRODUCTIVE",
            `languageRealizations.${index}.deferredScope`,
            `Deferred item ${item} cannot belong to productiveCore.`,
            { relatedRefs: [item] },
          ),
        );
      }
    }
  });

  unit.capabilityRealizations.forEach((capability, index) => {
    capability.realizationRefs.forEach((ref, refIndex) => {
      if (!realizationByRef.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_REALIZATION_REFERENCE",
            `capabilityRealizations.${index}.realizationRefs.${refIndex}`,
            `Unknown language realization ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });

    const productiveState =
      capability.status === "fully_realized" || capability.status === "partially_realized";
    if (productiveState && capability.outputExpectation.trim().length === 0) {
      issues.push(
        validationIssue(
          "CAPABILITY_OUTPUT_EXPECTATION_REQUIRED",
          `capabilityRealizations.${index}.outputExpectation`,
          `${capability.status} capabilities require a productive output expectation.`,
          { relatedRefs: [capability.capabilityRef] },
        ),
      );
    }
    if (productiveState && capability.masteryExpectation.trim().length === 0) {
      issues.push(
        validationIssue(
          "CAPABILITY_MASTERY_EXPECTATION_REQUIRED",
          `capabilityRealizations.${index}.masteryExpectation`,
          `${capability.status} capabilities require a mastery expectation.`,
          { relatedRefs: [capability.capabilityRef] },
        ),
      );
    }
    if (capability.status === "deferred" && capability.outputExpectation.trim().length > 0) {
      issues.push(
        validationIssue(
          "DEFERRED_CAPABILITY_HAS_OUTPUT_EXPECTATION",
          `capabilityRealizations.${index}.outputExpectation`,
          "Deferred capabilities cannot carry a productive output expectation.",
          { relatedRefs: [capability.capabilityRef] },
        ),
      );
    }
    if (
      capability.status === "not_applicable" &&
      capability.outputExpectation.trim().length > 0
    ) {
      issues.push(
        validationIssue(
          "NOT_APPLICABLE_CAPABILITY_HAS_OUTPUT_EXPECTATION",
          `capabilityRealizations.${index}.outputExpectation`,
          "Not-applicable capabilities cannot carry a productive output expectation.",
          { relatedRefs: [capability.capabilityRef] },
        ),
      );
    }
  });

  unit.linguisticTargets.patterns.forEach((pattern, index) => {
    pattern.realizationRefs.forEach((ref, refIndex) => {
      if (!realizationByRef.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_REALIZATION_REFERENCE",
            `linguisticTargets.patterns.${index}.realizationRefs.${refIndex}`,
            `Pattern references unknown realization ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
  });

  unit.adaptedLearningRoute.forEach((step, index) => {
    step.capabilityRefs.forEach((ref, refIndex) => {
      if (!capabilityByRef.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_CAPABILITY_REFERENCE",
            `adaptedLearningRoute.${index}.capabilityRefs.${refIndex}`,
            `Adapted step references unknown capability ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
    step.realizationRefs.forEach((ref, refIndex) => {
      if (!realizationByRef.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_REALIZATION_REFERENCE",
            `adaptedLearningRoute.${index}.realizationRefs.${refIndex}`,
            `Adapted step references unknown realization ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
    if (step.adaptationType === "inserted" && step.sourceStepRefs.length > 0) {
      issues.push(
        validationIssue(
          "INSERTED_STEP_HAS_SOURCE_STEP",
          `adaptedLearningRoute.${index}.sourceStepRefs`,
          "Inserted steps cannot masquerade as source steps.",
        ),
      );
    }
  });

  if (context.curriculum) {
    const curriculum = context.curriculum;
    if (
      !sameVersionedRef(unit.sourceBinding.curriculumUnitSpecRef, {
        id: curriculum.identity.unitId,
        version: curriculum.specVersion,
      })
    ) {
      issues.push(
        validationIssue(
          "CURRICULUM_SOURCE_REF_MISMATCH",
          "sourceBinding.curriculumUnitSpecRef",
          "AdaptedUnitSpec is not pinned to the supplied CurriculumUnitSpec version.",
        ),
      );
    }
    const terminal = new Set(curriculum.scope.capabilityFlow.terminal);
    for (const ref of terminal) {
      const realization = capabilityByRef.get(ref);
      if (!realization || realization.status !== "fully_realized") {
        issues.push(
          validationIssue(
            "TERMINAL_CAPABILITY_NOT_FULLY_REALIZED",
            "capabilityRealizations",
            `Terminal capability ${ref} must be fully realized.`,
            { relatedRefs: [ref] },
          ),
        );
      }
      const appearsInRoute = unit.adaptedLearningRoute.some((step) =>
        step.capabilityRefs.includes(ref),
      );
      if (!appearsInRoute) {
        issues.push(
          validationIssue(
            "TERMINAL_CAPABILITY_MISSING_FROM_ROUTE",
            "adaptedLearningRoute",
            `Terminal capability ${ref} is not represented in the adapted route.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    }
    const stepIds = new Set(curriculum.learningRoute.steps.map((step) => step.stepId));
    unit.adaptedLearningRoute.forEach((step, index) => {
      step.sourceStepRefs.forEach((ref, refIndex) => {
        if (!stepIds.has(ref)) {
          issues.push(
            validationIssue(
              "BROKEN_SOURCE_STEP_REFERENCE",
              `adaptedLearningRoute.${index}.sourceStepRefs.${refIndex}`,
              `Adapted step references unknown curriculum step ${ref}.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
    });
    const criterionIds = new Set(
      curriculum.assessmentContract.criteria.map((criterion) => criterion.criterionId),
    );
    unit.assessmentContract.inheritedCriterionRefs.forEach((ref, index) => {
      if (!criterionIds.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_ASSESSMENT_CRITERION_REFERENCE",
            `assessmentContract.inheritedCriterionRefs.${index}`,
            `Unknown inherited assessment criterion ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
  }

  if (context.languageProfile) {
    const profile = context.languageProfile;
    if (
      !sameVersionedRef(unit.sourceBinding.languageProfileRef, {
        id: profile.identity.profileId,
        version: profile.version,
      }) ||
      unit.identity.languageId !== profile.identity.languageId ||
      unit.identity.varietyId !== profile.identity.varietyId
    ) {
      issues.push(
        validationIssue(
          "LANGUAGE_PROFILE_SOURCE_REF_MISMATCH",
          "sourceBinding.languageProfileRef",
          "AdaptedUnitSpec language binding does not match the supplied LanguageProfile.",
        ),
      );
    }
  }

  if (context.registry) {
    const registry = context.registry;
    if (
      !sameVersionedRef(unit.sourceBinding.registryRef, {
        id: registry.identity.registryId,
        version: registry.version,
      })
    ) {
      issues.push(
        validationIssue(
          "REGISTRY_SOURCE_REF_MISMATCH",
          "sourceBinding.registryRef",
          "AdaptedUnitSpec registry binding does not match the supplied registry.",
        ),
      );
    }
    const decisions = new Map(
      registry.decisions.map((decision) => [
        languageDecisionRefKey({
          id: decision.identity.decisionId,
          version: decision.identity.decisionVersion,
        }),
        decision,
      ] as const),
    );
    unit.languageRealizations.forEach((realization, realizationIndex) => {
      realization.decisionRefs.forEach((ref, refIndex) => {
        const decision = decisions.get(languageDecisionRefKey(ref));
        if (!decision) {
          issues.push(
            validationIssue(
              "BROKEN_DECISION_REFERENCE",
              `languageRealizations.${realizationIndex}.decisionRefs.${refIndex}`,
              `Unknown language decision ${languageDecisionRefKey(ref)}.`,
              { relatedRefs: [languageDecisionRefKey(ref)] },
            ),
          );
        } else if (!["validated", "provisional"].includes(decision.identity.status)) {
          issues.push(
            validationIssue(
              "INCOMPATIBLE_DECISION_STATUS",
              `languageRealizations.${realizationIndex}.decisionRefs.${refIndex}`,
              `Decision ${languageDecisionRefKey(ref)} has unusable status ${decision.identity.status}.`,
            ),
          );
        }
      });
    });
  }

  if (context.adaptationPlan) {
    const plan = context.adaptationPlan;
    if (
      !sameVersionedRef(unit.sourceBinding.adaptationPlanRef, {
        id: plan.identity.adaptationPlanId,
        version: plan.version,
      })
    ) {
      issues.push(
        validationIssue(
          "ADAPTATION_PLAN_SOURCE_REF_MISMATCH",
          "sourceBinding.adaptationPlanRef",
          "AdaptedUnitSpec is not pinned to the supplied AdaptationPlan.",
        ),
      );
    }
    if (
      plan.gapAnalysis.length > 0 ||
      !["ready", "ready_with_provisional_decisions"].includes(plan.readiness.state) ||
      plan.status !== "ready"
    ) {
      issues.push(
        validationIssue(
          "UPSTREAM_ADAPTATION_NOT_READY",
          "sourceBinding.adaptationPlanRef",
          "AdaptedUnitSpec cannot be finalized while the AdaptationPlan still has open gaps or is not ready.",
        ),
      );
    }
  }

  return validationResult(issues);
}
