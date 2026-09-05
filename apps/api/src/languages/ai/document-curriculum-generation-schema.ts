import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  criticalitySchema,
  domainIdSchema,
  modalitySchema,
  requiredTextSchema,
  semanticVersionSchema,
  supportLevelSchema,
  versionedRefSchema,
} from "../curriculum/primitives.js";

const idListSchema = z.array(domainIdSchema);
const textListSchema = z.array(requiredTextSchema);

const scalePolicyGenerationSchema = z
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
    min: z.number().nonnegative().nullable(),
    target: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    equivalenceAllowed: z.boolean().nullable(),
  })
  .strict();

const capabilityProfileGenerationSchema = z
  .object({
    description: requiredTextSchema,
    capabilityRefs: idListSchema,
  })
  .strict();

const competencyGenerationSchema = z
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
      .nullable(),
  })
  .strict();

const semanticItemGenerationSchema = z
  .object({
    id: domainIdSchema,
    label: requiredTextSchema,
    description: requiredTextSchema.nullable(),
  })
  .strict();

const learningStrategyGenerationSchema = z
  .object({
    strategyId: domainIdSchema,
    label: requiredTextSchema,
    expectedDepth: z.enum(["awareness", "guided_use", "independent_use"]),
  })
  .strict();

const targetArtifactGenerationSchema = z
  .object({
    artifactId: domainIdSchema,
    artifactType: domainIdSchema,
    purpose: requiredTextSchema,
    audience: requiredTextSchema,
    communicativeContext: requiredTextSchema,
    completionCondition: requiredTextSchema,
    requiredFunctionRefs: idListSchema,
    scalePolicy: scalePolicyGenerationSchema,
    required: z.boolean(),
  })
  .strict();

const adaptationRequirementGenerationSchema = z
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

const learningStepGenerationSchema = z
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

const granularityProfileGenerationSchema = z
  .object({
    minSessions: z.number().int().positive(),
    targetSessions: z.number().int().positive(),
    maxSessions: z.number().int().positive(),
  })
  .strict();

const generationPolicyGenerationSchema = z
  .object({
    structuralLoadPolicy: z
      .object({
        maxCentralNewLoadsPerLesson: z.number().int().positive(),
        notes: requiredTextSchema.nullable(),
      })
      .strict(),
    lexicalLoadPolicy: z
      .object({
        preferredNewCoreMin: z.number().int().nonnegative(),
        preferredNewCoreMax: z.number().int().positive(),
        hardMaximum: z.number().int().positive(),
      })
      .strict(),
    recyclingPolicy: z
      .object({
        progressionKnownContentMin: z.number().min(0).max(1),
        progressionKnownContentMax: z.number().min(0).max(1),
        finalIntegrationKnownContentMin: z.number().min(0).max(1),
      })
      .strict(),
    authenticityPolicy: z
      .object({
        preferNaturalUsage: z.boolean(),
        notes: requiredTextSchema.nullable(),
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
        notes: requiredTextSchema.nullable(),
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

const masteryRuleGenerationSchema = z
  .object({
    thresholdType: z.enum(["weighted_score", "all_required", "hybrid"]),
    minimumScore: z.number().nonnegative().nullable(),
    criticalCriteriaMustPass: z.boolean(),
  })
  .strict();

const evidenceSpecGenerationSchema = z
  .object({
    evidenceId: domainIdSchema,
    modality: modalitySchema,
    artifactRef: domainIdSchema.nullable(),
    capabilityRefs: idListSchema.min(1),
    required: z.boolean(),
    scale: scalePolicyGenerationSchema.nullable(),
    performanceConditions: z
      .object({
        supportCeiling: supportLevelSchema,
        contextFamiliarity: z.enum([
          "rehearsed",
          "similar",
          "novel_but_bounded",
        ]),
        resourcePolicy: requiredTextSchema,
      })
      .strict(),
  })
  .strict();

const curriculumUnitGenerationSchema = z
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
          .array(
            z.enum([
              "acquisition",
              "expansion",
              "integration",
              "consolidation",
            ]),
          )
          .min(1),
        entryProfile: capabilityProfileGenerationSchema,
        exitProfile: capabilityProfileGenerationSchema,
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
    competencies: z.array(competencyGenerationSchema).min(1),
    curriculumCore: z
      .object({
        communicativeFunctions: z.array(semanticItemGenerationSchema).min(1),
        semanticConcepts: z.array(semanticItemGenerationSchema).min(1),
        lexicalDomains: z.array(semanticItemGenerationSchema),
        quantitativeDomains: z.array(semanticItemGenerationSchema),
        discourseFunctions: z.array(semanticItemGenerationSchema),
        learningStrategies: z.array(learningStrategyGenerationSchema),
        targetArtifacts: z.array(targetArtifactGenerationSchema),
      })
      .strict(),
    adaptationRequirements: z.array(adaptationRequirementGenerationSchema),
    learningRoute: z
      .object({
        steps: z.array(learningStepGenerationSchema).min(1),
        terminalStepRefs: idListSchema.min(1),
      })
      .strict(),
    granularityPolicy: z
      .object({
        compact: granularityProfileGenerationSchema,
        recommended: granularityProfileGenerationSchema,
        expanded: granularityProfileGenerationSchema,
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
    generationPolicy: generationPolicyGenerationSchema,
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
        masteryRule: masteryRuleGenerationSchema,
        evidenceSpecs: z.array(evidenceSpecGenerationSchema).min(1),
        priorityPolicy: z
          .array(
            z.enum([
              "communicative_success",
              "comprehensibility",
              "appropriateness",
              "formal_accuracy",
            ]),
          )
          .length(4),
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
            failureEffect: z.enum([
              "review_required",
              "adaptation_blocked",
            ]),
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
                title: requiredTextSchema.nullable(),
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
                exclusionReason: requiredTextSchema.nullable(),
              })
              .strict(),
          )
          .min(1),
        transformationNotes: textListSchema.nullable(),
      })
      .strict(),
    specVersion: semanticVersionSchema,
    status: z.enum(["draft", "review", "canonical", "deprecated"]),
  })
  .strict();

export const curriculumDocumentGenerationSchema = z
  .object({
    documentRef: versionedRefSchema,
    curriculumId: domainIdSchema,
    levelId: domainIdSchema,
    units: z.array(curriculumUnitGenerationSchema).min(1).max(24),
  })
  .strict();

export type CurriculumDocumentGenerationCandidate = z.infer<
  typeof curriculumDocumentGenerationSchema
>;

export const curriculumDocumentGenerationTextFormat = zodTextFormat(
  curriculumDocumentGenerationSchema,
  "curriculum_document_candidate",
);

function omitProviderNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitProviderNulls);
  if (value === null || typeof value !== "object") return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== null) normalized[key] = omitProviderNulls(child);
  }
  return normalized;
}

export function normalizeCurriculumDocumentGenerationCandidate(
  candidate: unknown,
) {
  return omitProviderNulls(candidate);
}
