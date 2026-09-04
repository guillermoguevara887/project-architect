import { z } from "zod";
import {
  confidenceSchema,
  domainIdSchema,
  requiredTextSchema,
  semanticVersionSchema,
} from "../curriculum/primitives.js";
import {
  validationIssue,
  validationResult,
  zodIssuesToValidationIssues,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";

export const profileCoverageDepthSchema = z.enum([
  "minimal",
  "A1_sufficient",
  "extended",
  "comprehensive",
]);
export const profileCoverageStatusSchema = z.enum([
  "unresolved",
  "partial",
  "resolved",
  "reviewed",
]);
export const languageFeatureApplicabilitySchema = z.enum([
  "systematic",
  "common",
  "restricted",
  "optional",
  "context_dependent",
  "not_applicable",
]);
export const languageFeatureVariationSchema = z.enum([
  "none_known",
  "regional",
  "register",
  "social",
  "lexical",
  "construction_specific",
]);
export const languageFeatureReviewStatusSchema = z.enum([
  "machine_synthesized",
  "cross_checked",
  "human_reviewed",
  "needs_review",
]);

const evidenceRefListSchema = z.array(domainIdSchema);
const languageMechanismSchema = z
  .object({
    mechanismId: domainIdSchema,
    role: requiredTextSchema,
    applicability: languageFeatureApplicabilitySchema,
    conditions: z.array(requiredTextSchema),
    variation: languageFeatureVariationSchema,
    evidenceRefs: evidenceRefListSchema,
  })
  .strict();

export const languageFeatureSchema = z
  .object({
    featureId: domainIdSchema,
    description: requiredTextSchema,
    applicability: languageFeatureApplicabilitySchema,
    values: z.array(requiredTextSchema),
    mechanisms: z.array(languageMechanismSchema),
    conditions: z.array(requiredTextSchema),
    variation: languageFeatureVariationSchema,
    confidence: confidenceSchema,
    evidenceRefs: evidenceRefListSchema,
    coverageDepth: profileCoverageDepthSchema,
    reviewStatus: languageFeatureReviewStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.applicability === "not_applicable" && value.values.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["values"],
        message: "not_applicable features cannot declare active values",
      });
    }
    if (
      value.applicability === "not_applicable" &&
      value.mechanisms.some((mechanism) => mechanism.applicability !== "not_applicable")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mechanisms"],
        message: "not_applicable features cannot declare active mechanisms",
      });
    }
  });
export type LanguageFeature = z.infer<typeof languageFeatureSchema>;

export const languageProfileSectionSchema = z.enum([
  "writingSystem",
  "phonology",
  "nominalSystem",
  "participantReference",
  "predicationSystem",
  "verbalSystem",
  "clauseStructure",
  "semanticSystems",
  "discourseSystem",
  "sociolinguisticSystem",
]);
export type LanguageProfileSection = z.infer<typeof languageProfileSectionSchema>;

const profileCoverageEntrySchema = z
  .object({
    section: languageProfileSectionSchema,
    coverageDepth: profileCoverageDepthSchema,
    coverageStatus: profileCoverageStatusSchema,
  })
  .strict();

const scriptSchema = z
  .object({
    scriptId: domainIdSchema,
    name: requiredTextSchema,
    family: z.enum([
      "latin",
      "cyrillic",
      "greek",
      "arabic",
      "hebrew",
      "han",
      "kana",
      "hangul",
      "devanagari",
      "thai",
      "other",
    ]),
    role: z.enum(["primary", "secondary", "auxiliary"]),
    usage: requiredTextSchema,
    requiredForBasicLiteracy: z.boolean(),
    coexistsWith: z.array(domainIdSchema),
    evidenceRefs: evidenceRefListSchema,
  })
  .strict();

const transliterationSystemSchema = z
  .object({
    systemId: domainIdSchema,
    name: requiredTextSchema,
    role: z.enum(["learner_support", "standard_romanization", "reference"]),
    targetScriptRefs: z.array(domainIdSchema).min(1),
    usage: requiredTextSchema,
    requiredForBasicLiteracy: z.boolean(),
    evidenceRefs: evidenceRefListSchema,
  })
  .strict();

