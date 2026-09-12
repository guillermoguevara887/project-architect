import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { z } from "zod";
import {
  CURRICULUM_REQUIREMENT_DOMAINS,
  CURRICULUM_REQUIREMENT_DOMAIN_METADATA,
} from "../src/languages/curriculum/curriculum-requirement-domain.js";
import {
  languageProfileV1Schema,
  parseLanguageProfileByVersion,
} from "../src/languages/profile/language-profile-compatibility.js";
import {
  languageProfileV2Schema,
  validateLanguageProfileV2,
  type LanguageProfileV2,
} from "../src/languages/profile/language-profile-v2.js";
import {
  profileKnowledgeSchema,
  profileKnowledgeSectionsV2Schema,
  profileKnowledgeSlotIdSchema,
  profileKnowledgeSubjectRefSchema,
  profileSubjectExists,
  type LanguageFeatureV2,
  type ProfileKnowledgeSlotId,
} from "../src/languages/profile/profile-knowledge-v2.js";
import {
  REQUIREMENT_EVIDENCE_TARGET_CATALOG,
  requirementEvidenceTargetCatalogSchema,
  requirementEvidenceTargetGroupSchema,
  requirementEvidenceTargetRefSchema,
  type RequirementEvidenceTargetGroup,
} from "../src/languages/profile/requirement-evidence-targets.js";
import {
  BASELINE_EVIDENCE_POLICY_V2,
  baselineEvidencePolicyV2Schema,
  targetEvidencePolicySchema,
} from "../src/languages/profile/evidence-policy-v2.js";
import {
  evidenceClaimV2Schema,
  evidenceSourceV2Schema,
  sourceEvidenceV2Schema,
  type EvidenceClaimV2,
  type EvidenceSourceV2,
} from "../src/languages/profile/evidence-provenance-v2.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { japaneseLanguageProfileFixture } from "./fixtures/language-profile/japanese.js";
import { mandarinLanguageProfileFixture } from "./fixtures/language-profile/mandarin.js";

// Synthetic contract data only. No researched language profile or registry.
function partialProfile(): LanguageProfileV2 {
  const knowledge = Object.fromEntries(Object.entries(profileKnowledgeSectionsV2Schema.shape).map(
    ([section, schema]) => [section, Object.fromEntries(Object.keys(schema.shape).map(
      (slot) => [slot, { state: "unknown" }],
    ))],
  ));
  return languageProfileV2Schema.parse({
    schemaVersion: "2.0.0", version: "0.1.0", status: "canonical",
    identity: {
      profileId: "contract.synthetic", languageId: "test", languageName: "Synthetic contract language",
      varietyId: "test.synthetic", varietyName: "Synthetic contract variety",
    },
    knowledge,
    evidenceRegistry: { sources: [], evidence: [], claims: [], conflicts: [] },
  });
}

function source(): EvidenceSourceV2 {
  return {
    sourceId: "test.source", sourceType: "reference_book", title: "Synthetic test source",
    publisherOrAuthor: "Contract test author",
    reference: { kind: "bibliographic", citation: "Internal contract fixture, no linguistic facts" },
    sourceLanguage: "test", authorityClass: "unassessed",
    independenceKey: { responsibleEntityId: "test.author", workId: "test.work", lineageId: "test.lineage" },
  };
}

function targetRef(domain: string, slot: ProfileKnowledgeSlotId) {
  return requirementEvidenceTargetRefSchema.parse({ catalogVersion: "1.0.0", targetId: `${domain}.${slot}` });
}

