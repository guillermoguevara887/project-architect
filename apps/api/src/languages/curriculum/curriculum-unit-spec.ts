import { z } from "zod";
import { findDirectedCycle } from "./graph.js";
import {
  criticalitySchema,
  domainIdSchema,
  modalitySchema,
  requiredTextSchema,
  semanticVersionSchema,
  supportLevelSchema,
} from "./primitives.js";
import {
  validationIssue,
  validationResult,
  zodIssuesToValidationIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

const uniqueArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).superRefine((values, context) => {
    const seen = new Set<unknown>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate value",
          path: [index],
        });
      }
      seen.add(value);
    });
  });

const learningModeSchema = z.enum([
  "acquisition",
  "expansion",
  "integration",
  "consolidation",
]);

const curriculumStatusSchema = z.enum([
  "draft",
  "review",
  "canonical",
  "deprecated",
]);

const privacyPolicySchema = z.enum([
  "not_relevant",
  "real_or_fictitious",
  "fictitious_preferred",
  "real_never_required",
]);

const expectedDepthSchema = z.enum([
  "awareness",
  "guided_use",
  "independent_use",
]);

const scaleMetricSchema = z.enum([
  "words",
  "characters",
  "utterances",
  "turns",
  "clauses",
  "semantic_units",
  "task_completion",
]);

const scalePolicySchema = z
  .object({
    metric: scaleMetricSchema,
    min: z.number().nonnegative().optional(),
    target: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
    equivalenceAllowed: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.min !== undefined && value.target !== undefined && value.min > value.target) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["min"],
        message: "min cannot exceed target",
      });
    }
    if (value.target !== undefined && value.max !== undefined && value.target > value.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "target cannot exceed max",
      });
    }
    if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["min"],
        message: "min cannot exceed max",
      });
    }
  });

const capabilityProfileSchema = z
  .object({
    description: requiredTextSchema,
    capabilityRefs: uniqueArray(domainIdSchema),
  })
  .strict();

const capabilityFlowSchema = z
  .object({
    required: uniqueArray(domainIdSchema),
    recycled: uniqueArray(domainIdSchema),
    expanded: uniqueArray(domainIdSchema),
    introduced: uniqueArray(domainIdSchema),
    integrated: uniqueArray(domainIdSchema),
    terminal: uniqueArray(domainIdSchema).min(1),
  })
  .strict();

const competencySchema = z
  .object({
    competencyId: domainIdSchema,
    label: requiredTextSchema,
    intent: requiredTextSchema,
    observableBehaviors: z.array(requiredTextSchema).min(1),
    modalities: uniqueArray(modalitySchema).min(1),
    criticality: criticalitySchema,
    masteryEvidenceRefs: uniqueArray(domainIdSchema),
    privacyPolicy: privacyPolicySchema.optional(),
  })
  .strict();

const semanticItemSchema = z
  .object({
    id: domainIdSchema,
    label: requiredTextSchema,
    description: requiredTextSchema.optional(),
  })
  .strict();

const learningStrategySchema = z
  .object({
    strategyId: domainIdSchema,
    label: requiredTextSchema,
    expectedDepth: expectedDepthSchema,
  })
  .strict();

const targetArtifactSchema = z
  .object({
    artifactId: domainIdSchema,
    artifactType: domainIdSchema,
    purpose: requiredTextSchema,
    audience: requiredTextSchema,
    communicativeContext: requiredTextSchema,
    completionCondition: requiredTextSchema,
    requiredFunctionRefs: uniqueArray(domainIdSchema),
    scalePolicy: scalePolicySchema,
    required: z.boolean(),
  })
  .strict();

const adaptationDecisionScopeSchema = z.enum([
  "language_global",
  "level_global",
  "unit_contextual",
  "task_contextual",
]);

const adaptationRequirementDependencySchema = z
  .object({
    requirementRef: domainIdSchema,
    relation: z.enum(["hard", "soft"]),
  })
  .strict();

const adaptationRequirementSchema = z
  .object({
    requirementId: domainIdSchema,
    domain: domainIdSchema,
    semanticProblem: requiredTextSchema,
    decisionScope: adaptationDecisionScopeSchema,
    resolutionQuestion: requiredTextSchema,
    expectedResolution: requiredTextSchema,
    dependsOn: z.array(adaptationRequirementDependencySchema),
    affectedCapabilityRefs: uniqueArray(domainIdSchema),
    affectedStepRefs: uniqueArray(domainIdSchema),
  })
  .strict();