const writingSystemSchema = z
  .object({
    scripts: z.array(scriptSchema).min(1),
    primaryScriptStrategy: z
      .object({
        strategy: z.enum(["single", "mixed", "contextual"]),
        scriptRefs: z.array(domainIdSchema).min(1),
      })
      .strict(),
    direction: z.enum(["ltr", "rtl", "vertical", "mixed"]),
    segmentation: z.enum([
      "space_delimited_words",
      "partial_spacing",
      "no_obligatory_word_spacing",
      "mixed",
      "other",
    ]),
    graphemeSoundRelationship: z
      .object({
        transparency: z.enum(["high", "moderate", "low", "mixed", "not_applicable"]),
        description: requiredTextSchema,
        evidenceRefs: evidenceRefListSchema,
      })
      .strict(),
    orthographicDepth: z.enum(["shallow", "moderate", "deep", "mixed", "not_applicable"]),
    diacritics: languageFeatureSchema,
    transliterationSystems: z.array(transliterationSystemSchema),
    literacyDependencies: z.array(requiredTextSchema),
  })
  .strict();

const phonologySchema = z
  .object({
    segmentalSystem: languageFeatureSchema,
    syllableStructure: languageFeatureSchema,
    stressSystem: languageFeatureSchema,
    lexicalToneSystem: languageFeatureSchema,
    lexicalPitchSystem: languageFeatureSchema,
    lengthContrasts: languageFeatureSchema,
    connectedSpeech: languageFeatureSchema,
    phonotacticConstraints: languageFeatureSchema,
    intelligibilityRelevantFeatures: z.array(languageFeatureSchema),
  })
  .strict();

const nominalSystemSchema = z
  .object({
    grammaticalGender: languageFeatureSchema,
    nounClasses: languageFeatureSchema,
    numberMarking: languageFeatureSchema,
    caseMarking: languageFeatureSchema,
    definiteness: languageFeatureSchema,
    articlesAndDeterminers: languageFeatureSchema,
    classifiers: languageFeatureSchema,
    modification: languageFeatureSchema,
    agreement: languageFeatureSchema,
    possessionWithinNP: languageFeatureSchema,
  })
  .strict();

const participantReferenceSchema = z
  .object({
    personDistinctions: languageFeatureSchema,
    numberDistinctions: languageFeatureSchema,
    genderDistinctions: languageFeatureSchema,
    animacyDistinctions: languageFeatureSchema,
    clusivity: languageFeatureSchema,
    socialDistinctions: languageFeatureSchema,
    pronounInventoryCharacteristics: languageFeatureSchema,
    zeroReference: languageFeatureSchema,
    nominalReference: languageFeatureSchema,
    demonstrativeReference: languageFeatureSchema,
    agreementBasedReference: languageFeatureSchema,
    referencePersistence: languageFeatureSchema,
  })
  .strict();

const predicationSystemSchema = z
  .object({
    identityPredication: languageFeatureSchema,
    propertyPredication: languageFeatureSchema,
    statePredication: languageFeatureSchema,
    locationPredication: languageFeatureSchema,
    existencePredication: languageFeatureSchema,
    possessionPredication: languageFeatureSchema,
  })
  .strict();

const verbalSystemSchema = z
  .object({
    personMarking: languageFeatureSchema,
    numberMarking: languageFeatureSchema,
    tense: languageFeatureSchema,
    aspect: languageFeatureSchema,
    mood: languageFeatureSchema,
    polarity: languageFeatureSchema,
    voice: languageFeatureSchema,
    politenessMarking: languageFeatureSchema,
    evidentiality: languageFeatureSchema,
    auxiliaries: languageFeatureSchema,
    particles: languageFeatureSchema,
    serialization: languageFeatureSchema,
    irregularity: languageFeatureSchema,
  })
  .strict();

