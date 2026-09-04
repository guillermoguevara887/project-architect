import { z } from "zod";
import { findDirectedCycle } from "../curriculum/graph.js";
import {
  confidenceSchema,
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
  languageFeatureReviewStatusSchema,
  languageProfileSchema,
  type LanguageProfile,
} from "../profile/language-profile.js";

export const languageDecisionStatusSchema = z.enum([
  "provisional",
  "validated",
  "superseded",
  "blocked",
  "deprecated",
]);

export const languageDecisionKindSchema = z.enum([
  "structural_interpretation",
  "pedagogical_strategy",
]);

export const decisionScopeTypeSchema = z.enum([
  "language_global",
  "level_global",
  "unit_contextual",
  "task_contextual",
]);

export const languageDecisionRefSchema = versionedRefSchema;
export type LanguageDecisionRef = z.infer<typeof languageDecisionRefSchema>;

const decisionScopeSchema = z
  .object({
    scopeType: decisionScopeTypeSchema,
    levelScope: domainIdSchema.optional(),
    unitScope: domainIdSchema.optional(),
    taskScope: domainIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeType === "level_global" && !value.levelScope) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["levelScope"],
        message: "level_global decisions require levelScope",
      });
    }
    if (value.scopeType === "unit_contextual" && !value.unitScope) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitScope"],
        message: "unit_contextual decisions require unitScope",
      });
    }
    if (value.scopeType === "task_contextual" && !value.taskScope) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskScope"],
        message: "task_contextual decisions require taskScope",
      });
    }
  });

const alternativeSchema = z
  .object({
    alternativeId: domainIdSchema,
    description: requiredTextSchema,
    status: z.enum([
      "accepted_variant",
      "recognition_only",
      "deferred",
      "rejected_for_scope",
    ]),
    conditions: z.array(requiredTextSchema),
  })
  .strict();

const toleranceSchema = z
  .object({
    acceptedVariation: z.array(requiredTextSchema),
    blockingErrors: z.array(requiredTextSchema),
    nonBlockingErrors: z.array(requiredTextSchema),
  })
  .strict();

const supportPolicySchema = z
  .object({
    initialSupport: supportLevelSchema,
    withdrawalCondition: requiredTextSchema,
    terminalSupportCeiling: supportLevelSchema,
  })
  .strict();

const granularityImpactSchema = z
  .object({
    effect: z.enum([
      "none",
      "merge_candidate",
      "expand",
      "insert_microstep",
      "reorder_candidate",
    ]),
    affectedStepRefs: z.array(domainIdSchema),
    reason: requiredTextSchema,
    severity: z.enum(["minor", "moderate", "major"]),
  })
  .strict();

const compatibilitySchema = z
  .object({
    validFor: z
      .object({
        languageId: domainIdSchema,
        varietyId: domainIdSchema,
        curriculumId: domainIdSchema,
        levelScopes: z.array(domainIdSchema),
        unitScopes: z.array(domainIdSchema),
        taskScopes: z.array(domainIdSchema),
      })
      .strict(),
    extensionPolicy: z.enum([
      "reuse_when_compatible",
      "extend_if_scope_expands",
      "new_version_required",
    ]),
    backwardCompatibility: z.enum([
      "fully_compatible",
      "compatible_with_conditions",
      "breaking",
    ]),
  })
  .strict();

