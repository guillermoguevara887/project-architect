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
    capabilityRefs: idListSchema,
  })
  .strict();

const competencySchema = z
  .object({
    competencyId: domainIdSchema,
    label: requiredTextSchema,
    intent: requiredTextSchema,
    observableBehaviors: textListSchema.min(1),
    modalities: z.array(modalitySchema).min(1),
    criticality: criticalitySchema,
    masteryEvidenceRefs: idListSchema,
    privacyPolicy: z
      .enum([
        "not_relevant",
        "real_or_fictitious",
        "fictitious_preferred",
        "real_never_required",
      ])
      .optional(),
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
    expectedDepth: z.enum(["awareness", "guided_use", "independent_use"]),
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
    requiredFunctionRefs: idListSchema,
    scalePolicy: scalePolicySchema,
    required: z.boolean(),
  })
  .strict();

const adaptationRequirementSchema = z
  .object({
    requirementId: domainIdSchema,
    domain: domainIdSchema,
    semanticProblem: requiredTextSchema,
    decisionScope: z.enum([
      "language_global",
      "level_global",
      "unit_contextual",
      "task_contextual",
    ]),
    resolutionQuestion: requiredTextSchema,
    expectedResolution: requiredTextSchema,
    dependsOn: z.array(
      z
        .object({
          requirementRef: domainIdSchema,
          relation: z.enum(["hard", "soft"]),
        })
        .strict(),
    ),
    affectedCapabilityRefs: idListSchema,
    affectedStepRefs: idListSchema,
  })
  .strict();

const learningStepSchema = z
  .object({
    stepId: domainIdSchema,
    orderHint: z.number().int().positive(),
    mission: requiredTextSchema,
    observableOutcome: requiredTextSchema,
    capabilityRefs: idListSchema.min(1),
    functionRefs: idListSchema,
    adaptationRequirementRefs: idListSchema,
    dependencies: z.array(
      z
        .object({
          stepRef: domainIdSchema,
          relation: z.enum([
            "requires",
            "recommended_after",
            "reinforces",
            "prepares_for",
          ]),
        })
        .strict(),
    ),
    supportLevel: supportLevelSchema,
    required: z.boolean(),
    mergePolicy: z
      .object({
        mergeable: z.boolean(),
        candidateStepRefs: idListSchema,
        conditions: textListSchema,
      })
      .strict(),
    expansionTriggers: z.array(
      z.enum([
        "new_writing_system",
        "lexical_tone",
        "complex_nominal_marking",
        "social_register_complexity",
        "classifier_dependency",
        "reference_complexity",
      ]),
    ),
    outOfScope: textListSchema,
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
      .object({ prohibitedAssumptions: idListSchema.min(1) })
      .strict(),
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
    const scoreRequired =
      value.thresholdType === "weighted_score" || value.thresholdType === "hybrid";
    if (scoreRequired && value.minimumScore === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumScore"],
        message: "minimumScore is required for weighted_score and hybrid rules",
      });
    }
  });