const learningStepDependencySchema = z
  .object({
    stepRef: domainIdSchema,
    relation: z.enum([
      "requires",
      "recommended_after",
      "reinforces",
      "prepares_for",
    ]),
  })
  .strict();

const expansionTriggerSchema = z.enum([
  "new_writing_system",
  "lexical_tone",
  "complex_nominal_marking",
  "social_register_complexity",
  "classifier_dependency",
  "reference_complexity",
]);

const mergePolicySchema = z
  .object({
    mergeable: z.boolean(),
    candidateStepRefs: uniqueArray(domainIdSchema),
    conditions: z.array(requiredTextSchema),
  })
  .strict();

const learningStepSchema = z
  .object({
    stepId: domainIdSchema,
    orderHint: z.number().int().positive(),
    mission: requiredTextSchema,
    observableOutcome: requiredTextSchema,
    capabilityRefs: uniqueArray(domainIdSchema).min(1),
    functionRefs: uniqueArray(domainIdSchema),
    adaptationRequirementRefs: uniqueArray(domainIdSchema),
    dependencies: z.array(learningStepDependencySchema),
    supportLevel: supportLevelSchema,
    required: z.boolean(),
    mergePolicy: mergePolicySchema,
    expansionTriggers: uniqueArray(expansionTriggerSchema),
    outOfScope: z.array(requiredTextSchema),
  })
  .strict();

const granularityProfileSchema = z
  .object({
    minSessions: z.number().int().positive(),
    targetSessions: z.number().int().positive(),
    maxSessions: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minSessions > value.targetSessions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minSessions"],
        message: "minSessions cannot exceed targetSessions",
      });
    }
    if (value.targetSessions > value.maxSessions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetSessions"],
        message: "targetSessions cannot exceed maxSessions",
      });
    }
  });

const routeTransformationSchema = z.enum([
  "preserve",
  "merge",
  "split",
  "insert",
  "reorder",
  "downgrade",
  "upgrade",
]);

const generationPolicySchema = z
  .object({
    structuralLoadPolicy: z
      .object({
        maxCentralNewLoadsPerLesson: z.number().int().positive(),
        notes: requiredTextSchema.optional(),
      })
      .strict(),
    lexicalLoadPolicy: z
      .object({
        preferredNewCoreMin: z.number().int().nonnegative(),
        preferredNewCoreMax: z.number().int().positive(),
        hardMaximum: z.number().int().positive(),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.preferredNewCoreMin > value.preferredNewCoreMax) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["preferredNewCoreMin"],
            message: "preferredNewCoreMin cannot exceed preferredNewCoreMax",
          });
        }
        if (value.preferredNewCoreMax > value.hardMaximum) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["preferredNewCoreMax"],
            message: "preferredNewCoreMax cannot exceed hardMaximum",
          });
        }
      }),
    recyclingPolicy: z
      .object({
        progressionKnownContentMin: z.number().min(0).max(1),
        progressionKnownContentMax: z.number().min(0).max(1),
        finalIntegrationKnownContentMin: z.number().min(0).max(1),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.progressionKnownContentMin > value.progressionKnownContentMax) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["progressionKnownContentMin"],
            message: "progressionKnownContentMin cannot exceed progressionKnownContentMax",
          });
        }
      }),
    authenticityPolicy: z
      .object({
        preferNaturalUsage: z.boolean(),
        notes: requiredTextSchema.optional(),
      })
      .strict(),
    grammarPolicy: z
      .object({
        avoidFullParadigmByDefault: z.boolean(),
        preferHighFrequencySubset: z.boolean(),
        deferLowFrequencyExceptions: z.boolean(),
        functionBeforeDescription: z.boolean(),
      })
      .strict(),
    pronunciationPolicy: z
      .object({
        onlyRelevantTargets: z.boolean(),
        nativeLikeAccuracyRequired: z.boolean(),
      })
      .strict(),
    localizationPolicy: z
      .object({
        avoidSingleCountryAssumption: z.boolean(),
        notes: requiredTextSchema.optional(),
      })
      .strict(),
    privacyPolicy: z
      .object({
        realPersonalDataRequired: z.literal(false),
        fictitiousDataAllowed: z.boolean(),
      })
      .strict(),
    antiProjectionPolicy: z
      .object({
        prohibitedAssumptions: uniqueArray(domainIdSchema).min(1),
      })
      .strict(),
  })
  .strict();