const argumentMarkingMechanismSchema = z
  .object({
    mechanismId: domainIdSchema,
    mechanism: z.enum([
      "word_order",
      "case",
      "adposition",
      "particle",
      "agreement",
      "clitic",
      "prosody",
      "context",
      "combination",
    ]),
    applicability: languageFeatureApplicabilitySchema,
    conditions: z.array(requiredTextSchema),
    evidenceRefs: evidenceRefListSchema,
  })
  .strict();

const clauseStructureSchema = z
  .object({
    canonicalOrders: z.array(requiredTextSchema).min(1),
    orderFlexibility: languageFeatureSchema,
    argumentMarkingMechanisms: z.array(argumentMarkingMechanismSchema).min(1),
    topicMechanisms: languageFeatureSchema,
    questionFormation: languageFeatureSchema,
    negation: languageFeatureSchema,
    coordination: languageFeatureSchema,
    basicSubordination: languageFeatureSchema,
    informationStructure: languageFeatureSchema,
  })
  .strict();

const semanticSystemsSchema = z
  .object({
    numerals: languageFeatureSchema,
    quantity: languageFeatureSchema,
    age: languageFeatureSchema,
    possession: languageFeatureSchema,
    kinship: languageFeatureSchema,
    time: languageFeatureSchema,
    calendar: languageFeatureSchema,
    space: languageFeatureSchema,
    motion: languageFeatureSchema,
    measurement: languageFeatureSchema,
    comparison: languageFeatureSchema,
    modality: languageFeatureSchema,
  })
  .strict();

const discourseSystemSchema = z
  .object({
    topicContinuity: languageFeatureSchema,
    referenceTracking: languageFeatureSchema,
    ellipsis: languageFeatureSchema,
    discourseParticles: languageFeatureSchema,
    turnTaking: languageFeatureSchema,
    backchannels: languageFeatureSchema,
    repairPatterns: languageFeatureSchema,
    informationPackaging: languageFeatureSchema,
    cohesionStrategies: languageFeatureSchema,
  })
  .strict();

const sociolinguisticSystemSchema = z
  .object({
    addressSystem: languageFeatureSchema,
    politenessSystem: languageFeatureSchema,
    honorificSystem: languageFeatureSchema,
    registerVariation: languageFeatureSchema,
    namingConventions: languageFeatureSchema,
    sociallySensitiveQuestions: languageFeatureSchema,
    interactionalNorms: languageFeatureSchema,
  })
  .strict();

export const adaptationSignalSchema = z.enum([
  "non_latin_or_mixed_script",
  "low_grapheme_sound_transparency",
  "lexical_tone",
  "lexical_pitch",
  "length_contrast",
  "dense_nominal_inflection",
  "case_marking",
  "classifier_system",
  "zero_reference",
  "socially_encoded_reference",
  "complex_register_system",
  "high_context_dependency",
  "person_inflection",
  "aspect_prominence",
  "word_segmentation_difference",
]);
export type AdaptationSignal = z.infer<typeof adaptationSignalSchema>;

const evidenceSourceSchema = z
  .object({
    sourceId: domainIdSchema,
    sourceType: domainIdSchema,
    authorityClass: domainIdSchema,
    title: requiredTextSchema,
    publisherOrAuthor: requiredTextSchema,
    date: requiredTextSchema.optional(),
    urlOrReference: requiredTextSchema,
    accessedAt: requiredTextSchema.optional(),
    language: requiredTextSchema,
  })
  .strict();
const evidenceClaimSchema = z
  .object({
    claimId: domainIdSchema,
    featureRef: domainIdSchema,
    statement: requiredTextSchema,
    evidenceRefs: evidenceRefListSchema.min(1),
    confidence: confidenceSchema,
    reviewStatus: languageFeatureReviewStatusSchema,
  })
  .strict();
const evidenceConflictSchema = z
  .object({
    conflictId: domainIdSchema,
    claimRefs: z.array(domainIdSchema).min(2),
    conflictType: domainIdSchema,
    resolutionStatus: z.enum([
      "unresolved",
      "resolved_with_scope",
      "resolved_by_evidence",
      "accepted_variation",
    ]),
    notes: requiredTextSchema,
  })
  .strict();