const evidenceSpecSchema = z
  .object({
    evidenceId: domainIdSchema,
    modality: modalitySchema,
    artifactRef: domainIdSchema.optional(),
    capabilityRefs: idListSchema.min(1),
    required: z.boolean(),
    scale: scalePolicySchema.optional(),
    performanceConditions: z
      .object({
        supportCeiling: supportLevelSchema,
        contextFamiliarity: z.enum(["rehearsed", "similar", "novel_but_bounded"]),
        resourcePolicy: requiredTextSchema,
      })
      .strict(),
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
        learningModes: z
          .array(z.enum(["acquisition", "expansion", "integration", "consolidation"]))
          .min(1),
        entryProfile: capabilityProfileSchema,
        exitProfile: capabilityProfileSchema,
        capabilityFlow: z
          .object({
            required: idListSchema,
            recycled: idListSchema,
            expanded: idListSchema,
            introduced: idListSchema,
            integrated: idListSchema,
            terminal: idListSchema.min(1),
          })
          .strict(),
        outOfScope: textListSchema,
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
        terminalStepRefs: idListSchema.min(1),
      })
      .strict(),
    granularityPolicy: z
      .object({
        compact: granularityProfileSchema,
        recommended: granularityProfileSchema,
        expanded: granularityProfileSchema,
        allowedRouteTransformations: z
          .array(
            z.enum([
              "preserve",
              "merge",
              "split",
              "insert",
              "reorder",
              "downgrade",
              "upgrade",
            ]),
          )
          .min(1),
      })
      .strict(),
    generationPolicy: generationPolicySchema,
    assessmentContract: z
      .object({
        criteria: z
          .array(
            z
              .object({
                criterionId: domainIdSchema,
                label: requiredTextSchema,
                capabilityRefs: idListSchema.min(1),
                weight: z.number().positive(),
                critical: z.boolean(),
                observableSuccess: requiredTextSchema,
              })
              .strict(),
          )
          .min(1),
        masteryRule: masteryRuleSchema,
        evidenceSpecs: z.array(evidenceSpecSchema).min(1),
        priorityPolicy: z.tuple([
          z.literal("communicative_success"),
          z.literal("comprehensibility"),
          z.literal("appropriateness"),
          z.literal("formal_accuracy"),
        ]),
      })
      .strict(),
    qualityGates: z
      .array(
        z
          .object({
            gateId: domainIdSchema,
            category: domainIdSchema,
            severity: z.enum(["warning", "blocking"]),
            condition: requiredTextSchema,
            failureEffect: z.enum(["review_required", "adaptation_blocked"]),
          })
          .strict(),
      )
      .min(2),
    provenance: z
      .object({
        sources: z
          .array(
            z
              .object({
                sourceId: domainIdSchema,
                role: z.enum(["primary", "supporting", "contrastive"]),
                reference: requiredTextSchema,
                title: requiredTextSchema.optional(),
              })
              .strict(),
          )
          .min(1),
        mappings: z
          .array(
            z
              .object({
                mappingId: domainIdSchema,
                sourceRefs: idListSchema.min(1),
                targetRefs: idListSchema.min(1),
                preservedIntent: requiredTextSchema,
                neutralizedAssumptions: textListSchema,
                exclusionReason: requiredTextSchema.optional(),
              })
              .strict(),
          )
          .min(1),
        transformationNotes: textListSchema.optional(),
      })
      .strict(),
    specVersion: semanticVersionSchema,
    status: z.enum(["draft", "review", "canonical", "deprecated"]),
  })
  .strict();

export type CurriculumUnitSpec = z.infer<typeof curriculumUnitSpecSchema>;

function duplicateIssues(
  ids: readonly string[],
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      issues.push(
        validationIssue(
          "DUPLICATE_DOMAIN_ID",
          `${path}.${index}`,
          `Domain id ${id} is duplicated within ${path}`,
          { relatedRefs: [id] },
        ),
      );
    }
    seen.add(id);
  });
  return issues;
}

function brokenRefIssue(path: string, ref: string, targetKind: string): ValidationIssue {
  return validationIssue(
    "BROKEN_REFERENCE",
    path,
    `Reference ${ref} does not resolve to a ${targetKind}`,
    { relatedRefs: [ref] },
  );
}