export const languageDecisionSchema = z
  .object({
    identity: z
      .object({
        decisionId: domainIdSchema,
        decisionVersion: semanticVersionSchema,
        decisionKind: languageDecisionKindSchema,
        domain: domainIdSchema,
        status: languageDecisionStatusSchema,
      })
      .strict(),
    semanticTarget: z
      .object({
        semanticProblem: requiredTextSchema,
        conceptRefs: z.array(domainIdSchema),
        functionRefs: z.array(domainIdSchema),
        capabilityRefs: z.array(domainIdSchema),
      })
      .strict(),
    scope: decisionScopeSchema,
    trigger: z
      .object({
        adaptationRequirementRefs: z.array(domainIdSchema).min(1),
        firstRequiredBy: z
          .object({
            curriculumUnitRef: versionedRefSchema,
            requirementRef: domainIdSchema,
          })
          .strict(),
        reason: requiredTextSchema,
      })
      .strict(),
    languageBasis: z
      .object({
        featureRefs: z.array(domainIdSchema),
        mechanismRefs: z.array(domainIdSchema),
        claimRefs: z.array(domainIdSchema),
        relevantFacts: z.array(requiredTextSchema).min(1),
      })
      .strict(),
    resolution: z
      .object({
        resolutionSummary: requiredTextSchema,
        selectedMechanisms: z.array(domainIdSchema),
        recognitionRange: z.array(domainIdSchema),
        productiveRange: z.array(domainIdSchema),
        alternatives: z.array(alternativeSchema),
        deferredScope: z.array(domainIdSchema),
        contextConditions: z.array(requiredTextSchema),
      })
      .strict(),
    learnerContract: z
      .object({
        inputExpectation: requiredTextSchema,
        outputExpectation: requiredTextSchema,
        masteryExpectation: requiredTextSchema,
        tolerance: toleranceSchema,
        supportPolicy: supportPolicySchema,
      })
      .strict(),
    instructionConstraints: z
      .object({
        policyFlags: z.array(domainIdSchema),
        forbiddenAssumptions: z.array(requiredTextSchema),
        crossLinguisticWarnings: z.array(requiredTextSchema),
      })
      .strict(),
    granularityImpact: granularityImpactSchema,
    dependencies: z
      .object({
        requiresDecisionRefs: z.array(languageDecisionRefSchema),
        benefitsFromDecisionRefs: z.array(languageDecisionRefSchema),
      })
      .strict(),
    compatibility: compatibilitySchema,
    evidence: z
      .object({
        profileClaimRefs: z.array(domainIdSchema),
        externalEvidenceRefs: z.array(domainIdSchema),
        reasoningSummary: requiredTextSchema,
        confidence: confidenceSchema,
        reviewStatus: languageFeatureReviewStatusSchema,
      })
      .strict(),
    lifecycle: z
      .object({
        createdFrom: z
          .object({
            sourceType: z.enum([
              "adaptation_requirement",
              "profile_reasoning",
              "external_research",
              "manual_review",
              "migration",
            ]),
            sourceRefs: z.array(domainIdSchema),
          })
          .strict(),
        supersedes: languageDecisionRefSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type LanguageDecision = z.infer<typeof languageDecisionSchema>;

const dependencyEdgeSchema = z
  .object({
    from: languageDecisionRefSchema,
    to: languageDecisionRefSchema,
    relation: z.enum(["requires", "benefits_from"]),
  })
  .strict();

export const languageDecisionRegistrySchema = z
  .object({
    identity: z
      .object({
        registryId: domainIdSchema,
        languageId: domainIdSchema,
        varietyId: domainIdSchema,
        curriculumId: domainIdSchema,
      })
      .strict(),
    coverage: z
      .object({
        levelScopes: z.array(domainIdSchema),
        unitScopes: z.array(domainIdSchema),
        requirementDomains: z.array(domainIdSchema),
        notes: z.array(requiredTextSchema),
      })
      .strict(),
    decisions: z.array(languageDecisionSchema),
    dependencyGraph: z
      .object({
        nodes: z.array(languageDecisionRefSchema),
        edges: z.array(dependencyEdgeSchema),
      })
      .strict(),
    validation: z
      .object({
        requiredChecks: z
          .array(
            z.enum([
              "reference_integrity",
              "dependency_acyclicity",
              "profile_grounding",
              "recognition_production",
              "lifecycle_consistency",
              "compatibility",
            ]),
          )
          .min(1),
        strictProfileGrounding: z.boolean(),
      })
      .strict(),
    version: semanticVersionSchema,
    status: z.enum(["draft", "review", "canonical", "deprecated"]),
  })
  .strict();

export type LanguageDecisionRegistry = z.infer<typeof languageDecisionRegistrySchema>;

export type LanguageDecisionValidationContext = {
  languageProfile?: LanguageProfile;
};

function decisionRef(decision: LanguageDecision): LanguageDecisionRef {
  return {
    id: decision.identity.decisionId,
    version: decision.identity.decisionVersion,
  };
}

export function languageDecisionRefKey(ref: LanguageDecisionRef): string {
  return `${ref.id}@${ref.version}`;
}

function edgeKey(edge: z.infer<typeof dependencyEdgeSchema>): string {
  return `${languageDecisionRefKey(edge.from)}>${languageDecisionRefKey(edge.to)}:${edge.relation}`;
}

function parseSemver(version: string): [number, number, number] {
  const core = version.split(/[+-]/u, 1)[0] ?? version;
  const [major = "0", minor = "0", patch = "0"] = core.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function pushDuplicateIssue(
  issues: ValidationIssue[],
  seen: Set<string>,
  key: string,
  path: string,
  label: string,
) {
  if (seen.has(key)) {
    issues.push(
      validationIssue(
        "DUPLICATE_DECISION_REFERENCE",
        path,
        `Duplicate ${label} ${key}`,
        { relatedRefs: [key] },
      ),
    );
  }
  seen.add(key);
}

type ProfileReferenceIndex = {
  featureIds: Set<string>;
  mechanismIds: Set<string>;
  claimIds: Set<string>;
  sourceIds: Set<string>;
};

function collectProfileReferenceIndex(profile: LanguageProfile): ProfileReferenceIndex {
  const index: ProfileReferenceIndex = {
    featureIds: new Set<string>(),
    mechanismIds: new Set<string>(),
    claimIds: new Set<string>(),
    sourceIds: new Set<string>(),
  };

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.featureId === "string") index.featureIds.add(record.featureId);
    if (typeof record.mechanismId === "string") index.mechanismIds.add(record.mechanismId);
    if (typeof record.claimId === "string") index.claimIds.add(record.claimId);
    if (typeof record.sourceId === "string") index.sourceIds.add(record.sourceId);
    Object.values(record).forEach(walk);
  };

  walk(profile);
  return index;
}

function validateProfileGrounding(
  registry: LanguageDecisionRegistry,
  profile: LanguageProfile,
  issues: ValidationIssue[],
) {
  if (
    registry.identity.languageId !== profile.identity.languageId ||
    registry.identity.varietyId !== profile.identity.varietyId
  ) {
    issues.push(
      validationIssue(
        "PROFILE_REGISTRY_IDENTITY_MISMATCH",
        "identity",
        "Registry language and variety must match the validation LanguageProfile",
      ),
    );
    return;
  }

  const refs = collectProfileReferenceIndex(profile);
  registry.decisions.forEach((decision, decisionIndex) => {
    decision.languageBasis.featureRefs.forEach((ref, refIndex) => {
      if (!refs.featureIds.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_LANGUAGE_FEATURE_REFERENCE",
            `decisions.${decisionIndex}.languageBasis.featureRefs.${refIndex}`,
            `Language feature ${ref} does not exist in the LanguageProfile`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
    decision.languageBasis.mechanismRefs.forEach((ref, refIndex) => {
      if (!refs.mechanismIds.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_LANGUAGE_MECHANISM_REFERENCE",
            `decisions.${decisionIndex}.languageBasis.mechanismRefs.${refIndex}`,
            `Language mechanism ${ref} does not exist in the LanguageProfile`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
    [
      ...decision.languageBasis.claimRefs,
      ...decision.evidence.profileClaimRefs,
    ].forEach((ref, refIndex) => {
      if (!refs.claimIds.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_PROFILE_CLAIM_REFERENCE",
            `decisions.${decisionIndex}.evidence.profileClaimRefs.${refIndex}`,
            `Profile claim ${ref} does not exist in the LanguageProfile`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });

    if (decision.identity.status === "validated") {
      const hasProfileEvidence = decision.evidence.profileClaimRefs.length > 0;
      const hasExternalEvidence = decision.evidence.externalEvidenceRefs.length > 0;
      if (!hasProfileEvidence && !hasExternalEvidence) {
        issues.push(
          validationIssue(
            "VALIDATED_DECISION_WITHOUT_EVIDENCE",
            `decisions.${decisionIndex}.evidence`,
            "Validated decisions require profile claims or external evidence",
          ),
        );
      }
    }
  });
}

export function validateLanguageDecisionRegistry(
  input: unknown,
  context: LanguageDecisionValidationContext = {},
): ValidationResult {
  const parsed = languageDecisionRegistrySchema.safeParse(input);
  if (!parsed.success) {
    return validationResult(zodIssuesToValidationIssues(parsed.error));
  }

  const registry = parsed.data;
  const issues: ValidationIssue[] = [];
  const decisionByKey = new Map<string, LanguageDecision>();
  const seenDecisionRefs = new Set<string>();

  registry.decisions.forEach((decision, index) => {
    const key = languageDecisionRefKey(decisionRef(decision));
    pushDuplicateIssue(
      issues,
      seenDecisionRefs,
      key,
      `decisions.${index}.identity`,
      "decision reference",
    );
    decisionByKey.set(key, decision);

    const productive = new Set(decision.resolution.productiveRange);
    const recognition = new Set(decision.resolution.recognitionRange);
    for (const ref of productive) {
      if (!recognition.has(ref)) {
        issues.push(
          validationIssue(
            "PRODUCTIVE_RANGE_EXCEEDS_RECOGNITION_RANGE",
            `decisions.${index}.resolution.productiveRange`,
            `Productive item ${ref} is not present in recognitionRange`,
            { relatedRefs: [ref] },
          ),
        );
      }
    }
    for (const ref of decision.resolution.deferredScope) {
      if (productive.has(ref)) {
        issues.push(
          validationIssue(
            "DEFERRED_SCOPE_IS_PRODUCTIVE",
            `decisions.${index}.resolution.deferredScope`,
            `Deferred item ${ref} cannot be productive`,
            { relatedRefs: [ref] },
          ),
        );
      }
    }

    const validFor = decision.compatibility.validFor;
    if (
      validFor.languageId !== registry.identity.languageId ||
      validFor.varietyId !== registry.identity.varietyId ||
      validFor.curriculumId !== registry.identity.curriculumId
    ) {
      issues.push(
        validationIssue(
          "DECISION_COMPATIBILITY_IDENTITY_MISMATCH",
          `decisions.${index}.compatibility.validFor`,
          "Decision compatibility identity must match registry identity",
        ),
      );
    }

    if (
      decision.identity.status === "validated" &&
      (decision.evidence.confidence === "low" ||
        decision.evidence.confidence === "contested" ||
        decision.evidence.reviewStatus === "needs_review" ||
        decision.evidence.reviewStatus === "machine_synthesized")
    ) {
      issues.push(
        validationIssue(
          "VALIDATED_DECISION_HAS_INSUFFICIENT_EVIDENCE",
          `decisions.${index}.evidence`,
          "Validated decisions require at least medium non-contested evidence that has been cross-checked or human-reviewed",
        ),
      );
    }
  });

  const expectedEdges: z.infer<typeof dependencyEdgeSchema>[] = [];
  registry.decisions.forEach((decision, decisionIndex) => {
    const from = decisionRef(decision);
    const dependencies = [
      ...decision.dependencies.requiresDecisionRefs.map((to) => ({
        to,
        relation: "requires" as const,
      })),
      ...decision.dependencies.benefitsFromDecisionRefs.map((to) => ({
        to,
        relation: "benefits_from" as const,
      })),
    ];

    dependencies.forEach(({ to, relation }, dependencyIndex) => {
      const targetKey = languageDecisionRefKey(to);
      const target = decisionByKey.get(targetKey);
      if (!target) {
        issues.push(
          validationIssue(
            "BROKEN_DECISION_REFERENCE",
            `decisions.${decisionIndex}.dependencies.${dependencyIndex}`,
            `Decision dependency ${targetKey} does not exist`,
            { relatedRefs: [targetKey] },
          ),
        );
      } else if (
        relation === "requires" &&
        decision.identity.status === "validated" &&
        target.identity.status !== "validated"
      ) {
        issues.push(
          validationIssue(
            "VALIDATED_DECISION_REQUIRES_UNVALIDATED_DECISION",
            `decisions.${decisionIndex}.dependencies.requiresDecisionRefs`,
            `Validated decision cannot require ${targetKey} with status ${target.identity.status}`,
            { relatedRefs: [targetKey] },
          ),
        );
      }
      expectedEdges.push({ from, to, relation });
    });

    const supersedes = decision.lifecycle.supersedes;
    if (supersedes) {
      const targetKey = languageDecisionRefKey(supersedes);
      const target = decisionByKey.get(targetKey);
      if (!target) {
        issues.push(
          validationIssue(
            "BROKEN_SUPERSESSION_REFERENCE",
            `decisions.${decisionIndex}.lifecycle.supersedes`,
            `Superseded decision ${targetKey} does not exist`,
            { relatedRefs: [targetKey] },
          ),
        );
      } else {
        if (target.identity.decisionId !== decision.identity.decisionId) {
          issues.push(
            validationIssue(
              "SUPERSESSION_ID_MISMATCH",
              `decisions.${decisionIndex}.lifecycle.supersedes`,
              "A new decision version may supersede only the same stable decisionId",
            ),
          );
        }
        if (
          compareSemver(decision.identity.decisionVersion, target.identity.decisionVersion) <= 0
        ) {
          issues.push(
            validationIssue(
              "SUPERSESSION_VERSION_NOT_NEWER",
              `decisions.${decisionIndex}.identity.decisionVersion`,
              "Superseding decisionVersion must be newer than the superseded version",
            ),
          );
        }
        if (target.identity.status !== "superseded") {
          issues.push(
            validationIssue(
              "SUPERSEDED_TARGET_STATUS_MISMATCH",
              `decisions.${decisionIndex}.lifecycle.supersedes`,
              "A superseded target must carry status superseded",
            ),
          );
        }
      }
    }
  });

  registry.decisions.forEach((decision, decisionIndex) => {
    if (decision.identity.status !== "superseded") return;
    const key = languageDecisionRefKey(decisionRef(decision));
    const hasReplacement = registry.decisions.some(
      (candidate) =>
        candidate.lifecycle.supersedes &&
        languageDecisionRefKey(candidate.lifecycle.supersedes) === key,
    );
    if (!hasReplacement) {
      issues.push(
        validationIssue(
          "SUPERSEDED_DECISION_WITHOUT_REPLACEMENT",
          `decisions.${decisionIndex}.identity.status`,
          `Superseded decision ${key} has no replacement in the registry`,
          { relatedRefs: [key] },
        ),
      );
    }
  });

  const graphNodeKeys = registry.dependencyGraph.nodes.map(languageDecisionRefKey);
  const graphNodeSet = new Set(graphNodeKeys);
  const decisionKeys = registry.decisions.map((decision) =>
    languageDecisionRefKey(decisionRef(decision)),
  );
  if (
    graphNodeSet.size !== graphNodeKeys.length ||
    graphNodeSet.size !== decisionKeys.length ||
    decisionKeys.some((key) => !graphNodeSet.has(key))
  ) {
    issues.push(
      validationIssue(
        "DEPENDENCY_GRAPH_NODE_MISMATCH",
        "dependencyGraph.nodes",
        "Dependency graph nodes must exactly match registry decision versions",
      ),
    );
  }

  const graphEdgeKeys = registry.dependencyGraph.edges.map(edgeKey).sort();
  const expectedEdgeKeys = expectedEdges.map(edgeKey).sort();
  if (
    graphEdgeKeys.length !== new Set(graphEdgeKeys).size ||
    graphEdgeKeys.join("|") !== expectedEdgeKeys.join("|")
  ) {
    issues.push(
      validationIssue(
        "DEPENDENCY_GRAPH_EDGE_MISMATCH",
        "dependencyGraph.edges",
        "Dependency graph edges must exactly reflect decision dependency declarations",
      ),
    );
  }

  const hardEdges = expectedEdges
    .filter((edge) => edge.relation === "requires")
    .map((edge) => ({
      from: languageDecisionRefKey(edge.from),
      to: languageDecisionRefKey(edge.to),
    }));
  const cycle = findDirectedCycle(decisionKeys, hardEdges);
  if (cycle) {
    issues.push(
      validationIssue(
        "CYCLE_DETECTED",
        "dependencyGraph.edges",
        `Hard decision dependency cycle detected: ${cycle.join(" -> ")}`,
        { relatedRefs: cycle },
      ),
    );
  }

  if (context.languageProfile) {
    const profileParsed = languageProfileSchema.safeParse(context.languageProfile);
    if (!profileParsed.success) {
      issues.push(
        validationIssue(
          "INVALID_LANGUAGE_PROFILE_CONTEXT",
          "context.languageProfile",
          "LanguageProfile validation context is structurally invalid",
        ),
      );
    } else {
      validateProfileGrounding(registry, profileParsed.data, issues);
    }
  } else if (registry.validation.strictProfileGrounding) {
    issues.push(
      validationIssue(
        "MISSING_LANGUAGE_PROFILE_CONTEXT",
        "validation.strictProfileGrounding",
        "Strict profile grounding requires a LanguageProfile validation context",
      ),
    );
  }

  return validationResult(issues);
}

export const decisionReuseModeSchema = z.enum(["reuse", "extend", "none"]);
export type DecisionReuseMode = z.infer<typeof decisionReuseModeSchema>;

export type DecisionResolutionRequest = {
  adaptationRequirementRef: string;
  levelScope?: string;
  unitScope?: string;
  taskScope?: string;
};

export type DecisionResolutionResult = {
  mode: DecisionReuseMode;
  decisionRef?: LanguageDecisionRef;
  reason: string;
};

function scopeMatches(
  decision: LanguageDecision,
  request: DecisionResolutionRequest,
): boolean {
  if (decision.scope.scopeType === "language_global") return true;
  if (decision.scope.scopeType === "level_global") {
    return decision.scope.levelScope === request.levelScope;
  }
  if (decision.scope.scopeType === "unit_contextual") {
    return decision.scope.unitScope === request.unitScope;
  }
  return decision.scope.taskScope === request.taskScope;
}

export function resolveRegistryDecision(
  registry: LanguageDecisionRegistry,
  request: DecisionResolutionRequest,
): DecisionResolutionResult {
  const candidates = registry.decisions
    .filter(
      (decision) =>
        decision.identity.status === "validated" &&
        decision.trigger.adaptationRequirementRefs.includes(
          request.adaptationRequirementRef,
        ),
    )
    .sort((left, right) =>
      compareSemver(
        right.identity.decisionVersion,
        left.identity.decisionVersion,
      ),
    );

  const reusable = candidates.find((decision) => scopeMatches(decision, request));
  if (reusable) {
    return {
      mode: "reuse",
      decisionRef: decisionRef(reusable),
      reason: "Validated decision covers the requested adaptation scope.",
    };
  }

  const extendable = candidates.find(
    (decision) =>
      decision.compatibility.extensionPolicy === "extend_if_scope_expands",
  );
  if (extendable) {
    return {
      mode: "extend",
      decisionRef: decisionRef(extendable),
      reason: "A validated decision exists but its scope must be extended.",
    };
  }

  return {
    mode: "none",
    reason: "No compatible validated decision exists for this requirement.",
  };
}