const evidenceRegistrySchema = z
  .object({
    sources: z.array(evidenceSourceSchema).min(1),
    claims: z.array(evidenceClaimSchema),
    conflicts: z.array(evidenceConflictSchema),
  })
  .strict();

export const languageProfileSchema = z
  .object({
    identity: z
      .object({
        profileId: domainIdSchema,
        languageId: domainIdSchema,
        languageName: requiredTextSchema,
        varietyId: domainIdSchema,
        varietyName: requiredTextSchema,
        regionScope: z.array(requiredTextSchema).min(1),
        scriptScope: z.array(domainIdSchema).min(1),
        referenceRegister: z.enum([
          "neutral_standard",
          "colloquial_standard",
          "formal_standard",
          "mixed_documented",
        ]),
      })
      .strict(),
    profileCoverage: z.array(profileCoverageEntrySchema).min(1),
    writingSystem: writingSystemSchema,
    phonology: phonologySchema,
    nominalSystem: nominalSystemSchema,
    participantReference: participantReferenceSchema,
    predicationSystem: predicationSystemSchema,
    verbalSystem: verbalSystemSchema,
    clauseStructure: clauseStructureSchema,
    semanticSystems: semanticSystemsSchema,
    discourseSystem: discourseSystemSchema,
    sociolinguisticSystem: sociolinguisticSystemSchema,
    adaptationSignals: z.array(adaptationSignalSchema),
    evidenceRegistry: evidenceRegistrySchema,
    version: semanticVersionSchema,
    status: z.enum(["draft", "review", "canonical", "deprecated"]),
  })
  .strict();
export type LanguageProfile = z.infer<typeof languageProfileSchema>;

const REQUIRED_PROFILE_SECTIONS: LanguageProfileSection[] = [
  "writingSystem",
  "phonology",
  "nominalSystem",
  "participantReference",
  "predicationSystem",
  "verbalSystem",
  "clauseStructure",
  "semanticSystems",
  "discourseSystem",
  "sociolinguisticSystem",
];

type FeatureEntry = { section: LanguageProfileSection; feature: LanguageFeature };

function featureValues(record: object): LanguageFeature[] {
  return Object.values(record) as LanguageFeature[];
}

function collectFeatureEntries(profile: LanguageProfile): FeatureEntry[] {
  const phonologyFeatures: LanguageFeature[] = [
    profile.phonology.segmentalSystem,
    profile.phonology.syllableStructure,
    profile.phonology.stressSystem,
    profile.phonology.lexicalToneSystem,
    profile.phonology.lexicalPitchSystem,
    profile.phonology.lengthContrasts,
    profile.phonology.connectedSpeech,
    profile.phonology.phonotacticConstraints,
    ...profile.phonology.intelligibilityRelevantFeatures,
  ];

  return [
    { section: "writingSystem", feature: profile.writingSystem.diacritics },
    ...phonologyFeatures.map((feature) => ({ section: "phonology" as const, feature })),
    ...featureValues(profile.nominalSystem).map((feature) => ({ section: "nominalSystem" as const, feature })),
    ...featureValues(profile.participantReference).map((feature) => ({ section: "participantReference" as const, feature })),
    ...featureValues(profile.predicationSystem).map((feature) => ({ section: "predicationSystem" as const, feature })),
    ...featureValues(profile.verbalSystem).map((feature) => ({ section: "verbalSystem" as const, feature })),
    ...[
      profile.clauseStructure.orderFlexibility,
      profile.clauseStructure.topicMechanisms,
      profile.clauseStructure.questionFormation,
      profile.clauseStructure.negation,
      profile.clauseStructure.coordination,
      profile.clauseStructure.basicSubordination,
      profile.clauseStructure.informationStructure,
    ].map((feature) => ({ section: "clauseStructure" as const, feature })),
    ...featureValues(profile.semanticSystems).map((feature) => ({ section: "semanticSystems" as const, feature })),
    ...featureValues(profile.discourseSystem).map((feature) => ({ section: "discourseSystem" as const, feature })),
    ...featureValues(profile.sociolinguisticSystem).map((feature) => ({ section: "sociolinguisticSystem" as const, feature })),
  ];
}