function claim(): EvidenceClaimV2 {
  return {
    claimId: "test.claim", statement: "Synthetic structural assertion; no linguistic fact",
    subjectRefs: [{ kind: "slot", slot: "sociolinguisticSystem.interactionalNorms" }],
    requirementEvidenceTargetRefs: [
      targetRef("sociolinguistics.initial_register", "sociolinguisticSystem.interactionalNorms"),
      targetRef("localization.first_contact", "sociolinguisticSystem.interactionalNorms"),
    ],
    evidenceRefs: [{ evidenceRef: "test.evidence", relationshipValidation: { status: "unvalidated" } }],
    confidence: "low", reviewStatus: "machine_synthesized", requirementRefs: ["test.AR03", "test.AR10"],
    origin: { kind: "research_run", originRunRef: "test.run" },
  };
}

function profileWithClaim() {
  const profile = partialProfile();
  profile.evidenceRegistry.sources.push(source());
  profile.evidenceRegistry.evidence.push({
    evidenceId: "test.evidence", sourceRef: "test.source", locator: "Synthetic section 1",
    evidenceSummary: "Short synthetic test summary",
  });
  profile.evidenceRegistry.claims.push(claim());
  return profile;
}

function feature(featureId = "test.feature"): LanguageFeatureV2 {
  return {
    featureId, description: "Synthetic feature", applicability: "common", values: ["Synthetic value"],
    mechanisms: [{
      mechanismId: "test.mechanism", role: "Synthetic realization", applicability: "common",
      conditions: [], variation: "none_known", relevance: ["age_realization"],
    }],
    conditions: [], variation: "none_known", relevance: ["initial_intelligibility"],
  };
}

function groups(domain: typeof CURRICULUM_REQUIREMENT_DOMAINS[number]) {
  return REQUIREMENT_EVIDENCE_TARGET_CATALOG.domains.find((entry) => entry.domain === domain)!.groups;
}

test("v2 requires exact schemaVersion 2.0.0 independently of content version", () => {
  const profile = partialProfile();
  assert.equal(profile.schemaVersion, "2.0.0");
  assert.equal(profile.version, "0.1.0");
  for (const schemaVersion of [undefined, null, "1.0.0", "2.0", "3.0.0"]) {
    assert.equal(languageProfileV2Schema.safeParse({ ...profile, schemaVersion }).success, false);
  }
  const unversioned: Partial<LanguageProfileV2> = { ...profile };
  delete unversioned.schemaVersion;
  assert.equal(languageProfileV2Schema.safeParse(unversioned).success, false);
});

test("historical German, Japanese and Mandarin fixtures still parse only as v1", () => {
  for (const fixture of [germanLanguageProfileFixture, japaneseLanguageProfileFixture, mandarinLanguageProfileFixture]) {
    assert.deepEqual(languageProfileV1Schema.parse(fixture), fixture);
    assert.deepEqual(parseLanguageProfileByVersion(fixture), { contract: "v1", profile: fixture });
    assert.equal(languageProfileV2Schema.safeParse(fixture).success, false);
    assert.equal(languageProfileV2Schema.safeParse({ ...fixture, schemaVersion: "2.0.0" }).success, false);
  }
});

test("version boundary never upgrades reviewed/A1_sufficient, falls back, or defaults v2", () => {
  const before = structuredClone(germanLanguageProfileFixture);
  const parsed = parseLanguageProfileByVersion(before);
  assert.equal(parsed.contract, "v1");
  assert.deepEqual(before, germanLanguageProfileFixture);
  assert.deepEqual(parseLanguageProfileByVersion(partialProfile()).contract, "v2");
  for (const schemaVersion of ["1.0.0", "3.0.0", null, undefined]) {
    assert.throws(() => parseLanguageProfileByVersion({ ...before, schemaVersion }));
  }
  const unversioned: Partial<LanguageProfileV2> = partialProfile();
  delete unversioned.schemaVersion;
  assert.throws(() => parseLanguageProfileByVersion(unversioned));
  assert.equal(languageProfileV1Schema.safeParse(partialProfile()).success, false);
});

