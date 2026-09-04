import { z } from "zod";
import {
  resolveRegistryDecision,
  validateLanguageDecisionRegistry,
  languageDecisionRefKey,
  type LanguageDecision,
  type LanguageDecisionRef,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import {
  validateCurriculumUnitSpec,
  type CurriculumUnitSpec,
} from "../curriculum/curriculum-unit-spec.js";
import {
  domainIdSchema,
  requiredTextSchema,
  semanticVersionSchema,
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
  validateLanguageProfile,
  type LanguageProfile,
  type LanguageProfileSection,
} from "../profile/language-profile.js";

export const adaptationResolutionModeSchema = z.enum([
  "reuse",
  "extend",
  "resolve",
  "not_applicable",
]);

export const adaptationCoverageStatusSchema = z.enum(["full", "partial", "none"]);

const requirementResolutionSchema = z
  .object({
    requirementRef: domainIdSchema,
    resolutionMode: adaptationResolutionModeSchema,
    decisionRef: versionedRefSchema.optional(),
    coverageStatus: adaptationCoverageStatusSchema,
    reason: requiredTextSchema,
  })
  .strict();

const gapSchema = z
  .object({
    gapId: domainIdSchema,
    requirementRef: domainIdSchema,
    gapType: z.enum([
      "missing_decision",
      "insufficient_scope",
      "conflicting_decisions",
      "insufficient_evidence",
      "profile_gap",
      "localization_gap",
    ]),
    criticality: z.enum(["blocking", "important", "non_blocking"]),
    missingInformation: z.array(requiredTextSchema).min(1),
    affectedCapabilities: z.array(domainIdSchema),
    affectedSteps: z.array(domainIdSchema),
    researchNeeded: z.boolean(),
    researchNecessity: z.enum([
      "none",
      "profile_only",
      "registry_reasoning",
      "external_research",
    ]),
  })
  .strict();

const researchTaskSchema = z
  .object({
    researchTaskId: domainIdSchema,
    gapRefs: z.array(domainIdSchema).min(1),
    researchQuestion: requiredTextSchema,
    requiredEvidenceClasses: z.array(domainIdSchema).min(1),
    preferredSources: z.array(requiredTextSchema).min(1),
    acceptanceCriteria: z.array(requiredTextSchema).min(1),
    expectedDecisionTarget: requiredTextSchema,
    priority: z.enum(["high", "medium", "low"]),
    costClass: z.enum(["light", "standard", "deep_research"]),
    researchNecessity: z.enum([
      "none",
      "profile_only",
      "registry_reasoning",
      "external_research",
    ]),
  })
  .strict();

const researchResultSchema = z
  .object({
    researchResultId: domainIdSchema,
    researchTaskRef: domainIdSchema,
    findings: z.array(requiredTextSchema).min(1),
    evidenceRefs: z.array(domainIdSchema),
    disposition: z.enum([
      "profile_update",
      "decision_update",
      "no_change",
      "needs_review",
    ]),
  })
  .strict();

const decisionChangesSchema = z
  .object({
    reusedDecisionRefs: z.array(versionedRefSchema),
    newDecisionRefs: z.array(versionedRefSchema),
    extendedDecisionRefs: z.array(versionedRefSchema),
    supersededDecisionRefs: z.array(versionedRefSchema),
  })
  .strict();

const pedagogicalImpactSchema = z
  .object({
    impactId: domainIdSchema,
    sourceDecisionRefs: z.array(versionedRefSchema).min(1),
    impactType: z.enum([
      "granularity",
      "ordering",
      "scaffolding",
      "input_output_asymmetry",
      "pronunciation",
      "literacy",
      "lexical_load",
      "structural_load",
      "register",
      "assessment",
      "localization",
    ]),
    affectedCapabilityRefs: z.array(domainIdSchema),
    affectedStepRefs: z.array(domainIdSchema),
    severity: z.enum(["minor", "moderate", "major"]),
    actionRecommendation: requiredTextSchema,
    rationale: requiredTextSchema,
  })
  .strict();

const routeTransformationSchema = z
  .object({
    transformationId: domainIdSchema,
    action: z.enum([
      "preserve",
      "merge",
      "split",
      "insert",
      "reorder",
      "downgrade",
      "upgrade",
    ]),
    sourceStepRefs: z.array(domainIdSchema).min(1),
    decisionRefs: z.array(versionedRefSchema),
    justification: requiredTextSchema,
  })
  .strict();

const resolutionAreaSchema = z
  .object({
    status: z.enum(["pending", "resolved", "not_applicable"]),
    decisionRefs: z.array(versionedRefSchema),
    notes: z.array(requiredTextSchema),
  })
  .strict();

const auditSchema = z
  .object({
    status: z.enum(["not_run", "pass", "fail"]),
    findings: z.array(requiredTextSchema),
  })
  .strict();

export const adaptationPlanSchema = z
  .object({
    identity: z
      .object({
        adaptationPlanId: domainIdSchema,
        languageId: domainIdSchema,
        varietyId: domainIdSchema,
        curriculumId: domainIdSchema,
        unitId: domainIdSchema,
      })
      .strict(),
    inputs: z
      .object({
        curriculumUnitSpecRef: versionedRefSchema,
        languageProfileRef: versionedRefSchema,
        languageDecisionRegistryRef: versionedRefSchema,
      })
      .strict(),
    requirementResolution: z.array(requirementResolutionSchema),
    gapAnalysis: z.array(gapSchema),
    researchPlan: z.array(researchTaskSchema),
    researchResults: z.array(researchResultSchema),
    decisionChanges: decisionChangesSchema,
    pedagogicalImpactAnalysis: z.array(pedagogicalImpactSchema),
    routeTransformationPlan: z.array(routeTransformationSchema),
    instructionalResolution: resolutionAreaSchema,
    pronunciationResolution: resolutionAreaSchema,
    literacyResolution: resolutionAreaSchema,
    localizationResolution: resolutionAreaSchema,
    coverageAudit: auditSchema,
    projectionAudit: auditSchema,
    consistencyAudit: auditSchema,
    outputs: z
      .object({
        adaptedUnitSpecRef: versionedRefSchema.optional(),
        routeReady: z.boolean(),
      })
      .strict(),
    readiness: z
      .object({
        state: z.enum([
          "ready",
          "ready_with_provisional_decisions",
          "needs_review",
          "blocked",
        ]),
        blockingGapRefs: z.array(domainIdSchema),
        notes: z.array(requiredTextSchema),
      })
      .strict(),
    executionMetadata: z
      .object({
        compilerId: domainIdSchema,
        compilerVersion: semanticVersionSchema,
        mode: z.literal("deterministic"),
        phase: z.literal("initial_resolution"),
      })
      .strict(),
    version: semanticVersionSchema,
    status: z.enum([
      "created",
      "requirements_resolved",
      "gaps_identified",
      "research_complete",
      "decisions_resolved",
      "pedagogical_impacts_resolved",
      "route_transformed",
      "audited",
      "ready",
      "blocked",
      "needs_review",
    ]),
  })
  .strict();

export type AdaptationPlan = z.infer<typeof adaptationPlanSchema>;

export type AdaptationPlanValidationContext = {
  curriculum?: CurriculumUnitSpec;
  languageProfile?: LanguageProfile;
  registry?: LanguageDecisionRegistry;
};

export type AdaptationCompilationInput = {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  registry: LanguageDecisionRegistry;
};

export type AdaptationCompilationResult = {
  plan: AdaptationPlan | null;
  validation: ValidationResult;
};

const PROFILE_SECTION_BY_DOMAIN: Record<string, LanguageProfileSection> = {
  "writing.beginner_system": "writingSystem",
  "phonology.initial_intelligibility": "phonology",
  "sociolinguistics.initial_register": "sociolinguisticSystem",
  "participant.basic_reference": "participantReference",
  "nominal.beginner_package": "nominalSystem",
  "predication.identity_state": "predicationSystem",
  "age.basic_expression": "semanticSystems",
  "possession.basic": "semanticSystems",
  "action.basic_pattern": "verbalSystem",
  "localization.first_contact": "sociolinguisticSystem",
};

const RESEARCH_GROUP_BY_DOMAIN: Record<string, string> = {
  "writing.beginner_system": "literacy",
  "phonology.initial_intelligibility": "pronunciation",
  "sociolinguistics.initial_register": "first_contact",
  "participant.basic_reference": "first_contact",
  "nominal.beginner_package": "nominal_verbal_core",
  "predication.identity_state": "predication_relations",
  "age.basic_expression": "predication_relations",
  "possession.basic": "predication_relations",
  "action.basic_pattern": "nominal_verbal_core",
  "localization.first_contact": "first_contact",
};

const RESEARCH_GROUP_METADATA: Record<
  string,
  {
    question: string;
    evidenceClasses: string[];
    expectedDecisionTarget: string;
  }
> = {
  literacy: {
    question: "Resolve the beginner writing-system strategy from the reviewed language profile.",
    evidenceClasses: ["orthography", "literacy"],
    expectedDecisionTarget: "Beginner recognition, production and auxiliary-script strategy.",
  },
  pronunciation: {
    question: "Resolve the initial intelligibility-focused pronunciation strategy.",
    evidenceClasses: ["phonology", "intelligibility"],
    expectedDecisionTarget: "A bounded initial pronunciation and perception focus.",
  },
  first_contact: {
    question: "Resolve first-contact sociolinguistic, reference and localization behavior.",
    evidenceClasses: ["sociolinguistics", "interaction"],
    expectedDecisionTarget: "A safe first-contact strategy for the target variety.",
  },
  nominal_verbal_core: {
    question: "Resolve the minimum nominal and verbal package required by the unit.",
    evidenceClasses: ["morphology", "syntax"],
    expectedDecisionTarget: "A high-frequency A1 productive core without full paradigms.",
  },
  predication_relations: {
    question: "Resolve identity, state, age and possession realization for the unit.",
    evidenceClasses: ["predication", "semantics"],
    expectedDecisionTarget: "Authentic beginner predication and relation patterns.",
  },
};

function appendIssues(target: ValidationIssue[], result: ValidationResult, prefix: string) {
  for (const issue of result.issues) {
    target.push({ ...issue, path: issue.path ? `${prefix}.${issue.path}` : prefix });
  }
}

function decisionByRef(
  registry: LanguageDecisionRegistry,
  ref: LanguageDecisionRef,
): LanguageDecision | undefined {
  const key = languageDecisionRefKey(ref);
  return registry.decisions.find(
    (decision) =>
      languageDecisionRefKey({
        id: decision.identity.decisionId,
        version: decision.identity.decisionVersion,
      }) === key,
  );
}

function profileCoverageStatus(
  profile: LanguageProfile,
  section: LanguageProfileSection | undefined,
) {
  if (!section) return undefined;
  return profile.profileCoverage.find((entry) => entry.section === section)?.coverageStatus;
}

function researchNecessityFor(
  profile: LanguageProfile,
  requirementDomain: string,
  resolutionMode: "extend" | "resolve",
): z.infer<typeof gapSchema>["researchNecessity"] {
  if (resolutionMode === "extend") return "registry_reasoning";
  const status = profileCoverageStatus(profile, PROFILE_SECTION_BY_DOMAIN[requirementDomain]);
  if (status === "reviewed" || status === "resolved") return "registry_reasoning";
  if (status === "partial") return "profile_only";
  return "external_research";
}

function gapTypeFor(
  profile: LanguageProfile,
  requirementDomain: string,
  resolutionMode: "extend" | "resolve",
): z.infer<typeof gapSchema>["gapType"] {
  if (resolutionMode === "extend") return "insufficient_scope";
  const status = profileCoverageStatus(profile, PROFILE_SECTION_BY_DOMAIN[requirementDomain]);
  if (!status || status === "unresolved" || status === "partial") return "profile_gap";
  if (requirementDomain === "localization.first_contact") return "localization_gap";
  return "missing_decision";
}

function maxResearchNecessity(
  necessities: Array<z.infer<typeof gapSchema>["researchNecessity"]>,
) {
  const rank = {
    none: 0,
    profile_only: 1,
    registry_reasoning: 2,
    external_research: 3,
  } as const;
  return necessities.reduce((current, candidate) =>
    rank[candidate] > rank[current] ? candidate : current,
  );
}

function buildResearchPlan(
  gaps: z.infer<typeof gapSchema>[],
  curriculum: CurriculumUnitSpec,
): z.infer<typeof researchTaskSchema>[] {
  const requirementById = new Map(
    curriculum.adaptationRequirements.map((requirement) => [requirement.requirementId, requirement]),
  );
  const grouped = new Map<string, z.infer<typeof gapSchema>[]>();

  for (const gap of gaps.filter((candidate) => candidate.researchNeeded)) {
    const requirement = requirementById.get(gap.requirementRef);
    if (!requirement) continue;
    const group = RESEARCH_GROUP_BY_DOMAIN[requirement.domain] ?? `requirement_${gap.requirementRef}`;
    const entries = grouped.get(group) ?? [];
    entries.push(gap);
    grouped.set(group, entries);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, groupGaps]) => {
      const metadata = RESEARCH_GROUP_METADATA[group] ?? {
        question: `Resolve adaptation requirements grouped under ${group}.`,
        evidenceClasses: ["language_profile"],
        expectedDecisionTarget: "A validated language decision covering the grouped requirements.",
      };
      const necessity = maxResearchNecessity(groupGaps.map((gap) => gap.researchNecessity));
      const preferredSources = ["LanguageDecisionRegistry", "LanguageProfile"];
      if (necessity === "external_research") preferredSources.push("Authoritative external linguistic sources");

      return {
        researchTaskId: `research.${group}`,
        gapRefs: groupGaps.map((gap) => gap.gapId).sort(),
        researchQuestion: metadata.question,
        requiredEvidenceClasses: metadata.evidenceClasses,
        preferredSources,
        acceptanceCriteria: [
          "The result resolves every linked gap or explicitly records why it remains blocked.",
          "Any stable linguistic fact update is routed to LanguageProfile; pedagogical strategy is routed to LanguageDecisionRegistry.",
        ],
        expectedDecisionTarget: metadata.expectedDecisionTarget,
        priority: groupGaps.some((gap) => gap.criticality === "blocking") ? "high" : "medium",
        costClass: necessity === "external_research" ? "deep_research" : "standard",
        researchNecessity: necessity,
      };
    });
}

