import {
  compileInitialAdaptationPlan,
  validateAdaptationPlan,
  type AdaptationPlan,
  type AdaptationCompilationInput,
} from "../adaptation/adaptation-plan.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import {
  languageDecisionRefKey,
  type LanguageDecision,
  type LanguageDecisionRef,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import type { LanguageProfile } from "../profile/language-profile.js";

export type AdaptationResolutionStage =
  | "awaiting_decision_review"
  | "awaiting_profile_research"
  | "awaiting_external_research"
  | "awaiting_upstream_research"
  | "ready_for_planning";

export type AdaptationResolutionAction =
  | {
      stage: "awaiting_decision_review";
      researchTaskRef: string;
    }
  | {
      stage: "awaiting_profile_research";
      researchTaskRefs: string[];
    }
  | {
      stage: "awaiting_external_research";
      researchTaskRefs: string[];
    }
  | {
      stage: "ready_for_planning";
    };

const PROFILE_SECTION_BY_DOMAIN = {
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
} as const satisfies Record<string, keyof LanguageProfile>;

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

function uniqueDecisionRefs(refs: LanguageDecisionRef[]) {
  const map = new Map<string, LanguageDecisionRef>();
  for (const ref of refs) map.set(languageDecisionRefKey(ref), ref);
  return [...map.values()];
}

function collectFeatureIds(value: unknown, target = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectFeatureIds(entry, target);
    return target;
  }
  if (!value || typeof value !== "object") return target;
  const record = value as Record<string, unknown>;
  if (typeof record.featureId === "string") target.add(record.featureId);
  for (const entry of Object.values(record)) collectFeatureIds(entry, target);
  return target;
}

/**
 * M11 promotion requires actual LanguageProfile claims, not merely reviewed
 * section coverage. Before paying for registry reasoning, M13 checks that each
 * linked gap has at least one cross-checked/human-reviewed, non-low-confidence
 * claim inside the Profile section responsible for that requirement.
 */
export function hasPromotableProfileEvidenceForTask(input: {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  plan: AdaptationPlan;
  researchTaskRef: string;
}) {
  const task = input.plan.researchPlan.find(
    (entry) => entry.researchTaskId === input.researchTaskRef,
  );
  if (!task) return false;
  const gapById = new Map(input.plan.gapAnalysis.map((gap) => [gap.gapId, gap] as const));
  const requirementById = new Map(
    input.curriculum.adaptationRequirements.map((requirement) => [
      requirement.requirementId,
      requirement,
    ] as const),
  );
  const eligibleClaimFeatureRefs = new Set(
    input.languageProfile.evidenceRegistry.claims
      .filter(
        (claim) =>
          claim.confidence !== "low" &&
          (claim.reviewStatus === "cross_checked" ||
            claim.reviewStatus === "human_reviewed"),
      )
      .map((claim) => claim.featureRef),
  );

  for (const gapRef of task.gapRefs) {
    const gap = gapById.get(gapRef);
    const requirement = gap ? requirementById.get(gap.requirementRef) : undefined;
    if (!requirement) return false;
    const section = PROFILE_SECTION_BY_DOMAIN[
      requirement.domain as keyof typeof PROFILE_SECTION_BY_DOMAIN
    ];
    if (!section) return false;
    const sectionFeatureIds = collectFeatureIds(input.languageProfile[section]);
    if (![...sectionFeatureIds].some((featureId) => eligibleClaimFeatureRefs.has(featureId))) {
      return false;
    }
  }
  return true;
}