const SIGNAL_RELEVANT_APPLICABILITY = new Set<LanguageFeature["applicability"]>([
  "systematic",
  "common",
  "context_dependent",
]);

function isSignalRelevant(feature: LanguageFeature) {
  return SIGNAL_RELEVANT_APPLICABILITY.has(feature.applicability);
}

export function deriveAdaptationSignals(profile: LanguageProfile): AdaptationSignal[] {
  const signals = new Set<AdaptationSignal>();
  const literacyScripts = profile.writingSystem.scripts.filter((script) => script.requiredForBasicLiteracy);

  if (literacyScripts.some((script) => script.family !== "latin") || literacyScripts.length > 1) {
    signals.add("non_latin_or_mixed_script");
  }
  if (["low", "mixed"].includes(profile.writingSystem.graphemeSoundRelationship.transparency)) {
    signals.add("low_grapheme_sound_transparency");
  }
  if (isSignalRelevant(profile.phonology.lexicalToneSystem)) signals.add("lexical_tone");
  if (isSignalRelevant(profile.phonology.lexicalPitchSystem)) signals.add("lexical_pitch");
  if (isSignalRelevant(profile.phonology.lengthContrasts)) signals.add("length_contrast");

  const nominalInflectionCount = [
    profile.nominalSystem.grammaticalGender,
    profile.nominalSystem.nounClasses,
    profile.nominalSystem.numberMarking,
    profile.nominalSystem.caseMarking,
    profile.nominalSystem.agreement,
  ].filter(isSignalRelevant).length;
  if (nominalInflectionCount >= 3) signals.add("dense_nominal_inflection");
  if (isSignalRelevant(profile.nominalSystem.caseMarking)) signals.add("case_marking");
  if (isSignalRelevant(profile.nominalSystem.classifiers)) signals.add("classifier_system");
  if (isSignalRelevant(profile.participantReference.zeroReference)) signals.add("zero_reference");
  if (isSignalRelevant(profile.participantReference.socialDistinctions)) signals.add("socially_encoded_reference");

  const registerComplexityCount = [
    profile.sociolinguisticSystem.addressSystem,
    profile.sociolinguisticSystem.politenessSystem,
    profile.sociolinguisticSystem.honorificSystem,
    profile.sociolinguisticSystem.registerVariation,
  ].filter(isSignalRelevant).length;
  if (registerComplexityCount >= 3) signals.add("complex_register_system");

  if (
    isSignalRelevant(profile.participantReference.zeroReference) &&
    isSignalRelevant(profile.discourseSystem.ellipsis)
  ) {
    signals.add("high_context_dependency");
  }
  if (isSignalRelevant(profile.verbalSystem.personMarking)) signals.add("person_inflection");
  if (isSignalRelevant(profile.verbalSystem.aspect) && !isSignalRelevant(profile.verbalSystem.tense)) {
    signals.add("aspect_prominence");
  }
  if (profile.writingSystem.segmentation !== "space_delimited_words") {
    signals.add("word_segmentation_difference");
  }

  return [...signals].sort();
}

function pushDuplicateIssues(
  issues: ValidationIssue[],
  values: Array<{ id: string; path: string }>,
  label: string,
) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      issues.push(validationIssue("DUPLICATE_DOMAIN_ID", value.path, `Duplicate ${label} id ${value.id}`, { relatedRefs: [value.id] }));
    } else {
      seen.add(value.id);
    }
  }
}