test("German v1 semantic fingerprint stays frozen at the pre-S1 baseline", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(germanLanguageProfileFixture)).digest("hex"), "3e7c2ee855d69dfc0c878b29f8b1c0bf9e1bad13e3108c5ea12ca3c7d4f4b713");
  assert.equal(germanLanguageProfileFixture.identity.varietyId, "de.standard");
  assert.equal(germanLanguageProfileFixture.profileCoverage.every((entry) =>
    entry.coverageStatus === "reviewed" && entry.coverageDepth === "A1_sufficient"), true);
});

test("v2 accepts de / de-DE without creating a real profile", () => {
  const profile = partialProfile();
  profile.identity.languageId = "de";
  profile.identity.varietyId = "de-DE";
  assert.equal(validateLanguageProfileV2(profile).valid, true);
});

test("canonical partial profiles represent every unresearched slot as unknown", () => {
  const profile = partialProfile();
  assert.equal(profile.status, "canonical");
  assert.equal(profile.knowledge.writingSystem.direction.state, "unknown");
  assert.deepEqual(profile.evidenceRegistry, { sources: [], evidence: [], claims: [], conflicts: [] });
  assert.equal(languageProfileV2Schema.safeParse({ ...profile, profileCoverage: [] }).success, false);
  assert.equal(languageProfileV2Schema.safeParse({ ...profile, adaptationSignals: [] }).success, false);
});

test("known, unknown and not_applicable are distinct strict states without defaults", () => {
  const schema = profileKnowledgeSchema(z.array(z.string().min(1)).min(1));
  assert.deepEqual(schema.parse({ state: "unknown" }), { state: "unknown" });
  assert.deepEqual(schema.parse({ state: "not_applicable", reason: "Synthetic explicit scope" }), {
    state: "not_applicable", reason: "Synthetic explicit scope",
  });
  assert.deepEqual(schema.parse({ state: "known", value: ["test"] }), { state: "known", value: ["test"] });
  for (const invalid of [undefined, {}, [], "", { state: "not_applicable" }, { state: "unknown", value: [] },
    { state: "known", value: [] }, { state: "known", value: [""] }, { state: "not_applicable", reason: "test", value: ["test"] }]) {
    assert.equal(schema.safeParse(invalid).success, false);
  }
  const profile = partialProfile();
  profile.knowledge.nominalSystem.nounClasses = { state: "not_applicable", reason: "Test assertion, sufficiency deferred to S2" };
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  assert.equal(languageProfileV2Schema.safeParse({ ...profile, knowledge: { ...profile.knowledge, phonology: {} } }).success, false);
});

test("known absence is distinct from unknown and not_applicable", () => {
  const profile = partialProfile();
  profile.knowledge.nominalSystem.nounClasses = {
    state: "known", value: { ...feature(), applicability: "absent", values: [], mechanisms: [] },
  };
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  profile.knowledge.nominalSystem.nounClasses.value.values = ["Contradictory active value"];
  assert.equal(languageProfileV2Schema.safeParse(profile).success, false);
});

test("an explicitly known empty inventory is neither unknown nor not_applicable", () => {
  const profile = partialProfile();
  profile.knowledge.writingSystem.scripts = { state: "known", value: [] };
  profile.knowledge.writingSystem.transliterationSystems = { state: "known", value: [] };
  profile.knowledge.phonology.intelligibilityRelevantFeatures = { state: "known", value: [] };
  profile.knowledge.clauseStructure.argumentMarkingMechanisms = { state: "known", value: [] };
  const parsed = languageProfileV2Schema.parse(profile);
  assert.deepEqual(parsed.knowledge.writingSystem.scripts, { state: "known", value: [] });
  assert.deepEqual(parsed.knowledge.writingSystem.direction, { state: "unknown" });
  assert.equal(languageProfileV2Schema.safeParse({ ...profile, knowledge: {
    ...profile.knowledge, writingSystem: { ...profile.knowledge.writingSystem, scripts: [] },
  } }).success, false);
});

