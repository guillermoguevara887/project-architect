import type { LanguageDecisionRegistry } from "../../../src/languages/decisions/language-decision-registry.js";

export const germanDecisionRegistryFixture: LanguageDecisionRegistry = {
  identity: {
    registryId: "decision-registry.de.standard.memoos",
    languageId: "de",
    varietyId: "de.standard",
    curriculumId: "memoos-core-language",
  },
  coverage: {
    levelScopes: ["A1"],
    unitScopes: ["A1-U01"],
    requirementDomains: ["participant.reference", "sociolinguistics.initial_register"],
    notes: ["Golden M3 registry fixture for first-contact German decisions."],
  },
  decisions: [
    {
      identity: {
        decisionId: "participant.actor_affected",
        decisionVersion: "1.0.0",
        decisionKind: "structural_interpretation",
        domain: "participant.reference",
        status: "validated",
      },
      semanticTarget: {
        semanticProblem: "Distinguish actor and affected participant without projecting source-language grammar.",
        conceptRefs: ["actor", "affected_entity"],
        functionRefs: ["participant_identification", "relation_action"],
        capabilityRefs: ["C06", "C07"],
      },
      scope: {
        scopeType: "level_global",
        levelScope: "A1",
      },
      trigger: {
        adaptationRequirementRefs: ["AR04"],
        firstRequiredBy: {
          curriculumUnitRef: { id: "A1-U01", version: "1.0.0" },
          requirementRef: "AR04",
        },
        reason: "German overtly marks participant relations through case, word order and agreement-related cues.",
      },
      languageBasis: {
        featureRefs: ["de.nominal.case", "de.clause.order_flexibility"],
        mechanismRefs: [
          "de.mechanism.argument.case",
          "de.mechanism.argument.word_order",
        ],
        claimRefs: ["de.claim.case"],
        relevantFacts: [
          "Case and clause structure jointly contribute to participant-role interpretation.",
        ],
      },
      resolution: {
        resolutionSummary: "Teach actor/affected interpretation through high-frequency case-marked and canonical patterns before broader variation.",
        selectedMechanisms: [
          "de.mechanism.argument.case",
          "de.mechanism.argument.word_order",
        ],
        recognitionRange: ["de.role.actor", "de.role.affected"],
        productiveRange: ["de.role.actor", "de.role.affected"],
        alternatives: [],
        deferredScope: ["de.case.genitive.productive_a1"],
        contextConditions: ["Begin with familiar first-contact and everyday actions."],
      },
      learnerContract: {
        inputExpectation: "Recognize who acts and who is affected in bounded A1 clauses.",
        outputExpectation: "Produce basic clauses whose participant roles are interpretable.",
        masteryExpectation: "Maintain actor/affected distinctions in familiar guided and scaffolded interaction.",
        tolerance: {
          acceptedVariation: ["Minor article or ending errors that do not obscure participant roles."],
          blockingErrors: ["Role marking that reverses or destroys the intended participant relation."],
          nonBlockingErrors: ["Secondary agreement errors outside the lesson target."],
        },
        supportPolicy: {
          initialSupport: "guided",
          withdrawalCondition: "Learner consistently interprets and produces the core role contrast.",
          terminalSupportCeiling: "scaffolded",
        },
      },
      instructionConstraints: {
        policyFlags: ["function_before_paradigm", "high_frequency_subset"],
        forbiddenAssumptions: ["Do not equate actor with a fixed sentence position in every German clause."],
        crossLinguisticWarnings: ["Do not teach German case as if it were a universal curriculum category."],
      },
      granularityImpact: {
        effect: "expand",
        affectedStepRefs: ["S09", "S10", "S12"],
        reason: "Participant-role interpretation needs controlled exposure before integration.",
        severity: "moderate",
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
          unitScopes: [],
          taskScopes: [],
        },
        extensionPolicy: "extend_if_scope_expands",
        backwardCompatibility: "fully_compatible",
      },
      evidence: {
        profileClaimRefs: ["de.claim.case"],
        externalEvidenceRefs: [],
        reasoningSummary: "The productive subset follows the profile's systematic case marking while keeping the curriculum target semantic.",
        confidence: "high",
        reviewStatus: "cross_checked",
      },
      lifecycle: {
        createdFrom: {
          sourceType: "adaptation_requirement",
          sourceRefs: ["AR04"],
        },
      },
    },
    {
      identity: {
        decisionId: "social.register.initial",
        decisionVersion: "1.0.0",
        decisionKind: "pedagogical_strategy",
        domain: "sociolinguistics.initial_register",
        status: "validated",
      },
      semanticTarget: {
        semanticProblem: "Handle initial social distance and address choices appropriately at beginner level.",
        conceptRefs: ["social_distance"],
        functionRefs: ["open_interaction", "respond_to_opening", "close_interaction"],
        capabilityRefs: ["C01", "C08"],
      },
      scope: {
        scopeType: "level_global",
        levelScope: "A1",
      },
      trigger: {
        adaptationRequirementRefs: ["AR03"],
        firstRequiredBy: {
          curriculumUnitRef: { id: "A1-U01", version: "1.0.0" },
          requirementRef: "AR03",
        },
        reason: "German first-contact language requires a beginner-safe formal/informal address strategy.",
      },
      languageBasis: {
        featureRefs: ["de.reference.social", "de.social.register", "de.social.address"],
        mechanismRefs: [],
        claimRefs: [],
        relevantFacts: [
          "Second-person reference and address choices vary with relationship and setting.",
        ],
      },
      resolution: {
        resolutionSummary: "Teach a compact formal/informal recognition contrast and a small productive core for first contact.",
        selectedMechanisms: ["de.register.informal", "de.register.formal"],
        recognitionRange: ["de.register.informal", "de.register.formal"],
        productiveRange: ["de.register.informal", "de.register.formal"],
        alternatives: [],
        deferredScope: ["de.register.regionally_marked_variation"],
        contextConditions: ["Use neutral standard first-contact contexts."],
      },
      learnerContract: {
        inputExpectation: "Recognize basic formal versus informal address in familiar interaction.",
        outputExpectation: "Use an appropriate beginner-safe register in bounded first-contact exchanges.",
        masteryExpectation: "Avoid socially disruptive address choices while completing the interaction.",
        tolerance: {
          acceptedVariation: ["Natural neutral-standard alternatives within the selected register."],
          blockingErrors: ["Register choice that makes the interaction socially inappropriate for the bounded scenario."],
          nonBlockingErrors: ["Stylistic choices that remain socially acceptable."],
        },
        supportPolicy: {
          initialSupport: "guided",
          withdrawalCondition: "Learner selects the appropriate register reliably in familiar contexts.",
          terminalSupportCeiling: "scaffolded",
        },
      },
      instructionConstraints: {
        policyFlags: ["social_appropriateness_before_style"],
        forbiddenAssumptions: ["Do not treat formal/informal address as a universally binary system."],
        crossLinguisticWarnings: ["The German distinction is a language-specific realization of social distance."],
      },
      granularityImpact: {
        effect: "none",
        affectedStepRefs: ["S01", "S06", "S13"],
        reason: "The contrast can be integrated into existing first-contact steps.",
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
          unitScopes: [],
          taskScopes: [],
        },
        extensionPolicy: "extend_if_scope_expands",
        backwardCompatibility: "fully_compatible",
      },
      evidence: {
        profileClaimRefs: [],
        externalEvidenceRefs: ["fixture.reference"],
        reasoningSummary: "The strategy is grounded in the profile's social-reference, address and register features.",
        confidence: "high",
        reviewStatus: "cross_checked",
      },
      lifecycle: {
        createdFrom: {
          sourceType: "profile_reasoning",
          sourceRefs: ["de.reference.social", "de.social.register"],
        },
      },
    },
  ],
  dependencyGraph: {
    nodes: [
      { id: "participant.actor_affected", version: "1.0.0" },
      { id: "social.register.initial", version: "1.0.0" },
    ],
    edges: [],
  },
  validation: {
    requiredChecks: [
      "reference_integrity",
      "dependency_acyclicity",
      "profile_grounding",
      "recognition_production",
      "lifecycle_consistency",
      "compatibility",
    ],
    strictProfileGrounding: true,
  },
  version: "1.0.0",
  status: "draft",
};