function validateEvidenceRefs(
  issues: ValidationIssue[],
  refs: string[],
  sourceIds: Set<string>,
  path: string,
) {
  refs.forEach((ref, index) => {
    if (!sourceIds.has(ref)) {
      issues.push(validationIssue("BROKEN_EVIDENCE_REFERENCE", `${path}.${index}`, `Evidence source ${ref} does not exist`, { relatedRefs: [ref] }));
    }
  });
}

export function validateLanguageProfile(input: unknown): ValidationResult {
  const parsed = languageProfileSchema.safeParse(input);
  if (!parsed.success) return validationResult(zodIssuesToValidationIssues(parsed.error));

  const profile = parsed.data;
  const issues: ValidationIssue[] = [];
  const coverageBySection = new Map<LanguageProfileSection, (typeof profile.profileCoverage)[number]>();

  for (const [index, coverage] of profile.profileCoverage.entries()) {
    if (coverageBySection.has(coverage.section)) {
      issues.push(validationIssue("DUPLICATE_PROFILE_COVERAGE", `profileCoverage.${index}.section`, `Coverage for ${coverage.section} is declared more than once`));
    } else {
      coverageBySection.set(coverage.section, coverage);
    }
  }
  for (const section of REQUIRED_PROFILE_SECTIONS) {
    if (!coverageBySection.has(section)) {
      issues.push(validationIssue("MISSING_PROFILE_COVERAGE", "profileCoverage", `Missing coverage declaration for ${section}`));
    }
  }

  const scriptIds = new Set(profile.writingSystem.scripts.map((script) => script.scriptId));
  const validateScriptRef = (ref: string, path: string) => {
    if (!scriptIds.has(ref)) {
      issues.push(validationIssue("BROKEN_SCRIPT_REFERENCE", path, `Script ${ref} does not exist`, { relatedRefs: [ref] }));
    }
  };
  profile.identity.scriptScope.forEach((ref, index) => validateScriptRef(ref, `identity.scriptScope.${index}`));
  profile.writingSystem.primaryScriptStrategy.scriptRefs.forEach((ref, index) => validateScriptRef(ref, `writingSystem.primaryScriptStrategy.scriptRefs.${index}`));
  profile.writingSystem.scripts.forEach((script, scriptIndex) => script.coexistsWith.forEach((ref, refIndex) => validateScriptRef(ref, `writingSystem.scripts.${scriptIndex}.coexistsWith.${refIndex}`)));
  profile.writingSystem.transliterationSystems.forEach((system, systemIndex) => system.targetScriptRefs.forEach((ref, refIndex) => validateScriptRef(ref, `writingSystem.transliterationSystems.${systemIndex}.targetScriptRefs.${refIndex}`)));

  const featureEntries = collectFeatureEntries(profile);
  pushDuplicateIssues(issues, featureEntries.map((entry, index) => ({ id: entry.feature.featureId, path: `features.${index}.featureId` })), "feature");
  const mechanismEntries = [
    ...featureEntries.flatMap((entry, featureIndex) => entry.feature.mechanisms.map((mechanism, mechanismIndex) => ({ id: mechanism.mechanismId, path: `features.${featureIndex}.mechanisms.${mechanismIndex}.mechanismId` }))),
    ...profile.clauseStructure.argumentMarkingMechanisms.map((mechanism, index) => ({ id: mechanism.mechanismId, path: `clauseStructure.argumentMarkingMechanisms.${index}.mechanismId` })),
  ];
  pushDuplicateIssues(issues, mechanismEntries, "mechanism");
  pushDuplicateIssues(issues, profile.writingSystem.scripts.map((script, index) => ({ id: script.scriptId, path: `writingSystem.scripts.${index}.scriptId` })), "script");
  pushDuplicateIssues(issues, profile.evidenceRegistry.sources.map((source, index) => ({ id: source.sourceId, path: `evidenceRegistry.sources.${index}.sourceId` })), "evidence source");
  pushDuplicateIssues(issues, profile.evidenceRegistry.claims.map((claim, index) => ({ id: claim.claimId, path: `evidenceRegistry.claims.${index}.claimId` })), "evidence claim");

  const sourceIds = new Set(profile.evidenceRegistry.sources.map((source) => source.sourceId));
  profile.writingSystem.scripts.forEach((script, index) => validateEvidenceRefs(issues, script.evidenceRefs, sourceIds, `writingSystem.scripts.${index}.evidenceRefs`));
  validateEvidenceRefs(issues, profile.writingSystem.graphemeSoundRelationship.evidenceRefs, sourceIds, "writingSystem.graphemeSoundRelationship.evidenceRefs");
  profile.writingSystem.transliterationSystems.forEach((system, index) => validateEvidenceRefs(issues, system.evidenceRefs, sourceIds, `writingSystem.transliterationSystems.${index}.evidenceRefs`));
  featureEntries.forEach((entry, featureIndex) => {
    validateEvidenceRefs(issues, entry.feature.evidenceRefs, sourceIds, `features.${featureIndex}.evidenceRefs`);
    entry.feature.mechanisms.forEach((mechanism, mechanismIndex) => validateEvidenceRefs(issues, mechanism.evidenceRefs, sourceIds, `features.${featureIndex}.mechanisms.${mechanismIndex}.evidenceRefs`));
  });
  profile.clauseStructure.argumentMarkingMechanisms.forEach((mechanism, index) => validateEvidenceRefs(issues, mechanism.evidenceRefs, sourceIds, `clauseStructure.argumentMarkingMechanisms.${index}.evidenceRefs`));

  const featureSectionById = new Map(featureEntries.map((entry) => [entry.feature.featureId, entry.section] as const));
  const claimById = new Map(profile.evidenceRegistry.claims.map((claim) => [claim.claimId, claim] as const));
  profile.evidenceRegistry.claims.forEach((claim, index) => {
    if (!featureSectionById.has(claim.featureRef)) {
      issues.push(validationIssue("BROKEN_FEATURE_REFERENCE", `evidenceRegistry.claims.${index}.featureRef`, `Feature ${claim.featureRef} does not exist`, { relatedRefs: [claim.featureRef] }));
    }
    validateEvidenceRefs(issues, claim.evidenceRefs, sourceIds, `evidenceRegistry.claims.${index}.evidenceRefs`);
  });

  profile.evidenceRegistry.conflicts.forEach((conflict, conflictIndex) => {
    conflict.claimRefs.forEach((claimRef, claimIndex) => {
      if (!claimById.has(claimRef)) {
        issues.push(validationIssue("BROKEN_CLAIM_REFERENCE", `evidenceRegistry.conflicts.${conflictIndex}.claimRefs.${claimIndex}`, `Claim ${claimRef} does not exist`, { relatedRefs: [claimRef] }));
      }
    });
    if (conflict.resolutionStatus === "unresolved") {
      const reviewedSections = new Set<LanguageProfileSection>();
      for (const claimRef of conflict.claimRefs) {
        const claim = claimById.get(claimRef);
        if (!claim) continue;
        const section = featureSectionById.get(claim.featureRef);
        if (section && coverageBySection.get(section)?.coverageStatus === "reviewed") reviewedSections.add(section);
      }
      if (reviewedSections.size > 0) {
        issues.push(validationIssue("REVIEWED_SECTION_HAS_UNRESOLVED_CONFLICT", `evidenceRegistry.conflicts.${conflictIndex}`, `Reviewed sections cannot contain unresolved evidence conflicts: ${[...reviewedSections].join(", ")}`, { relatedRefs: conflict.claimRefs }));
      }
    }
  });

  const declaredSignals = [...new Set(profile.adaptationSignals)].sort();
  const derivedSignals = deriveAdaptationSignals(profile);
  if (declaredSignals.length !== profile.adaptationSignals.length || declaredSignals.join("|") !== derivedSignals.join("|")) {
    issues.push(validationIssue("ADAPTATION_SIGNAL_MISMATCH", "adaptationSignals", `Declared signals must exactly match derived signals. Expected: ${derivedSignals.join(", ") || "none"}`, { relatedRefs: derivedSignals }));
  }

  return validationResult(issues);
}