const assessmentCriterionSchema = z
  .object({
    criterionId: domainIdSchema,
    label: requiredTextSchema,
    capabilityRefs: uniqueArray(domainIdSchema).min(1),
    weight: z.number().positive(),
    critical: z.boolean(),
    observableSuccess: requiredTextSchema,
  })
  .strict();

const masteryRuleSchema = z
  .object({
    thresholdType: z.enum(["weighted_score", "all_required", "hybrid"]),
    minimumScore: z.number().nonnegative().optional(),
    criticalCriteriaMustPass: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.thresholdType === "weighted_score" || value.thresholdType === "hybrid") &&
      value.minimumScore === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumScore"],
        message: "minimumScore is required for weighted_score and hybrid rules",
      });
    }
  });

const performanceConditionsSchema = z
  .object({
    supportCeiling: supportLevelSchema,
    contextFamiliarity: z.enum(["rehearsed", "similar", "novel_but_bounded"]),
    resourcePolicy: requiredTextSchema,
  })
  .strict();

const evidenceSpecSchema = z
  .object({
    evidenceId: domainIdSchema,
    modality: modalitySchema,
    artifactRef: domainIdSchema.optional(),
    capabilityRefs: uniqueArray(domainIdSchema).min(1),
    required: z.boolean(),
    scale: scalePolicySchema.optional(),
    performanceConditions: performanceConditionsSchema,
  })
  .strict();

const assessmentPrioritySchema = z.tuple([
  z.literal("communicative_success"),
  z.literal("comprehensibility"),
  z.literal("appropriateness"),
  z.literal("formal_accuracy"),
]);

const qualityGateSchema = z
  .object({
    gateId: domainIdSchema,
    category: domainIdSchema,
    severity: z.enum(["warning", "blocking"]),
    condition: requiredTextSchema,
    failureEffect: z.enum(["review_required", "adaptation_blocked"]),
  })
  .strict();

const provenanceSourceSchema = z
  .object({
    sourceId: domainIdSchema,
    role: z.enum(["primary", "supporting", "contrastive"]),
    reference: requiredTextSchema,
    title: requiredTextSchema.optional(),
  })
  .strict();

const provenanceMappingSchema = z
  .object({
    mappingId: domainIdSchema,
    sourceRefs: uniqueArray(domainIdSchema).min(1),
    targetRefs: uniqueArray(domainIdSchema).min(1),
    preservedIntent: requiredTextSchema,
    neutralizedAssumptions: z.array(requiredTextSchema),
    exclusionReason: requiredTextSchema.optional(),
  })
  .strict();

export const curriculumUnitSpecSchema = z
  .object({
    identity: z
      .object({
        curriculumId: domainIdSchema,
        levelId: domainIdSchema,
        unitId: domainIdSchema,
        unitOrder: z.number().int().positive(),
        neutralTitle: requiredTextSchema,
      })
      .strict(),
    scope: z
      .object({
        purpose: requiredTextSchema,
        learningModes: uniqueArray(learningModeSchema).min(1),
        entryProfile: capabilityProfileSchema,
        exitProfile: capabilityProfileSchema,
        capabilityFlow: capabilityFlowSchema,
        outOfScope: z.array(requiredTextSchema),
      })
      .strict(),
    competencies: z.array(competencySchema).min(1),
    curriculumCore: z
      .object({
        communicativeFunctions: z.array(semanticItemSchema).min(1),
        semanticConcepts: z.array(semanticItemSchema).min(1),
        lexicalDomains: z.array(semanticItemSchema),
        quantitativeDomains: z.array(semanticItemSchema),
        discourseFunctions: z.array(semanticItemSchema),
        learningStrategies: z.array(learningStrategySchema),
        targetArtifacts: z.array(targetArtifactSchema),
      })
      .strict(),
    adaptationRequirements: z.array(adaptationRequirementSchema),
    learningRoute: z
      .object({
        steps: z.array(learningStepSchema).min(1),
        terminalStepRefs: uniqueArray(domainIdSchema).min(1),
      })
      .strict(),
    granularityPolicy: z
      .object({
        compact: granularityProfileSchema,
        recommended: granularityProfileSchema,
        expanded: granularityProfileSchema,
        allowedRouteTransformations: uniqueArray(routeTransformationSchema).min(1),
      })
      .strict(),
    generationPolicy: generationPolicySchema,
    assessmentContract: z
      .object({
        criteria: z.array(assessmentCriterionSchema).min(1),
        masteryRule: masteryRuleSchema,
        evidenceSpecs: z.array(evidenceSpecSchema).min(1),
        priorityPolicy: assessmentPrioritySchema,
      })
      .strict(),
    qualityGates: z.array(qualityGateSchema).min(2),
    provenance: z
      .object({
        sources: z.array(provenanceSourceSchema).min(1),
        mappings: z.array(provenanceMappingSchema).min(1),
        transformationNotes: z.array(requiredTextSchema).optional(),
      })
      .strict(),
    specVersion: semanticVersionSchema,
    status: curriculumStatusSchema,
  })
  .strict();