function requirementDecisionRefs(
  curriculum: CurriculumUnitSpec,
  plan: AdaptationPlan,
  registry: LanguageDecisionRegistry,
  domainPrefix?: string,
) {
  const requirementById = new Map(
    curriculum.adaptationRequirements.map((requirement) => [
      requirement.requirementId,
      requirement,
    ] as const),
  );

  return uniqueDecisionRefs(
    plan.requirementResolution.flatMap((resolution) => {
      if (!resolution.decisionRef) return [];
      const requirement = requirementById.get(resolution.requirementRef);
      if (!requirement) return [];
      if (domainPrefix && !requirement.domain.startsWith(domainPrefix)) return [];
      const decision = decisionByRef(registry, resolution.decisionRef);
      if (!decision || decision.identity.status !== "validated") return [];
      return [resolution.decisionRef];
    }),
  );
}

function routeTransformations(registry: LanguageDecisionRegistry, refs: LanguageDecisionRef[]) {
  const actionByEffect = {
    merge_candidate: "merge",
    expand: "split",
    insert_microstep: "insert",
    reorder_candidate: "reorder",
  } as const;

  return refs.flatMap((ref, index) => {
    const decision = decisionByRef(registry, ref);
    if (!decision) return [];
    const effect = decision.granularityImpact.effect;
    if (effect === "none" || decision.granularityImpact.affectedStepRefs.length === 0) {
      return [];
    }
    const action = actionByEffect[effect];
    return [
      {
        transformationId: `transform.${index + 1}`,
        action,
        sourceStepRefs: decision.granularityImpact.affectedStepRefs,
        decisionRefs: [ref],
        justification: decision.granularityImpact.reason,
      },
    ];
  });
}

/**
 * M4 intentionally emits an initial deterministic plan with a fixed compiler
 * version. M13 pins the plan version to the immutable Registry snapshot that
 * produced it, so every durable resolution cycle has a unique semantic input
 * binding without changing M4's frozen compiler contract.
 */
export function compileVersionedAdaptationPlan(
  input: AdaptationCompilationInput,
): AdaptationPlan {
  const compilation = compileInitialAdaptationPlan(input);
  if (!compilation.plan) {
    throw new Error(
      `adaptation_compilation_invalid:${compilation.validation.issues
        .map((issue) => issue.code)
        .join(",")}`,
    );
  }

  const plan = structuredClone(compilation.plan);
  plan.version = input.registry.version;
  const validation = validateAdaptationPlan(plan, input);
  if (!validation.valid) {
    throw new Error(
      `versioned_adaptation_plan_invalid:${validation.issues
        .map((issue) => issue.code)
        .join(",")}`,
    );
  }
  return plan;
}

export function selectAdaptationResolutionAction(
  plan: AdaptationPlan,
): AdaptationResolutionAction {
  if (plan.gapAnalysis.length === 0) {
    return { stage: "ready_for_planning" };
  }

  const external = plan.researchPlan
    .filter((task) => task.researchNecessity === "external_research")
    .map((task) => task.researchTaskId)
    .sort();
  if (external.length > 0) {
    return { stage: "awaiting_external_research", researchTaskRefs: external };
  }

  const profile = plan.researchPlan
    .filter((task) => task.researchNecessity === "profile_only")
    .map((task) => task.researchTaskId)
    .sort();
  if (profile.length > 0) {
    return { stage: "awaiting_profile_research", researchTaskRefs: profile };
  }

  const registry = plan.researchPlan
    .filter((task) => task.researchNecessity === "registry_reasoning")
    .sort((left, right) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return rank[left.priority] - rank[right.priority]
        || left.researchTaskId.localeCompare(right.researchTaskId);
    });
  const next = registry[0];
  if (!next) {
    return { stage: "awaiting_profile_research", researchTaskRefs: [] };
  }
  return {
    stage: "awaiting_decision_review",
    researchTaskRef: next.researchTaskId,
  };
}