test("catalog 1.0.0 contains exactly the ten curricular domains and metadata references", () => {
  assert.equal(REQUIREMENT_EVIDENCE_TARGET_CATALOG.catalogVersion, "1.0.0");
  assert.deepEqual(REQUIREMENT_EVIDENCE_TARGET_CATALOG.domains.map((entry) => entry.domain), CURRICULUM_REQUIREMENT_DOMAINS);
  assert.equal(requirementEvidenceTargetCatalogSchema.safeParse(REQUIREMENT_EVIDENCE_TARGET_CATALOG).success, true);
  for (const domain of CURRICULUM_REQUIREMENT_DOMAINS) {
    assert.deepEqual(CURRICULUM_REQUIREMENT_DOMAIN_METADATA[domain].evidenceTargetCatalogRef, { catalogVersion: "1.0.0", domain });
  }
  assert.equal(Object.isFrozen(REQUIREMENT_EVIDENCE_TARGET_CATALOG.domains[0]!.groups[0]!.targets[0]!.subjectRef), true);
});

test("catalog rejects duplicate domains, group IDs and target IDs, and missing domains", () => {
  const duplicateDomain = structuredClone(REQUIREMENT_EVIDENCE_TARGET_CATALOG);
  duplicateDomain.domains[1] = duplicateDomain.domains[0]!;
  assert.equal(requirementEvidenceTargetCatalogSchema.safeParse(duplicateDomain).success, false);
  const duplicateGroup = structuredClone(REQUIREMENT_EVIDENCE_TARGET_CATALOG);
  duplicateGroup.domains[0]!.groups.push(duplicateGroup.domains[0]!.groups[0]!);
  assert.equal(requirementEvidenceTargetCatalogSchema.safeParse(duplicateGroup).success, false);
  const duplicateTarget = structuredClone(REQUIREMENT_EVIDENCE_TARGET_CATALOG);
  duplicateTarget.domains[0]!.groups[0]!.targets[1] = duplicateTarget.domains[0]!.groups[0]!.targets[0]!;
  assert.equal(requirementEvidenceTargetCatalogSchema.safeParse(duplicateTarget).success, false);
  const missingDomain = structuredClone(REQUIREMENT_EVIDENCE_TARGET_CATALOG);
  missingDomain.domains.pop();
  assert.equal(requirementEvidenceTargetCatalogSchema.safeParse(missingDomain).success, false);
});

test("catalog rejects domains outside the curriculum enum and unknown or misbound subjects/targets", () => {
  const catalog = structuredClone(REQUIREMENT_EVIDENCE_TARGET_CATALOG);
  const first = catalog.domains[0]!;
  assert.equal(requirementEvidenceTargetCatalogSchema.safeParse({ ...catalog, domains: [
    { ...first, domain: "future.invented" }, ...catalog.domains.slice(1),
  ] }).success, false);
  for (const slot of ["$.writingSystem.direction", "writingSystem.invented", "identity.referenceRegister"]) {
    first.groups[0]!.targets[0]!.subjectRef.slot = slot as ProfileKnowledgeSlotId;
    assert.equal(requirementEvidenceTargetCatalogSchema.safeParse(catalog).success, false);
  }
  assert.equal(requirementEvidenceTargetRefSchema.safeParse({ catalogVersion: "1.0.0", targetId: "writing.beginner_system.invented" }).success, false);
  assert.equal(requirementEvidenceTargetRefSchema.safeParse({ ...targetRef("writing.beginner_system", "writingSystem.direction"), catalogVersion: "2.0.0" }).success, false);
});

test("all/any and required/optional are the complete group vocabulary", () => {
  const group = groups("writing.beginner_system")[0]!;
  for (const aggregation of ["all", "any"]) for (const requirement of ["required", "optional"]) {
    assert.equal(requirementEvidenceTargetGroupSchema.safeParse({ ...group, aggregation, requirement }).success, true);
  }
  for (const invalid of [{ aggregation: "quorum" }, { requirement: "conditional" }, { targets: [] }, { when: "invented condition" }]) {
    assert.equal(requirementEvidenceTargetGroupSchema.safeParse({ ...group, ...invalid }).success, false);
  }
});