function buildPedagogicalImpacts(
  registry: LanguageDecisionRegistry,
  reusedRefs: LanguageDecisionRef[],
): z.infer<typeof pedagogicalImpactSchema>[] {
  return reusedRefs.flatMap((ref, index) => {
    const decision = decisionByRef(registry, ref);
    if (!decision || decision.granularityImpact.effect === "none") return [];
    return [
      {
        impactId: `impact.reused.${index + 1}`,
        sourceDecisionRefs: [ref],
        impactType: "granularity" as const,
        affectedCapabilityRefs: decision.semanticTarget.capabilityRefs,
        affectedStepRefs: decision.granularityImpact.affectedStepRefs,
        severity: decision.granularityImpact.severity,
        actionRecommendation: `Honor upstream granularity impact: ${decision.granularityImpact.effect}.`,
        rationale: decision.granularityImpact.reason,
      },
    ];
  });
}

export function validateAdaptationPlan(
  input: unknown,
  context: AdaptationPlanValidationContext = {},
): ValidationResult {
  const parsed = adaptationPlanSchema.safeParse(input);
  if (!parsed.success) return validationResult(zodIssuesToValidationIssues(parsed.error));

  const plan = parsed.data;
  const issues: ValidationIssue[] = [];
  const resolutionByRequirement = new Map<string, typeof plan.requirementResolution[number]>();

  plan.requirementResolution.forEach((resolution, index) => {
    if (resolutionByRequirement.has(resolution.requirementRef)) {
      issues.push(
        validationIssue(
          "DUPLICATE_REQUIREMENT_RESOLUTION",
          `requirementResolution.${index}.requirementRef`,
          `Requirement ${resolution.requirementRef} is resolved more than once.`,
          { relatedRefs: [resolution.requirementRef] },
        ),
      );
    }
    resolutionByRequirement.set(resolution.requirementRef, resolution);

    if (resolution.resolutionMode === "reuse") {
      if (!resolution.decisionRef || resolution.coverageStatus !== "full") {
        issues.push(
          validationIssue(
            "INVALID_REUSE_RESOLUTION",
            `requirementResolution.${index}`,
            "reuse requires a decisionRef and full coverage.",
          ),
        );
      }
    }
    if (resolution.resolutionMode === "extend") {
      if (!resolution.decisionRef || resolution.coverageStatus !== "partial") {
        issues.push(
          validationIssue(
            "INVALID_EXTEND_RESOLUTION",
            `requirementResolution.${index}`,
            "extend requires a decisionRef and partial coverage.",
          ),
        );
      }
    }
    if (resolution.resolutionMode === "resolve" && resolution.coverageStatus !== "none") {
      issues.push(
        validationIssue(
          "INVALID_RESOLVE_COVERAGE",
          `requirementResolution.${index}.coverageStatus`,
          "resolve must begin with no coverage.",
        ),
      );
    }
  });

  if (context.curriculum) {
    const expected = new Set(
      context.curriculum.adaptationRequirements.map((requirement) => requirement.requirementId),
    );
    for (const requirementRef of expected) {
      if (!resolutionByRequirement.has(requirementRef)) {
        issues.push(
          validationIssue(
            "MISSING_REQUIREMENT_RESOLUTION",
            "requirementResolution",
            `Missing resolution for ${requirementRef}.`,
            { relatedRefs: [requirementRef] },
          ),
        );
      }
    }
    for (const requirementRef of resolutionByRequirement.keys()) {
      if (!expected.has(requirementRef)) {
        issues.push(
          validationIssue(
            "UNKNOWN_REQUIREMENT_RESOLUTION",
            "requirementResolution",
            `Resolution references unknown requirement ${requirementRef}.`,
            { relatedRefs: [requirementRef] },
          ),
        );
      }
    }
    if (
      plan.inputs.curriculumUnitSpecRef.id !== context.curriculum.identity.unitId ||
      plan.inputs.curriculumUnitSpecRef.version !== context.curriculum.specVersion
    ) {
      issues.push(
        validationIssue(
          "CURRICULUM_INPUT_REF_MISMATCH",
          "inputs.curriculumUnitSpecRef",
          "AdaptationPlan curriculum input ref does not match validation context.",
        ),
      );
    }
  }

  const gapIds = new Set(plan.gapAnalysis.map((gap) => gap.gapId));
  const gapRequirementRefs = new Set(plan.gapAnalysis.map((gap) => gap.requirementRef));
  plan.requirementResolution.forEach((resolution, index) => {
    const shouldHaveGap = resolution.resolutionMode === "extend" || resolution.resolutionMode === "resolve";
    if (shouldHaveGap && !gapRequirementRefs.has(resolution.requirementRef)) {
      issues.push(
        validationIssue(
          "UNRESOLVED_REQUIREMENT_WITHOUT_GAP",
          `requirementResolution.${index}`,
          `${resolution.requirementRef} requires a gap record.`,
        ),
      );
    }
    if (!shouldHaveGap && gapRequirementRefs.has(resolution.requirementRef)) {
      issues.push(
        validationIssue(
          "RESOLVED_REQUIREMENT_HAS_GAP",
          `requirementResolution.${index}`,
          `${resolution.requirementRef} is resolved but still has a gap.`,
        ),
      );
    }
  });

  plan.researchPlan.forEach((task, taskIndex) => {
    task.gapRefs.forEach((gapRef, gapIndex) => {
      if (!gapIds.has(gapRef)) {
        issues.push(
          validationIssue(
            "BROKEN_GAP_REFERENCE",
            `researchPlan.${taskIndex}.gapRefs.${gapIndex}`,
            `Research task references unknown gap ${gapRef}.`,
            { relatedRefs: [gapRef] },
          ),
        );
      }
    });
  });

  if (context.languageProfile) {
    if (
      plan.inputs.languageProfileRef.id !== context.languageProfile.identity.profileId ||
      plan.inputs.languageProfileRef.version !== context.languageProfile.version
    ) {
      issues.push(
        validationIssue(
          "LANGUAGE_PROFILE_INPUT_REF_MISMATCH",
          "inputs.languageProfileRef",
          "AdaptationPlan language profile ref does not match validation context.",
        ),
      );
    }
  }

  if (context.registry) {
    if (
      plan.inputs.languageDecisionRegistryRef.id !== context.registry.identity.registryId ||
      plan.inputs.languageDecisionRegistryRef.version !== context.registry.version
    ) {
      issues.push(
        validationIssue(
          "REGISTRY_INPUT_REF_MISMATCH",
          "inputs.languageDecisionRegistryRef",
          "AdaptationPlan registry ref does not match validation context.",
        ),
      );
    }
    const registryRefs = new Set(
      context.registry.decisions.map((decision) =>
        languageDecisionRefKey({
          id: decision.identity.decisionId,
          version: decision.identity.decisionVersion,
        }),
      ),
    );
    plan.requirementResolution.forEach((resolution, index) => {
      if (resolution.decisionRef && !registryRefs.has(languageDecisionRefKey(resolution.decisionRef))) {
        issues.push(
          validationIssue(
            "BROKEN_DECISION_REFERENCE",
            `requirementResolution.${index}.decisionRef`,
            `Decision ${languageDecisionRefKey(resolution.decisionRef)} does not exist in registry.`,
          ),
        );
      }
    });
    const expectedReused = plan.requirementResolution
      .filter((resolution) => resolution.resolutionMode === "reuse" && resolution.decisionRef)
      .map((resolution) => languageDecisionRefKey(resolution.decisionRef!))
      .sort();
    const declaredReused = plan.decisionChanges.reusedDecisionRefs.map(languageDecisionRefKey).sort();
    if (expectedReused.join("|") !== declaredReused.join("|")) {
      issues.push(
        validationIssue(
          "REUSED_DECISION_CHANGE_MISMATCH",
          "decisionChanges.reusedDecisionRefs",
          "decisionChanges.reusedDecisionRefs must exactly match reuse resolutions.",
        ),
      );
    }
  }

  if (plan.readiness.state === "ready") {
    if (plan.gapAnalysis.length > 0) {
      issues.push(
        validationIssue(
          "READY_PLAN_HAS_OPEN_GAPS",
          "readiness.state",
          "A ready plan cannot contain open gaps.",
        ),
      );
    }
    for (const [auditName, audit] of [
      ["coverageAudit", plan.coverageAudit],
      ["projectionAudit", plan.projectionAudit],
      ["consistencyAudit", plan.consistencyAudit],
    ] as const) {
      if (audit.status !== "pass") {
        issues.push(
          validationIssue(
            "READY_PLAN_AUDIT_NOT_PASSED",
            auditName,
            `Ready plan requires ${auditName} to pass.`,
          ),
        );
      }
    }
  }

  return validationResult(issues);
}