export function finalizeResolvedAdaptationPlan(input: {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  registry: LanguageDecisionRegistry;
  plan: AdaptationPlan;
}): AdaptationPlan {
  const initialValidation = validateAdaptationPlan(input.plan, {
    curriculum: input.curriculum,
    languageProfile: input.languageProfile,
    registry: input.registry,
  });
  if (!initialValidation.valid) {
    throw new Error(
      `adaptation_plan_invalid:${initialValidation.issues
        .map((issue) => issue.code)
        .join(",")}`,
    );
  }
  if (input.plan.gapAnalysis.length > 0) {
    throw new Error("adaptation_plan_has_open_gaps");
  }

  for (const resolution of input.plan.requirementResolution) {
    if (resolution.resolutionMode === "not_applicable") continue;
    if (resolution.resolutionMode !== "reuse" || !resolution.decisionRef) {
      throw new Error(`unresolved_requirement:${resolution.requirementRef}`);
    }
    const decision = decisionByRef(input.registry, resolution.decisionRef);
    if (!decision || decision.identity.status !== "validated") {
      throw new Error(`unvalidated_decision:${resolution.requirementRef}`);
    }
  }

  const plan = structuredClone(input.plan);
  const allDecisionRefs = requirementDecisionRefs(
    input.curriculum,
    plan,
    input.registry,
  );
  const pronunciationRefs = requirementDecisionRefs(
    input.curriculum,
    plan,
    input.registry,
    "phonology.",
  );
  const literacyRefs = requirementDecisionRefs(
    input.curriculum,
    plan,
    input.registry,
    "writing.",
  );
  const localizationRefs = requirementDecisionRefs(
    input.curriculum,
    plan,
    input.registry,
    "localization.",
  );

  plan.instructionalResolution = {
    status: "resolved",
    decisionRefs: allDecisionRefs,
    notes: ["All adaptation requirements are backed by validated language decisions."],
  };
  plan.pronunciationResolution = pronunciationRefs.length > 0
    ? {
        status: "resolved",
        decisionRefs: pronunciationRefs,
        notes: ["Pronunciation requirements are resolved by validated decisions."],
      }
    : {
        status: "not_applicable",
        decisionRefs: [],
        notes: ["This unit declares no pronunciation-specific adaptation requirement."],
      };
  plan.literacyResolution = literacyRefs.length > 0
    ? {
        status: "resolved",
        decisionRefs: literacyRefs,
        notes: ["Literacy requirements are resolved by validated decisions."],
      }
    : {
        status: "not_applicable",
        decisionRefs: [],
        notes: ["This unit declares no writing-system adaptation requirement."],
      };
  plan.localizationResolution = localizationRefs.length > 0
    ? {
        status: "resolved",
        decisionRefs: localizationRefs,
        notes: ["Localization requirements are resolved by validated decisions."],
      }
    : {
        status: "not_applicable",
        decisionRefs: [],
        notes: ["This unit declares no localization-specific adaptation requirement."],
      };
  plan.routeTransformationPlan = routeTransformations(input.registry, allDecisionRefs);
  plan.coverageAudit = {
    status: "pass",
    findings: ["Every adaptation requirement is resolved without deleting curriculum capability."],
  };
  plan.projectionAudit = {
    status: "pass",
    findings: ["Every target-language realization is grounded in validated Registry decisions."],
  };
  plan.consistencyAudit = {
    status: "pass",
    findings: ["Curriculum, LanguageProfile, Registry and AdaptationPlan references are consistent."],
  };
  plan.outputs = {
    adaptedUnitSpecRef: {
      id: `adapted.${input.curriculum.identity.unitId}.${input.languageProfile.identity.varietyId}`,
      version: "1.0.0",
    },
    routeReady: true,
  };
  plan.readiness = {
    state: "ready",
    blockingGapRefs: [],
    notes: ["M13 closed all adaptation requirements and passed deterministic audits."],
  };
  plan.status = "ready";

  const finalValidation = validateAdaptationPlan(plan, {
    curriculum: input.curriculum,
    languageProfile: input.languageProfile,
    registry: input.registry,
  });
  if (!finalValidation.valid) {
    throw new Error(
      `final_adaptation_plan_invalid:${finalValidation.issues
        .map((issue) => issue.code)
        .join(",")}`,
    );
  }
  return plan;
}