test("A1-U01 required slots retain all specified structural needs", () => {
  const expected = {
    "writing.beginner_system": ["writingSystem.scripts", "writingSystem.primaryScriptStrategy", "writingSystem.direction", "writingSystem.segmentation", "writingSystem.graphemeSoundRelationship", "writingSystem.orthographicDepth", "writingSystem.orthographicConventions", "writingSystem.diacritics", "writingSystem.transliterationSystems"],
    "sociolinguistics.initial_register": ["sociolinguisticSystem.addressSystem", "sociolinguisticSystem.politenessSystem", "sociolinguisticSystem.honorificSystem", "sociolinguisticSystem.registerVariation", "sociolinguisticSystem.interactionalNorms"],
    "participant.basic_reference": ["participantReference.personDistinctions", "participantReference.numberDistinctions", "participantReference.genderDistinctions", "participantReference.socialDistinctions", "participantReference.pronounInventoryCharacteristics", "participantReference.zeroReference", "participantReference.nominalReference", "participantReference.agreementBasedReference", "participantReference.referencePersistence"],
    "nominal.beginner_package": ["nominalSystem.grammaticalGender", "nominalSystem.nounClasses", "nominalSystem.numberMarking", "nominalSystem.caseMarking", "nominalSystem.definiteness", "nominalSystem.articlesAndDeterminers", "nominalSystem.classifiers", "nominalSystem.agreement"],
    "predication.identity_state": ["predicationSystem.identityPredication", "predicationSystem.propertyPredication", "predicationSystem.statePredication"],
    "possession.basic": ["semanticSystems.possession", "predicationSystem.possessionPredication", "nominalSystem.possessionWithinNP"],
    "action.basic_pattern": ["verbalSystem.personMarking", "verbalSystem.numberMarking", "verbalSystem.tense", "verbalSystem.aspect", "verbalSystem.auxiliaries", "verbalSystem.particles", "verbalSystem.serialization", "verbalSystem.irregularity", "clauseStructure.canonicalOrders", "clauseStructure.orderFlexibility", "clauseStructure.argumentMarkingMechanisms"],
    "localization.first_contact": ["identity.regionScope", "identity.referenceRegister", "sociolinguisticSystem.namingConventions", "sociolinguisticSystem.sociallySensitiveQuestions", "sociolinguisticSystem.interactionalNorms", "sociolinguisticSystem.registerVariation"],
  };
  for (const [domain, slots] of Object.entries(expected)) {
    assert.deepEqual(groups(domain as keyof typeof expected).filter((group) => group.requirement === "required")
      .flatMap((group) => group.targets.map((target) => target.subjectRef.slot)).sort(), slots.sort(), domain);
  }
});

test("contextual and corroborating subjects stay optional for A1-U01", () => {
  const optionalSlots = (domain: typeof CURRICULUM_REQUIREMENT_DOMAINS[number]) => groups(domain)
    .filter((group) => group.requirement === "optional").flatMap((group) => group.targets.map((target) => target.subjectRef.slot));
  assert.deepEqual(optionalSlots("participant.basic_reference"), ["participantReference.animacyDistinctions", "participantReference.clusivity", "participantReference.demonstrativeReference"]);
  assert.deepEqual(optionalSlots("nominal.beginner_package"), ["nominalSystem.modification"]);
  assert.deepEqual(optionalSlots("sociolinguistics.initial_register"), ["participantReference.socialDistinctions"]);
  assert.deepEqual(optionalSlots("localization.first_contact"), ["sociolinguisticSystem.addressSystem", "sociolinguisticSystem.politenessSystem"]);
});

