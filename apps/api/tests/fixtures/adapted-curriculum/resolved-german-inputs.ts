import {
  compileInitialAdaptationPlan,
  type AdaptationPlan,
} from "../../../src/languages/adaptation/adaptation-plan.js";
import type {
  LanguageDecision,
  LanguageDecisionRegistry,
} from "../../../src/languages/decisions/language-decision-registry.js";
import { a1U01CurriculumFixture } from "../language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "../language-decisions/german.js";
import { germanLanguageProfileFixture } from "../language-profile/german.js";

const curriculumRef = { id: "A1-U01", version: "1.0.0" } as const;

function makeDecision(input: {
  id: string;
  domain: string;
  requirementRef: string;
  featureRefs: string[];
  scopeType: "language_global" | "level_global" | "unit_contextual";
  recognition: string[];
  productive: string[];
  deferred?: string[];
}): LanguageDecision {
  const scope =
    input.scopeType === "language_global"
      ? { scopeType: "language_global" as const }
      : input.scopeType === "level_global"
        ? { scopeType: "level_global" as const, levelScope: "A1" }
        : { scopeType: "unit_contextual" as const, unitScope: "A1-U01" };

  return {
    identity: {
      decisionId: input.id,
      decisionVersion: "1.0.0",
      decisionKind: "pedagogical_strategy",
      domain: input.domain,
      status: "validated",
    },
    semanticTarget: {
      semanticProblem: `Resolve ${input.domain} for the German A1 runtime fixture.`,
      conceptRefs: [],
      functionRefs: [],
      capabilityRefs: [],
    },
    scope,
    trigger: {
      adaptationRequirementRefs: [input.requirementRef],
      firstRequiredBy: {
        curriculumUnitRef: curriculumRef,
        requirementRef: input.requirementRef,
      },
      reason: `The target-language profile requires an explicit ${input.domain} strategy.`,
    },
    languageBasis: {
      featureRefs: input.featureRefs,
      mechanismRefs: [],
      claimRefs: [],
      relevantFacts: [
        `The selected German profile features constrain ${input.domain} without projecting source-language categories.`,
      ],
    },
    resolution: {
      resolutionSummary: `Use a bounded high-frequency German A1 realization for ${input.domain}.`,
      selectedMechanisms: [],
      recognitionRange: input.recognition,
      productiveRange: input.productive,
      alternatives: [],
      deferredScope: input.deferred ?? [],
      contextConditions: ["Bounded A1 first-contact and everyday contexts."],
    },
    learnerContract: {
      inputExpectation: `Recognize the selected ${input.domain} range in familiar A1 input.`,
      outputExpectation: `Use the selected productive ${input.domain} core in bounded A1 tasks.`,
      masteryExpectation: `Complete the communicative mission without relying on deferred ${input.domain} scope.`,
      tolerance: {
        acceptedVariation: ["Natural neutral-standard alternatives that preserve meaning."],
        blockingErrors: ["Errors that destroy the intended communicative relation."],
        nonBlockingErrors: ["Secondary form errors outside the active target."],
      },
      supportPolicy: {
        initialSupport: "guided",
        withdrawalCondition: "The learner succeeds repeatedly in similar bounded tasks.",
        terminalSupportCeiling: "scaffolded",
      },
    },
    instructionConstraints: {
      policyFlags: ["function_before_description", "high_frequency_subset"],
      forbiddenAssumptions: ["Do not project a source-language grammatical category as curriculum."],
      crossLinguisticWarnings: ["Treat this as a German realization, not a universal learning objective."],
    },
    granularityImpact: {
      effect: "none",
      affectedStepRefs: [],
      reason: "The decision fits the recommended A1 route without mandatory extra sessions.",
      severity: "minor",
    },
    dependencies: {
      requiresDecisionRefs: [],
      benefitsFromDecisionRefs: [],
    },
    compatibility: {
      validFor: {
        languageId: "de",
        varietyId: "de.standard",
        curriculumId: "memoos-core-language",
        levelScopes: ["A1"],
        unitScopes: input.scopeType === "unit_contextual" ? ["A1-U01"] : [],
        taskScopes: [],
      },
      extensionPolicy: "extend_if_scope_expands",
      backwardCompatibility: "fully_compatible",
    },
    evidence: {
      profileClaimRefs: [],
      externalEvidenceRefs: ["fixture.reference"],
      reasoningSummary: `M5 fixture decision grounded in reviewed German profile features for ${input.domain}.`,
      confidence: "high",
      reviewStatus: "cross_checked",
    },
    lifecycle: {
      createdFrom: {
        sourceType: "profile_reasoning",
        sourceRefs: input.featureRefs,
      },
    },
  };
}