export type CurriculumUnitSpec = z.infer<typeof curriculumUnitSpecSchema>;

function duplicateIssues(
  values: readonly { id: string; path: string }[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstPathById = new Map<string, string>();
  for (const value of values) {
    const firstPath = firstPathById.get(value.id);
    if (firstPath) {
      issues.push(
        validationIssue(
          "DUPLICATE_DOMAIN_ID",
          value.path,
          `Domain id ${value.id} is duplicated`,
          { relatedRefs: [value.id, firstPath] },
        ),
      );
    } else {
      firstPathById.set(value.id, value.path);
    }
  }
  return issues;
}

function brokenRefIssue(
  path: string,
  ref: string,
  targetKind: string,
): ValidationIssue {
  return validationIssue(
    "BROKEN_REFERENCE",
    path,
    `Reference ${ref} does not resolve to a ${targetKind}`,
    { relatedRefs: [ref] },
  );
}

function setIntersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

export function validateCurriculumUnitSpec(input: unknown): ValidationResult {
  const parsed = curriculumUnitSpecSchema.safeParse(input);
  if (!parsed.success) {
    return validationResult(zodIssuesToValidationIssues(parsed.error));
  }

  const spec = parsed.data;
  const issues: ValidationIssue[] = [];

  const competencyIds = new Set(spec.competencies.map((item) => item.competencyId));
  const requirementIds = new Set(
    spec.adaptationRequirements.map((item) => item.requirementId),
  );
  const stepIds = new Set(spec.learningRoute.steps.map((item) => item.stepId));
  const functionIds = new Set([
    ...spec.curriculumCore.communicativeFunctions.map((item) => item.id),
    ...spec.curriculumCore.discourseFunctions.map((item) => item.id),
  ]);
  const artifactIds = new Set(
    spec.curriculumCore.targetArtifacts.map((item) => item.artifactId),
  );
  const evidenceIds = new Set(
    spec.assessmentContract.evidenceSpecs.map((item) => item.evidenceId),
  );
  const sourceIds = new Set(spec.provenance.sources.map((item) => item.sourceId));

  issues.push(
    ...duplicateIssues([
      ...spec.competencies.map((item, index) => ({
        id: item.competencyId,
        path: `competencies.${index}.competencyId`,
      })),
      ...spec.adaptationRequirements.map((item, index) => ({
        id: item.requirementId,
        path: `adaptationRequirements.${index}.requirementId`,
      })),
      ...spec.learningRoute.steps.map((item, index) => ({
        id: item.stepId,
        path: `learningRoute.steps.${index}.stepId`,
      })),
      ...spec.curriculumCore.communicativeFunctions.map((item, index) => ({
        id: item.id,
        path: `curriculumCore.communicativeFunctions.${index}.id`,
      })),
      ...spec.curriculumCore.semanticConcepts.map((item, index) => ({
        id: item.id,
        path: `curriculumCore.semanticConcepts.${index}.id`,
      })),
      ...spec.curriculumCore.lexicalDomains.map((item, index) => ({
        id: item.id,
        path: `curriculumCore.lexicalDomains.${index}.id`,
      })),
      ...spec.curriculumCore.quantitativeDomains.map((item, index) => ({
        id: item.id,
        path: `curriculumCore.quantitativeDomains.${index}.id`,
      })),
      ...spec.curriculumCore.discourseFunctions.map((item, index) => ({
        id: item.id,
        path: `curriculumCore.discourseFunctions.${index}.id`,
      })),
      ...spec.curriculumCore.learningStrategies.map((item, index) => ({
        id: item.strategyId,
        path: `curriculumCore.learningStrategies.${index}.strategyId`,
      })),
      ...spec.curriculumCore.targetArtifacts.map((item, index) => ({
        id: item.artifactId,
        path: `curriculumCore.targetArtifacts.${index}.artifactId`,
      })),
      ...spec.assessmentContract.criteria.map((item, index) => ({
        id: item.criterionId,
        path: `assessmentContract.criteria.${index}.criterionId`,
      })),
      ...spec.assessmentContract.evidenceSpecs.map((item, index) => ({
        id: item.evidenceId,
        path: `assessmentContract.evidenceSpecs.${index}.evidenceId`,
      })),
      ...spec.qualityGates.map((item, index) => ({
        id: item.gateId,
        path: `qualityGates.${index}.gateId`,
      })),
      ...spec.provenance.sources.map((item, index) => ({
        id: item.sourceId,
        path: `provenance.sources.${index}.sourceId`,
      })),
      ...spec.provenance.mappings.map((item, index) => ({
        id: item.mappingId,
        path: `provenance.mappings.${index}.mappingId`,
      })),
    ]),
  );

  const flowGroups = [
    ["required", spec.scope.capabilityFlow.required],
    ["recycled", spec.scope.capabilityFlow.recycled],
    ["expanded", spec.scope.capabilityFlow.expanded],
    ["introduced", spec.scope.capabilityFlow.introduced],
    ["integrated", spec.scope.capabilityFlow.integrated],
    ["terminal", spec.scope.capabilityFlow.terminal],
  ] as const;

  for (const [groupName, refs] of flowGroups) {
    refs.forEach((ref, index) => {
      if (!competencyIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `scope.capabilityFlow.${groupName}.${index}`,
            ref,
            "competency",
          ),
        );
      }
    });
  }

  spec.scope.entryProfile.capabilityRefs.forEach((ref, index) => {
    if (!competencyIds.has(ref)) {
      issues.push(
        brokenRefIssue(`scope.entryProfile.capabilityRefs.${index}`, ref, "competency"),
      );
    }
  });
  spec.scope.exitProfile.capabilityRefs.forEach((ref, index) => {
    if (!competencyIds.has(ref)) {
      issues.push(
        brokenRefIssue(`scope.exitProfile.capabilityRefs.${index}`, ref, "competency"),
      );
    }
  });

  const introducedRequiredConflict = setIntersection(
    spec.scope.capabilityFlow.introduced,
    spec.scope.capabilityFlow.required,
  );
  const introducedExpandedConflict = setIntersection(
    spec.scope.capabilityFlow.introduced,
    spec.scope.capabilityFlow.expanded,
  );
  for (const ref of [...introducedRequiredConflict, ...introducedExpandedConflict]) {
    issues.push(
      validationIssue(
        "CAPABILITY_FLOW_CONFLICT",
        "scope.capabilityFlow",
        `Capability ${ref} has incompatible flow classifications`,
        { relatedRefs: [ref] },
      ),
    );
  }

  const terminalSet = new Set(spec.scope.capabilityFlow.terminal);
  const exitSet = new Set(spec.scope.exitProfile.capabilityRefs);
  for (const ref of terminalSet) {
    if (!exitSet.has(ref)) {
      issues.push(
        validationIssue(
          "TERMINAL_CAPABILITY_MISSING_FROM_EXIT_PROFILE",
          "scope.exitProfile.capabilityRefs",
          `Terminal capability ${ref} is missing from the exit profile`,
          { relatedRefs: [ref] },
        ),
      );
    }
  }

  spec.competencies.forEach((competency, competencyIndex) => {
    competency.masteryEvidenceRefs.forEach((ref, refIndex) => {
      if (!evidenceIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `competencies.${competencyIndex}.masteryEvidenceRefs.${refIndex}`,
            ref,
            "evidence specification",
          ),
        );
      }
    });

    if (terminalSet.has(competency.competencyId) && competency.masteryEvidenceRefs.length === 0) {
      issues.push(
        validationIssue(
          "TERMINAL_CAPABILITY_WITHOUT_MASTERY_EVIDENCE",
          `competencies.${competencyIndex}.masteryEvidenceRefs`,
          `Terminal capability ${competency.competencyId} has no mastery evidence`,
          { relatedRefs: [competency.competencyId] },
        ),
      );
    }
  });

  spec.adaptationRequirements.forEach((requirement, requirementIndex) => {
    requirement.dependsOn.forEach((dependency, dependencyIndex) => {
      if (!requirementIds.has(dependency.requirementRef)) {
        issues.push(
          brokenRefIssue(
            `adaptationRequirements.${requirementIndex}.dependsOn.${dependencyIndex}.requirementRef`,
            dependency.requirementRef,
            "adaptation requirement",
          ),
        );
      }
    });
    requirement.affectedCapabilityRefs.forEach((ref, refIndex) => {
      if (!competencyIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `adaptationRequirements.${requirementIndex}.affectedCapabilityRefs.${refIndex}`,
            ref,
            "competency",
          ),
        );
      }
    });
    requirement.affectedStepRefs.forEach((ref, refIndex) => {
      if (!stepIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `adaptationRequirements.${requirementIndex}.affectedStepRefs.${refIndex}`,
            ref,
            "learning step",
          ),
        );
      }
    });
  });

  spec.learningRoute.steps.forEach((step, stepIndex) => {
    step.capabilityRefs.forEach((ref, refIndex) => {
      if (!competencyIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `learningRoute.steps.${stepIndex}.capabilityRefs.${refIndex}`,
            ref,
            "competency",
          ),
        );
      }
    });
    step.functionRefs.forEach((ref, refIndex) => {
      if (!functionIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `learningRoute.steps.${stepIndex}.functionRefs.${refIndex}`,
            ref,
            "curriculum function",
          ),
        );
      }
    });
    step.adaptationRequirementRefs.forEach((ref, refIndex) => {
      if (!requirementIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `learningRoute.steps.${stepIndex}.adaptationRequirementRefs.${refIndex}`,
            ref,
            "adaptation requirement",
          ),
        );
      }
    });
    step.dependencies.forEach((dependency, dependencyIndex) => {
      if (!stepIds.has(dependency.stepRef)) {
        issues.push(
          brokenRefIssue(
            `learningRoute.steps.${stepIndex}.dependencies.${dependencyIndex}.stepRef`,
            dependency.stepRef,
            "learning step",
          ),
        );
      }
    });
    step.mergePolicy.candidateStepRefs.forEach((ref, refIndex) => {
      if (!stepIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `learningRoute.steps.${stepIndex}.mergePolicy.candidateStepRefs.${refIndex}`,
            ref,
            "learning step",
          ),
        );
      }
    });
  });

  spec.learningRoute.terminalStepRefs.forEach((ref, index) => {
    if (!stepIds.has(ref)) {
      issues.push(
        brokenRefIssue(`learningRoute.terminalStepRefs.${index}`, ref, "learning step"),
      );
    }
  });

  spec.curriculumCore.targetArtifacts.forEach((artifact, artifactIndex) => {
    artifact.requiredFunctionRefs.forEach((ref, refIndex) => {
      if (!functionIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `curriculumCore.targetArtifacts.${artifactIndex}.requiredFunctionRefs.${refIndex}`,
            ref,
            "curriculum function",
          ),
        );
      }
    });
  });

  spec.assessmentContract.criteria.forEach((criterion, criterionIndex) => {
    criterion.capabilityRefs.forEach((ref, refIndex) => {
      if (!competencyIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `assessmentContract.criteria.${criterionIndex}.capabilityRefs.${refIndex}`,
            ref,
            "competency",
          ),
        );
      }
    });
  });

  spec.assessmentContract.evidenceSpecs.forEach((evidence, evidenceIndex) => {
    evidence.capabilityRefs.forEach((ref, refIndex) => {
      if (!competencyIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `assessmentContract.evidenceSpecs.${evidenceIndex}.capabilityRefs.${refIndex}`,
            ref,
            "competency",
          ),
        );
      }
    });
    if (evidence.artifactRef && !artifactIds.has(evidence.artifactRef)) {
      issues.push(
        brokenRefIssue(
          `assessmentContract.evidenceSpecs.${evidenceIndex}.artifactRef`,
          evidence.artifactRef,
          "target artifact",
        ),
      );
    }
  });

  const hardRequirementCycle = findDirectedCycle(
    [...requirementIds],
    spec.adaptationRequirements.flatMap((requirement) =>
      requirement.dependsOn
        .filter((dependency) => dependency.relation === "hard")
        .map((dependency) => ({
          from: requirement.requirementId,
          to: dependency.requirementRef,
        })),
    ),
  );
  if (hardRequirementCycle) {
    issues.push(
      validationIssue(
        "CYCLE_DETECTED",
        "adaptationRequirements",
        `Hard adaptation requirement dependency cycle detected: ${hardRequirementCycle.join(" -> ")}`,
        { relatedRefs: hardRequirementCycle },
      ),
    );
  }

  const hardStepCycle = findDirectedCycle(
    [...stepIds],
    spec.learningRoute.steps.flatMap((step) =>
      step.dependencies
        .filter((dependency) => dependency.relation === "requires")
        .map((dependency) => ({
          from: step.stepId,
          to: dependency.stepRef,
        })),
    ),
  );
  if (hardStepCycle) {
    issues.push(
      validationIssue(
        "CYCLE_DETECTED",
        "learningRoute.steps",
        `Required learning step dependency cycle detected: ${hardStepCycle.join(" -> ")}`,
        { relatedRefs: hardStepCycle },
      ),
    );
  }

  for (const terminalCapability of terminalSet) {
    const coveredByStep = spec.learningRoute.steps.some((step) =>
      step.capabilityRefs.includes(terminalCapability),
    );
    if (!coveredByStep) {
      issues.push(
        validationIssue(
          "TERMINAL_CAPABILITY_WITHOUT_ROUTE_COVERAGE",
          "learningRoute.steps",
          `Terminal capability ${terminalCapability} is not covered by any learning step`,
          { relatedRefs: [terminalCapability] },
        ),
      );
    }

    const coveredByEvidence = spec.assessmentContract.evidenceSpecs.some((evidence) =>
      evidence.capabilityRefs.includes(terminalCapability),
    );
    if (!coveredByEvidence) {
      issues.push(
        validationIssue(
          "TERMINAL_CAPABILITY_WITHOUT_ASSESSMENT_COVERAGE",
          "assessmentContract.evidenceSpecs",
          `Terminal capability ${terminalCapability} is not covered by assessment evidence`,
          { relatedRefs: [terminalCapability] },
        ),
      );
    }
  }

  const mandatoryGateCategories = ["curriculum_fidelity", "linguistic_projection"];
  for (const category of mandatoryGateCategories) {
    const gate = spec.qualityGates.find((candidate) => candidate.category === category);
    if (!gate || gate.severity !== "blocking" || gate.failureEffect !== "adaptation_blocked") {
      issues.push(
        validationIssue(
          "MISSING_BLOCKING_QUALITY_GATE",
          "qualityGates",
          `A blocking ${category} gate with adaptation_blocked failure effect is required`,
          { relatedRefs: [category] },
        ),
      );
    }
  }

  const targetIds = new Set<string>([
    spec.identity.unitId,
    ...competencyIds,
    ...requirementIds,
    ...stepIds,
    ...functionIds,
    ...artifactIds,
    ...evidenceIds,
    ...spec.assessmentContract.criteria.map((item) => item.criterionId),
  ]);
  spec.provenance.mappings.forEach((mapping, mappingIndex) => {
    mapping.sourceRefs.forEach((ref, refIndex) => {
      if (!sourceIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `provenance.mappings.${mappingIndex}.sourceRefs.${refIndex}`,
            ref,
            "provenance source",
          ),
        );
      }
    });
    mapping.targetRefs.forEach((ref, refIndex) => {
      if (!targetIds.has(ref)) {
        issues.push(
          brokenRefIssue(
            `provenance.mappings.${mappingIndex}.targetRefs.${refIndex}`,
            ref,
            "curriculum target",
          ),
        );
      }
    });
  });

  return validationResult(issues);
}