test("phonology has one required any group with explicit intelligibility relevance", () => {
  const [group] = groups("phonology.initial_intelligibility");
  assert.equal(groups("phonology.initial_intelligibility").length, 1);
  assert.equal(group!.requirement, "required");
  assert.equal(group!.aggregation, "any");
  assert.deepEqual(group!.targets.map((target) => target.subjectRef.slot), [
    "phonology.segmentalSystem", "phonology.syllableStructure", "phonology.stressSystem", "phonology.lexicalToneSystem",
    "phonology.lexicalPitchSystem", "phonology.lengthContrasts", "phonology.connectedSpeech", "phonology.phonotacticConstraints", "phonology.intelligibilityRelevantFeatures",
  ]);
  assert.equal(group!.targets.every((target) => target.relevanceRequirement?.relevance === "initial_intelligibility"), true);
});

test("age has semantic, numeral and question slots plus authentic mechanism alternatives", () => {
  const ageGroups = groups("age.basic_expression");
  const realization = ageGroups.find((group) => group.groupId === "age.basic_expression.realization")!;
  assert.equal(realization.requirement, "required");
  assert.equal(realization.aggregation, "any");
  assert.deepEqual(ageGroups.filter((group) => group.aggregation === "all").flatMap((group) => group.targets.map((target) => target.subjectRef.slot)).sort(), ["clauseStructure.questionFormation", "semanticSystems.age", "semanticSystems.numerals"]);
  assert.equal(realization.targets.every((target) => target.relevanceRequirement?.scope === "feature_mechanism" && target.relevanceRequirement.relevance === "age_realization"), true);
  for (const section of ["predicationSystem", "verbalSystem", "discourseSystem"]) {
    assert.equal(realization.targets.some((target) => target.subjectRef.slot.startsWith(`${section}.`)), true);
  }
  assert.equal(ageGroups.find((group) => group.groupId.endsWith(".numerals"))!.targets[0]!.relevanceRequirement?.relevance, "age_expression");
});

test("baseline is frozen and target policies cannot express weaker rules", () => {
  assert.deepEqual(baselineEvidencePolicyV2Schema.parse(BASELINE_EVIDENCE_POLICY_V2), BASELINE_EVIDENCE_POLICY_V2);
  assert.equal(targetEvidencePolicySchema.safeParse({}).success, true);
  assert.equal(targetEvidencePolicySchema.safeParse({ allowedReviewStatuses: ["human_reviewed"], crossCheckedMinimumIndependentSources: 3, humanReviewedMinimumAuthoritativeSources: 2 }).success, true);
  for (const weak of [
    { crossCheckedMinimumIndependentSources: 1 }, { humanReviewedMinimumAuthoritativeSources: 0 },
    { humanReviewedRequiresValidatedClaimSourceRelation: false }, { openConflictBlocksCovered: false },
    { allowedReviewStatuses: ["needs_review"] }, { allowedReviewStatuses: ["machine_synthesized"] },
    { machineSynthesizedCanCoverAlone: true }, { needsReviewCanCover: true }, { minimumSources: 0 },
  ]) {
    assert.equal(targetEvidencePolicySchema.safeParse(weak).success, false);
    const group: RequirementEvidenceTargetGroup = structuredClone(groups("writing.beginner_system")[0]!);
    assert.equal(requirementEvidenceTargetGroupSchema.safeParse({ ...group, targets: [{ ...group.targets[0], policy: weak }] }).success, false);
  }
  assert.equal(baselineEvidencePolicyV2Schema.safeParse({ ...BASELINE_EVIDENCE_POLICY_V2, needsReviewCanCover: true }).success, false);
});

test("subjects derive from schema slots and reject arbitrary paths or misplaced feature IDs", () => {
  for (const slot of profileKnowledgeSlotIdSchema.options) {
    assert.equal(profileKnowledgeSubjectRefSchema.safeParse({ kind: "slot", slot }).success, true);
  }
  assert.equal(profileKnowledgeSubjectRefSchema.safeParse({ kind: "section", section: "phonology" }).success, true);
  for (const subject of [
    { kind: "slot", slot: "phonology.invented" }, { kind: "slot", slot: "$.phonology[*]" },
    { kind: "slot", slot: "writingSystem.direction", path: "invented" },
    { kind: "feature", slot: "writingSystem.direction", featureId: "test.feature" },
    { kind: "section", section: "pedagogy" },
  ]) assert.equal(profileKnowledgeSubjectRefSchema.safeParse(subject).success, false);
});