function addBrokenRefs(
  issues: ValidationIssue[],
  refs: readonly string[],
  targets: ReadonlySet<string>,
  path: string,
  targetKind: string,
) {
  refs.forEach((ref, index) => {
    if (!targets.has(ref)) {
      issues.push(brokenRefIssue(`${path}.${index}`, ref, targetKind));
    }
  });
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

  const collections: Array<[string, string[]]> = [
    ["competencies", spec.competencies.map((item) => item.competencyId)],
    ["adaptationRequirements", spec.adaptationRequirements.map((item) => item.requirementId)],
    ["learningRoute.steps", spec.learningRoute.steps.map((item) => item.stepId)],
    [
      "curriculumCore.communicativeFunctions",
      spec.curriculumCore.communicativeFunctions.map((item) => item.id),
    ],
    [
      "curriculumCore.semanticConcepts",
      spec.curriculumCore.semanticConcepts.map((item) => item.id),
    ],
    ["curriculumCore.lexicalDomains", spec.curriculumCore.lexicalDomains.map((item) => item.id)],
    [
      "curriculumCore.quantitativeDomains",
      spec.curriculumCore.quantitativeDomains.map((item) => item.id),
    ],
    [
      "curriculumCore.discourseFunctions",
      spec.curriculumCore.discourseFunctions.map((item) => item.id),
    ],
    [
      "curriculumCore.learningStrategies",
      spec.curriculumCore.learningStrategies.map((item) => item.strategyId),
    ],
    [
      "curriculumCore.targetArtifacts",
      spec.curriculumCore.targetArtifacts.map((item) => item.artifactId),
    ],
    [
      "assessmentContract.criteria",
      spec.assessmentContract.criteria.map((item) => item.criterionId),
    ],
    [
      "assessmentContract.evidenceSpecs",
      spec.assessmentContract.evidenceSpecs.map((item) => item.evidenceId),
    ],
    ["qualityGates", spec.qualityGates.map((item) => item.gateId)],
    ["provenance.sources", spec.provenance.sources.map((item) => item.sourceId)],
    ["provenance.mappings", spec.provenance.mappings.map((item) => item.mappingId)],
  ];
  for (const [path, ids] of collections) {
    issues.push(...duplicateIssues(ids, path));
  }

  const flowGroups: Array<[string, string[]]> = [
    ["required", spec.scope.capabilityFlow.required],
    ["recycled", spec.scope.capabilityFlow.recycled],
    ["expanded", spec.scope.capabilityFlow.expanded],
    ["introduced", spec.scope.capabilityFlow.introduced],
    ["integrated", spec.scope.capabilityFlow.integrated],
    ["terminal", spec.scope.capabilityFlow.terminal],
  ];
  for (const [group, refs] of flowGroups) {
    addBrokenRefs(
      issues,
      refs,
      competencyIds,
      `scope.capabilityFlow.${group}`,
      "competency",
    );
  }
  addBrokenRefs(
    issues,
    spec.scope.entryProfile.capabilityRefs,
    competencyIds,
    "scope.entryProfile.capabilityRefs",
    "competency",
  );
  addBrokenRefs(
    issues,
    spec.scope.exitProfile.capabilityRefs,
    competencyIds,
    "scope.exitProfile.capabilityRefs",
    "competency",
  );

  const required = new Set(spec.scope.capabilityFlow.required);
  const expanded = new Set(spec.scope.capabilityFlow.expanded);
  for (const ref of spec.scope.capabilityFlow.introduced) {
    if (required.has(ref) || expanded.has(ref)) {
      issues.push(
        validationIssue(
          "CAPABILITY_FLOW_CONFLICT",
          "scope.capabilityFlow",
          `Capability ${ref} has incompatible flow classifications`,
          { relatedRefs: [ref] },
        ),
      );
    }
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

  spec.competencies.forEach((competency, index) => {
    addBrokenRefs(
      issues,
      competency.masteryEvidenceRefs,
      evidenceIds,
      `competencies.${index}.masteryEvidenceRefs`,
      "evidence specification",
    );
    if (terminalSet.has(competency.competencyId) && competency.masteryEvidenceRefs.length === 0) {
      issues.push(
        validationIssue(
          "TERMINAL_CAPABILITY_WITHOUT_MASTERY_EVIDENCE",
          `competencies.${index}.masteryEvidenceRefs`,
          `Terminal capability ${competency.competencyId} has no mastery evidence`,
          { relatedRefs: [competency.competencyId] },
        ),
      );
    }
  });

  spec.adaptationRequirements.forEach((requirement, index) => {
    addBrokenRefs(
      issues,
      requirement.dependsOn.map((dependency) => dependency.requirementRef),
      requirementIds,
      `adaptationRequirements.${index}.dependsOn`,
      "adaptation requirement",
    );
    addBrokenRefs(
      issues,
      requirement.affectedCapabilityRefs,
      competencyIds,
      `adaptationRequirements.${index}.affectedCapabilityRefs`,
      "competency",
    );
    addBrokenRefs(
      issues,
      requirement.affectedStepRefs,
      stepIds,
      `adaptationRequirements.${index}.affectedStepRefs`,
      "learning step",
    );
  });

  spec.learningRoute.steps.forEach((step, index) => {
    addBrokenRefs(
      issues,
      step.capabilityRefs,
      competencyIds,
      `learningRoute.steps.${index}.capabilityRefs`,
      "competency",
    );
    addBrokenRefs(
      issues,
      step.functionRefs,
      functionIds,
      `learningRoute.steps.${index}.functionRefs`,
      "curriculum function",
    );
    addBrokenRefs(
      issues,
      step.adaptationRequirementRefs,
      requirementIds,
      `learningRoute.steps.${index}.adaptationRequirementRefs`,
      "adaptation requirement",
    );
    addBrokenRefs(
      issues,
      step.dependencies.map((dependency) => dependency.stepRef),
      stepIds,
      `learningRoute.steps.${index}.dependencies`,
      "learning step",
    );
    addBrokenRefs(
      issues,
      step.mergePolicy.candidateStepRefs,
      stepIds,
      `learningRoute.steps.${index}.mergePolicy.candidateStepRefs`,
      "learning step",
    );
  });
  addBrokenRefs(
    issues,
    spec.learningRoute.terminalStepRefs,
    stepIds,
    "learningRoute.terminalStepRefs",
    "learning step",
  );

  spec.curriculumCore.targetArtifacts.forEach((artifact, index) => {
    addBrokenRefs(
      issues,
      artifact.requiredFunctionRefs,
      functionIds,
      `curriculumCore.targetArtifacts.${index}.requiredFunctionRefs`,
      "curriculum function",
    );
  });

  spec.assessmentContract.criteria.forEach((criterion, index) => {
    addBrokenRefs(
      issues,
      criterion.capabilityRefs,
      competencyIds,
      `assessmentContract.criteria.${index}.capabilityRefs`,
      "competency",
    );
  });
  spec.assessmentContract.evidenceSpecs.forEach((evidence, index) => {
    addBrokenRefs(
      issues,
      evidence.capabilityRefs,
      competencyIds,
      `assessmentContract.evidenceSpecs.${index}.capabilityRefs`,
      "competency",
    );
    if (evidence.artifactRef && !artifactIds.has(evidence.artifactRef)) {
      issues.push(
        brokenRefIssue(
          `assessmentContract.evidenceSpecs.${index}.artifactRef`,
          evidence.artifactRef,
          "target artifact",
        ),
      );
    }
  });

  const requirementCycle = findDirectedCycle(
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
  if (requirementCycle) {
    issues.push(
      validationIssue(
        "CYCLE_DETECTED",
        "adaptationRequirements",
        `Hard adaptation requirement dependency cycle detected: ${requirementCycle.join(" -> ")}`,
        { relatedRefs: requirementCycle },
      ),
    );
  }

  const stepCycle = findDirectedCycle(
    [...stepIds],
    spec.learningRoute.steps.flatMap((step) =>
      step.dependencies
        .filter((dependency) => dependency.relation === "requires")
        .map((dependency) => ({ from: step.stepId, to: dependency.stepRef })),
    ),
  );
  if (stepCycle) {
    issues.push(
      validationIssue(
        "CYCLE_DETECTED",
        "learningRoute.steps",
        `Required learning step dependency cycle detected: ${stepCycle.join(" -> ")}`,
        { relatedRefs: stepCycle },
      ),
    );
  }

  for (const capabilityRef of terminalSet) {
    if (
      !spec.learningRoute.steps.some((step) => step.capabilityRefs.includes(capabilityRef))
    ) {
      issues.push(
        validationIssue(
          "TERMINAL_CAPABILITY_WITHOUT_ROUTE_COVERAGE",
          "learningRoute.steps",
          `Terminal capability ${capabilityRef} is not covered by any learning step`,
          { relatedRefs: [capabilityRef] },
        ),
      );
    }
    if (
      !spec.assessmentContract.evidenceSpecs.some((evidence) =>
        evidence.capabilityRefs.includes(capabilityRef),
      )
    ) {
      issues.push(
        validationIssue(
          "TERMINAL_CAPABILITY_WITHOUT_ASSESSMENT_COVERAGE",
          "assessmentContract.evidenceSpecs",
          `Terminal capability ${capabilityRef} is not covered by assessment evidence`,
          { relatedRefs: [capabilityRef] },
        ),
      );
    }
  }

  for (const category of ["curriculum_fidelity", "linguistic_projection"]) {
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
  spec.provenance.mappings.forEach((mapping, index) => {
    addBrokenRefs(
      issues,
      mapping.sourceRefs,
      sourceIds,
      `provenance.mappings.${index}.sourceRefs`,
      "provenance source",
    );
    addBrokenRefs(
      issues,
      mapping.targetRefs,
      targetIds,
      `provenance.mappings.${index}.targetRefs`,
      "curriculum target",
    );
  });

  return validationResult(issues);
}