const additionalDecisions: LanguageDecision[] = [
  makeDecision({
    id: "writing.beginner_strategy",
    domain: "writing.beginner_system",
    requirementRef: "AR01",
    featureRefs: ["de.writing.diacritics"],
    scopeType: "language_global",
    recognition: ["de.script.basic_recognition"],
    productive: ["de.script.basic_production"],
  }),
  makeDecision({
    id: "phonology.initial_focus.a1",
    domain: "phonology.initial_intelligibility",
    requirementRef: "AR02",
    featureRefs: ["de.phonology.length", "de.phonology.intelligibility.vowel_length"],
    scopeType: "level_global",
    recognition: ["de.phonology.vowel_length.recognition"],
    productive: ["de.phonology.vowel_length.guided"],
    deferred: ["de.phonology.native_like_precision"],
  }),
  makeDecision({
    id: "nominal.beginner_package.a1",
    domain: "nominal.beginner_package",
    requirementRef: "AR05",
    featureRefs: [
      "de.nominal.gender",
      "de.nominal.number",
      "de.nominal.case",
      "de.nominal.determiners",
    ],
    scopeType: "level_global",
    recognition: ["de.nominal.article_gender_case_package"],
    productive: ["de.nominal.high_frequency_package"],
    deferred: ["de.nominal.full_case_paradigm"],
  }),
  makeDecision({
    id: "predication.identity_state.a1",
    domain: "predication.identity_state",
    requirementRef: "AR06",
    featureRefs: [
      "de.predication.identity",
      "de.predication.property",
      "de.predication.state",
    ],
    scopeType: "level_global",
    recognition: ["de.predication.identity", "de.predication.state", "de.predication.property"],
    productive: ["de.predication.identity", "de.predication.state"],
    deferred: ["de.predication.low_frequency_variants"],
  }),
  makeDecision({
    id: "age.expression.a1",
    domain: "age.basic_expression",
    requirementRef: "AR07",
    featureRefs: ["de.semantic.age", "de.semantic.numerals"],
    scopeType: "unit_contextual",
    recognition: ["de.age.question", "de.age.answer"],
    productive: ["de.age.question", "de.age.answer"],
  }),
  makeDecision({
    id: "possession.basic.a1",
    domain: "possession.basic",
    requirementRef: "AR08",
    featureRefs: ["de.semantic.possession", "de.nominal.possession"],
    scopeType: "level_global",
    recognition: ["de.possession.basic"],
    productive: ["de.possession.basic"],
    deferred: ["de.possession.genitive_productive"],
  }),
  makeDecision({
    id: "action.basic_pattern.a1",
    domain: "action.basic_pattern",
    requirementRef: "AR09",
    featureRefs: ["de.verbal.person", "de.verbal.tense"],
    scopeType: "level_global",
    recognition: ["de.action.present_high_frequency"],
    productive: ["de.action.present_high_frequency"],
    deferred: ["de.verbal.full_person_paradigm"],
  }),
  makeDecision({
    id: "localization.first_contact.de",
    domain: "localization.first_contact",
    requirementRef: "AR10",
    featureRefs: ["de.social.naming", "de.social.interaction"],
    scopeType: "unit_contextual",
    recognition: ["de.first_contact.neutral_standard"],
    productive: ["de.first_contact.neutral_standard"],
  }),
];

export const germanM5DecisionRegistryFixture: LanguageDecisionRegistry = {
  ...structuredClone(germanDecisionRegistryFixture),
  coverage: {
    levelScopes: ["A1"],
    unitScopes: ["A1-U01"],
    requirementDomains: [
      "writing.beginner_system",
      "phonology.initial_intelligibility",
      "sociolinguistics.initial_register",
      "participant.basic_reference",
      "nominal.beginner_package",
      "predication.identity_state",
      "age.basic_expression",
      "possession.basic",
      "action.basic_pattern",
      "localization.first_contact",
    ],
    notes: ["Resolved M5 registry fixture covering every A1-U01 adaptation requirement."],
  },
  decisions: [
    ...structuredClone(germanDecisionRegistryFixture.decisions),
    ...additionalDecisions,
  ],
  dependencyGraph: {
    nodes: [
      ...structuredClone(germanDecisionRegistryFixture.decisions),
      ...additionalDecisions,
    ].map((decision) => ({
      id: decision.identity.decisionId,
      version: decision.identity.decisionVersion,
    })),
    edges: [],
  },
  version: "1.1.0",
  status: "draft",
};

export function buildReadyGermanAdaptationPlanFixture(): AdaptationPlan {
  const compilation = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
  });
  if (!compilation.plan) {
    throw new Error(`Unable to build M5 adaptation fixture: ${JSON.stringify(compilation.validation.issues)}`);
  }
  const plan = structuredClone(compilation.plan);
  const reused = plan.decisionChanges.reusedDecisionRefs;
  plan.instructionalResolution = {
    status: "resolved",
    decisionRefs: reused,
    notes: ["All A1-U01 instructional adaptation requirements are resolved in the fixture registry."],
  };
  plan.pronunciationResolution = {
    status: "resolved",
    decisionRefs: [{ id: "phonology.initial_focus.a1", version: "1.0.0" }],
    notes: ["Initial pronunciation focus resolved."],
  };
  plan.literacyResolution = {
    status: "resolved",
    decisionRefs: [{ id: "writing.beginner_strategy", version: "1.0.0" }],
    notes: ["Beginner literacy strategy resolved."],
  };
  plan.localizationResolution = {
    status: "resolved",
    decisionRefs: [{ id: "localization.first_contact.de", version: "1.0.0" }],
    notes: ["First-contact localization resolved."],
  };
  plan.coverageAudit = { status: "pass", findings: [] };
  plan.projectionAudit = { status: "pass", findings: [] };
  plan.consistencyAudit = { status: "pass", findings: [] };
  plan.outputs = {
    adaptedUnitSpecRef: { id: "adapted.A1-U01.de.standard", version: "1.0.0" },
    routeReady: true,
  };
  plan.readiness = {
    state: "ready",
    blockingGapRefs: [],
    notes: ["M5 golden fixture is fully resolved and audited."],
  };
  plan.status = "ready";
  return plan;
}