test("claims support multiple targets and non-LanguageFeature structural subjects", () => {
  const profile = profileWithClaim();
  assert.equal(evidenceClaimV2Schema.parse(claim()).requirementEvidenceTargetRefs.length, 2);
  const structuralClaim = profile.evidenceRegistry.claims[0]!;
  structuralClaim.subjectRefs = [{ kind: "slot", slot: "writingSystem.direction" }];
  structuralClaim.requirementEvidenceTargetRefs = [targetRef("writing.beginner_system", "writingSystem.direction")];
  structuralClaim.origin = { kind: "manual", authorRef: "test.author", recordedAt: "2026-09-06T00:00:00Z" };
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  assert.equal("featureRef" in structuralClaim, false);
});

test("profile validates exact feature, mechanism and structured item locators", () => {
  const profile = partialProfile();
  profile.knowledge.phonology.intelligibilityRelevantFeatures = { state: "known", value: [feature()] };
  const featureRef = { kind: "feature", slot: "phonology.intelligibilityRelevantFeatures", featureId: "test.feature" } as const;
  assert.equal(profileSubjectExists(profile.knowledge, featureRef), true);
  assert.equal(profileSubjectExists(profile.knowledge, { ...featureRef, featureId: "invented" }), false);
  assert.equal(profileSubjectExists(profile.knowledge, { ...featureRef, kind: "feature_mechanism", mechanismId: "test.mechanism" }), true);
  assert.equal(profileSubjectExists(profile.knowledge, { ...featureRef, kind: "feature_mechanism", mechanismId: "invented" }), false);
  assert.equal(profileSubjectExists(profile.knowledge, { ...featureRef, slot: "phonology.segmentalSystem" }), false);
  profile.knowledge.clauseStructure.argumentMarkingMechanisms = { state: "known", value: [{
    mechanismId: "test.argument", mechanism: "context", applicability: "common", conditions: [], relevance: [],
  }] };
  assert.equal(profileSubjectExists(profile.knowledge, { kind: "structural_item", slot: "clauseStructure.argumentMarkingMechanisms", itemId: "test.argument" }), true);
  assert.equal(profileSubjectExists(profile.knowledge, { kind: "structural_item", slot: "clauseStructure.argumentMarkingMechanisms", itemId: "invented" }), false);
});

test("profile rejects broken claims, evidence, sources and target grounding", () => {
  const original = profileWithClaim();
  assert.equal(languageProfileV2Schema.safeParse(original).success, true);
  const mutations: ((profile: LanguageProfileV2) => void)[] = [
    (p) => { p.evidenceRegistry.evidence[0]!.sourceRef = "missing"; },
    (p) => { p.evidenceRegistry.claims[0]!.evidenceRefs[0]!.evidenceRef = "missing"; },
    (p) => { p.evidenceRegistry.claims[0]!.subjectRefs = [{ kind: "feature", slot: "sociolinguisticSystem.interactionalNorms", featureId: "missing" }]; },
    (p) => { p.evidenceRegistry.claims[0]!.subjectRefs = [{ kind: "section", section: "sociolinguisticSystem" }]; },
    (p) => { p.evidenceRegistry.claims[0]!.subjectRefs = [{ kind: "slot", slot: "sociolinguisticSystem.addressSystem" }]; },
    (p) => { p.evidenceRegistry.sources.push(source()); },
    (p) => { p.evidenceRegistry.evidence.push(p.evidenceRegistry.evidence[0]!); },
    (p) => { p.evidenceRegistry.claims.push(claim()); },
  ];
  for (const mutate of mutations) {
    const profile = structuredClone(original);
    mutate(profile);
    assert.equal(languageProfileV2Schema.safeParse(profile).success, false);
  }
});

