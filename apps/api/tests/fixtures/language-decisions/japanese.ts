import type { LanguageDecisionRegistry } from "../../../src/languages/decisions/language-decision-registry.js";

export const japaneseDecisionRegistryFixture: LanguageDecisionRegistry = {
  identity: {
    registryId: "decision-registry.ja.standard.memoos",
    languageId: "ja",
    varietyId: "ja.standard",
    curriculumId: "memoos-core-language",
  },
  coverage: {
    levelScopes: ["A1"],
    unitScopes: ["A1-U01"],
    requirementDomains: ["writing.beginner_system"],
    notes: ["Golden M3 fixture for beginner Japanese literacy strategy."],
  },
  decisions: [
    {
      identity: {
        decisionId: "writing.beginner_strategy",
        decisionVersion: "1.0.0",
        decisionKind: "pedagogical_strategy",
        domain: "writing.beginner_system",
        status: "validated",
      },
      semanticTarget: {
        semanticProblem: "Provide usable beginner literacy support without replacing the language's normal mixed-script system.",
        conceptRefs: ["written_form", "segmentation"],
        functionRefs: ["identify_written_forms"],
        capabilityRefs: ["C06", "C08"],
      },
      scope: {
        scopeType: "level_global",
        levelScope: "A1",
      },
      trigger: {
        adaptationRequirementRefs: ["AR01"],
        firstRequiredBy: {
          curriculumUnitRef: { id: "A1-U01", version: "1.0.0" },
          requirementRef: "AR01",
        },
        reason: "Japanese basic literacy uses multiple scripts with no obligatory word spacing and mixed grapheme-sound transparency.",
      },
      languageBasis: {
        featureRefs: ["ja.writing.diacritics"],
        mechanismRefs: [],
        claimRefs: [],
        relevantFacts: [
          "Hiragana, katakana and kanji coexist in ordinary Japanese writing.",
          "Kana are comparatively transparent while kanji introduce multiple reading relationships.",
          "Word boundaries are not obligatorily marked with spaces.",
        ],
      },
      resolution: {
        resolutionSummary: "Use kana as the early productive literacy core, expose kanji incrementally for recognition, and allow romanization only as temporary support.",
        selectedMechanisms: [
          "ja.literacy.kana_productive_core",
          "ja.literacy.kanji_incremental_recognition",
          "ja.literacy.romaji_temporary_support",
        ],
        recognitionRange: [
          "ja.script.hiragana",
          "ja.script.katakana",
          "ja.script.kanji",
        ],
        productiveRange: ["ja.script.hiragana", "ja.script.katakana"],
        alternatives: [
          {
            alternativeId: "ja.literacy.romaji",
            description: "Romanization may appear as temporary learner support but is not the terminal literacy target.",
            status: "recognition_only",
            conditions: ["Use only while script recognition is still emerging."],
          },
        ],
        deferredScope: ["ja.script.kanji.extended_productive"],
        contextConditions: ["Prioritize high-frequency forms needed by the current unit."],
      },
      learnerContract: {
        inputExpectation: "Recognize bounded beginner forms in kana and an incremental set of high-frequency kanji.",
        outputExpectation: "Produce the lesson's authorized written core primarily in kana while script support is withdrawn progressively.",
        masteryExpectation: "Complete bounded A1 literacy tasks without dependence on romanization beyond the allowed support ceiling.",
        tolerance: {
          acceptedVariation: ["Kana-first spellings where the lesson has not yet authorized productive kanji."],
          blockingErrors: ["Dependence on romanization when the terminal task requires Japanese script recognition."],
          nonBlockingErrors: ["Kanji production omissions explicitly left in deferred scope."],
        },
        supportPolicy: {
          initialSupport: "highly_guided",
          withdrawalCondition: "Learner reliably recognizes the introduced kana and bounded high-frequency written forms.",
          terminalSupportCeiling: "scaffolded",
        },
      },
      instructionConstraints: {
        policyFlags: ["script_gradual_release", "recognition_before_full_production"],
        forbiddenAssumptions: ["Do not treat romanization as the target writing system."],
        crossLinguisticWarnings: ["Do not project alphabetic word-segmentation assumptions onto Japanese."],
      },
      granularityImpact: {
        effect: "expand",
        affectedStepRefs: ["S08", "S13"],
        reason: "Mixed-script literacy requires explicit staged exposure and support withdrawal.",
        severity: "major",
      },
      dependencies: {
        requiresDecisionRefs: [],
        benefitsFromDecisionRefs: [],
      },
      compatibility: {
        validFor: {
          languageId: "ja",
          varietyId: "ja.standard",
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
        reasoningSummary: "The strategy preserves the mixed-script facts in LanguageProfile while narrowing only the beginner productive burden.",
        confidence: "high",
        reviewStatus: "cross_checked",
      },
      lifecycle: {
        createdFrom: {
          sourceType: "profile_reasoning",
          sourceRefs: ["ja.script.hiragana", "ja.script.katakana", "ja.script.kanji"],
        },
      },
    },
  ],
  dependencyGraph: {
    nodes: [{ id: "writing.beginner_strategy", version: "1.0.0" }],
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