export function compileInitialAdaptationPlan(
  input: AdaptationCompilationInput,
): AdaptationCompilationResult {
  const inputIssues: ValidationIssue[] = [];
  appendIssues(inputIssues, validateCurriculumUnitSpec(input.curriculum), "curriculum");
  appendIssues(inputIssues, validateLanguageProfile(input.languageProfile), "languageProfile");
  appendIssues(
    inputIssues,
    validateLanguageDecisionRegistry(input.registry, { languageProfile: input.languageProfile }),
    "registry",
  );

  if (input.curriculum.identity.curriculumId !== input.registry.identity.curriculumId) {
    inputIssues.push(
      validationIssue(
        "CURRICULUM_REGISTRY_IDENTITY_MISMATCH",
        "registry.identity.curriculumId",
        "Curriculum and decision registry must belong to the same curriculum.",
      ),
    );
  }
  if (
    input.languageProfile.identity.languageId !== input.registry.identity.languageId ||
    input.languageProfile.identity.varietyId !== input.registry.identity.varietyId
  ) {
    inputIssues.push(
      validationIssue(
        "PROFILE_REGISTRY_IDENTITY_MISMATCH",
        "registry.identity",
        "LanguageProfile and decision registry language/variety must match.",
      ),
    );
  }
  if (inputIssues.some((issue) => issue.severity === "error")) {
    return { plan: null, validation: validationResult(inputIssues) };
  }

  const terminalCapabilities = new Set(input.curriculum.scope.capabilityFlow.terminal);
  const requirementResolution: z.infer<typeof requirementResolutionSchema>[] = [];
  const gaps: z.infer<typeof gapSchema>[] = [];
  const reusedDecisionRefs: LanguageDecisionRef[] = [];
  const extendedDecisionRefs: LanguageDecisionRef[] = [];

  for (const requirement of input.curriculum.adaptationRequirements) {
    const result = resolveRegistryDecision(input.registry, {
      adaptationRequirementRef: requirement.requirementId,
      levelScope: input.curriculum.identity.levelId,
      unitScope: input.curriculum.identity.unitId,
    });

    if (result.mode === "reuse" && result.decisionRef) {
      requirementResolution.push({
        requirementRef: requirement.requirementId,
        resolutionMode: "reuse",
        decisionRef: result.decisionRef,
        coverageStatus: "full",
        reason: result.reason,
      });
      reusedDecisionRefs.push(result.decisionRef);
      continue;
    }

    const resolutionMode = result.mode === "extend" ? "extend" : "resolve";
    requirementResolution.push({
      requirementRef: requirement.requirementId,
      resolutionMode,
      ...(result.decisionRef ? { decisionRef: result.decisionRef } : {}),
      coverageStatus: result.mode === "extend" ? "partial" : "none",
      reason: result.reason,
    });
    if (result.mode === "extend" && result.decisionRef) extendedDecisionRefs.push(result.decisionRef);

    const necessity = researchNecessityFor(input.languageProfile, requirement.domain, resolutionMode);
    gaps.push({
      gapId: `gap.${requirement.requirementId}`,
      requirementRef: requirement.requirementId,
      gapType: gapTypeFor(input.languageProfile, requirement.domain, resolutionMode),
      criticality: requirement.affectedCapabilityRefs.some((ref) => terminalCapabilities.has(ref))
        ? "blocking"
        : "important",
      missingInformation: [
        result.mode === "extend"
          ? `Existing decision does not fully cover ${requirement.decisionScope} scope for ${requirement.requirementId}.`
          : `No compatible validated decision currently resolves ${requirement.semanticProblem}`,
      ],
      affectedCapabilities: requirement.affectedCapabilityRefs,
      affectedSteps: requirement.affectedStepRefs,
      researchNeeded: necessity !== "none",
      researchNecessity: necessity,
    });
  }

  const researchPlan = buildResearchPlan(gaps, input.curriculum);
  const plan: AdaptationPlan = {
    identity: {
      adaptationPlanId: `adaptation.${input.curriculum.identity.unitId}.${input.languageProfile.identity.varietyId}`,
      languageId: input.languageProfile.identity.languageId,
      varietyId: input.languageProfile.identity.varietyId,
      curriculumId: input.curriculum.identity.curriculumId,
      unitId: input.curriculum.identity.unitId,
    },
    inputs: {
      curriculumUnitSpecRef: {
        id: input.curriculum.identity.unitId,
        version: input.curriculum.specVersion,
      },
      languageProfileRef: {
        id: input.languageProfile.identity.profileId,
        version: input.languageProfile.version,
      },
      languageDecisionRegistryRef: {
        id: input.registry.identity.registryId,
        version: input.registry.version,
      },
    },
    requirementResolution,
    gapAnalysis: gaps,
    researchPlan,
    researchResults: [],
    decisionChanges: {
      reusedDecisionRefs,
      newDecisionRefs: [],
      extendedDecisionRefs,
      supersededDecisionRefs: [],
    },
    pedagogicalImpactAnalysis: buildPedagogicalImpacts(input.registry, reusedDecisionRefs),
    routeTransformationPlan: [],
    instructionalResolution: {
      status: "pending",
      decisionRefs: reusedDecisionRefs,
      notes: ["Instructional resolution remains open until all adaptation requirements are resolved."],
    },
    pronunciationResolution: {
      status: "pending",
      decisionRefs: [],
      notes: ["Pronunciation resolution awaits AR02 or an equivalent validated decision."],
    },
    literacyResolution: {
      status: "pending",
      decisionRefs: [],
      notes: ["Literacy resolution awaits AR01 or an equivalent validated decision."],
    },
    localizationResolution: {
      status: "pending",
      decisionRefs: [],
      notes: ["Localization resolution awaits AR10 or an equivalent validated decision."],
    },
    coverageAudit: { status: "not_run", findings: [] },
    projectionAudit: { status: "not_run", findings: [] },
    consistencyAudit: { status: "not_run", findings: [] },
    outputs: { routeReady: false },
    readiness: {
      state: "needs_review",
      blockingGapRefs: gaps
        .filter((gap) => gap.criticality === "blocking")
        .map((gap) => gap.gapId),
      notes: [
        `${reusedDecisionRefs.length} requirements reused validated decisions; ${gaps.length} gaps remain.`,
      ],
    },
    executionMetadata: {
      compilerId: "memoos.adaptation_compiler",
      compilerVersion: "1.0.0",
      mode: "deterministic",
      phase: "initial_resolution",
    },
    version: "1.0.0",
    status: gaps.length > 0 ? "gaps_identified" : "requirements_resolved",
  };

  const planValidation = validateAdaptationPlan(plan, {
    curriculum: input.curriculum,
    languageProfile: input.languageProfile,
    registry: input.registry,
  });
  return { plan: planValidation.valid ? plan : null, validation: planValidation };
}