test("provenance has closed types, dated URLs and brief locator/summary structure", () => {
  assert.deepEqual(evidenceSourceV2Schema.parse(source()), source());
  assert.equal(evidenceSourceV2Schema.safeParse({ ...source(), reference: {
    kind: "url", url: "https://example.invalid/contract-test", accessedAt: "2026-09-06T00:00:00-07:00",
  } }).success, true);
  for (const invalid of [
    { sourceType: "invented" }, { authorityClass: "invented" }, { title: "" }, { sourceLanguage: "" },
    { reference: { kind: "url", url: "https://example.invalid/test" } },
    { reference: { kind: "url", url: "not a URL", accessedAt: "2026-09-06T00:00:00Z" } },
    { reference: { kind: "url", url: "https://example.invalid/test", accessedAt: "yesterday" } },
    { independenceKey: "author.same" }, { independenceKey: { responsibleEntityId: "author" } },
    { document: "Full text is not part of the contract" },
  ]) assert.equal(evidenceSourceV2Schema.safeParse({ ...source(), ...invalid }).success, false);
  const evidence = profileWithClaim().evidenceRegistry.evidence[0]!;
  assert.equal(sourceEvidenceV2Schema.safeParse(evidence).success, true);
  assert.equal(sourceEvidenceV2Schema.safeParse({ ...evidence, locator: "" }).success, false);
  assert.equal(sourceEvidenceV2Schema.safeParse({ ...evidence, evidenceSummary: "x".repeat(1201) }).success, false);
  assert.equal(evidenceClaimV2Schema.safeParse({ ...claim(), prompt: "not stored" }).success, false);
});

test("independenceKey survives parsing without inferring independence", () => {
  const profile = profileWithClaim();
  profile.evidenceRegistry.sources.push({ ...source(), sourceId: "test.second-source" });
  const parsed = languageProfileV2Schema.parse(profile);
  assert.deepEqual(parsed.evidenceRegistry.sources.map((entry) => entry.independenceKey), [source().independenceKey, source().independenceKey]);
});

test("claim-source relationship validation is explicit and claim-specific", () => {
  const profile = profileWithClaim();
  const relation = profile.evidenceRegistry.claims[0]!.evidenceRefs[0]!;
  relation.relationshipValidation = { status: "human_validated", validatorRef: "test.reviewer", validatedAt: "2026-09-06T00:00:00Z" };
  assert.deepEqual(languageProfileV2Schema.parse(profile).evidenceRegistry.claims[0]!.evidenceRefs[0], relation);
  assert.equal(evidenceClaimV2Schema.safeParse({ ...claim(), evidenceRefs: [{ evidenceRef: "test.evidence", relationshipValidation: { status: "human_validated" } }] }).success, false);
  // S1 accepts review labels with unevaluated evidence; S2 decides sufficiency.
  for (const reviewStatus of ["machine_synthesized", "needs_review", "cross_checked", "human_reviewed"] as const) {
    profile.evidenceRegistry.claims[0]!.reviewStatus = reviewStatus;
    assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  }
});

test("open conflicts are representable without coverage evaluation; refs must resolve", () => {
  const profile = profileWithClaim();
  profile.evidenceRegistry.claims.push({ ...claim(), claimId: "test.alternative" });
  profile.evidenceRegistry.conflicts.push({
    conflictId: "test.conflict", claimRefs: ["test.claim", "test.alternative"],
    requirementEvidenceTargetRefs: claim().requirementEvidenceTargetRefs,
    conflictType: "scope_disagreement", resolutionStatus: "unresolved", notes: "Synthetic unresolved conflict",
  });
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  profile.evidenceRegistry.conflicts[0]!.claimRefs[1] = "missing";
  assert.equal(languageProfileV2Schema.safeParse(profile).success, false);
});
