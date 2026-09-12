import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveRequirementEvidence, requirementEvidenceReasonSchema,
  type RequirementEvidenceInput, type RequirementEvidenceResolution, type RequirementEvidenceReason,
} from "../src/languages/profile/requirement-evidence.js";
import { languageProfileV2Schema, type LanguageProfileV2 } from "../src/languages/profile/language-profile-v2.js";
import {
  profileFeatureSlotIdSchema, profileKnowledgeSectionsV2Schema, profileKnowledgeIdentityIssues,
  type ProfileKnowledgeSlotId, type LanguageFeatureV2,
} from "../src/languages/profile/profile-knowledge-v2.js";
import { evidenceClaimV2Schema } from "../src/languages/profile/evidence-provenance-v2.js";
import {
  REQUIREMENT_EVIDENCE_TARGET_CATALOG as catalog,
  type RequirementEvidenceTarget, type RequirementEvidenceTargetRef,
} from "../src/languages/profile/requirement-evidence-targets.js";
import { CURRICULUM_REQUIREMENT_DOMAINS, type CurriculumRequirementDomain } from "../src/languages/curriculum/curriculum-requirement-domain.js";
import { BASELINE_EVIDENCE_POLICY_V2, REQUIREMENT_EVIDENCE_INDEPENDENCE_LIMITS as independenceLimits, targetEvidencePolicySchema } from "../src/languages/profile/evidence-policy-v2.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

const requirement = (domain: CurriculumRequirementDomain = "phonology.initial_intelligibility"): RequirementEvidenceInput => ({ requirementRef: `test.requirement.${domain}`, domain });
const entry = (domain: CurriculumRequirementDomain) => catalog.domains.find((item) => item.domain === domain)!;
const target = (domain: CurriculumRequirementDomain, slot: ProfileKnowledgeSlotId) => entry(domain).groups.flatMap((group) => group.targets).find((item) => item.subjectRef.slot === slot)!;
const targetRef = (target: RequirementEvidenceTarget): RequirementEvidenceTargetRef => ({ catalogVersion: "1.0.0", targetId: target.targetId });

function setSlot(profile: LanguageProfileV2, slot: ProfileKnowledgeSlotId, value: unknown) {
  const [section, field] = slot.split(".");
  (profile.knowledge as unknown as Record<string, Record<string, unknown>>)[section!]![field!] = value;
}

function syntheticFeature(slot: string, suffix = ""): LanguageFeatureV2 {
  return {
    featureId: `test.feature.${slot}${suffix}`, description: "Synthetic contract feature; no language assertion",
    applicability: "common", values: ["Synthetic value"], conditions: [], variation: "none_known",
    relevance: ["initial_intelligibility", "age_expression"],
    mechanisms: [{
      mechanismId: `test.mechanism.${slot}${suffix}`, role: "Synthetic mechanism",
      applicability: "common", conditions: [], variation: "none_known", relevance: ["age_realization"],
    }],
  };
}

function know(profile: LanguageProfileV2, slot: ProfileKnowledgeSlotId) {
  if (profileFeatureSlotIdSchema.safeParse(slot).success) {
    setSlot(profile, slot, { state: "known", value: slot === "phonology.intelligibilityRelevantFeatures" ? [syntheticFeature(slot)] : syntheticFeature(slot) });
    return;
  }
  // Typed fixture values, not a second requirements/targets mapping.
  const values: Partial<Record<ProfileKnowledgeSlotId, unknown>> = {
    "identity.regionScope": ["Synthetic region"], "identity.referenceRegister": "neutral_standard",
    "writingSystem.scripts": [{ scriptId: "test.script", name: "Synthetic script", family: "other", role: "primary", usage: "Synthetic usage", coexistsWith: [] }],
    "writingSystem.primaryScriptStrategy": { strategy: "single", scriptRefs: ["test.script"] },
    "writingSystem.direction": "ltr", "writingSystem.segmentation": "space_delimited_words",
    "writingSystem.graphemeSoundRelationship": { transparency: "mixed", description: "Synthetic relationship" },
    "writingSystem.orthographicDepth": "mixed", "writingSystem.transliterationSystems": [],
    "clauseStructure.canonicalOrders": ["Synthetic order"],
    "clauseStructure.argumentMarkingMechanisms": [{ mechanismId: "test.argument", mechanism: "context", applicability: "common", conditions: [], relevance: [] }],
  };
  assert.ok(slot in values, slot);
  setSlot(profile, slot, { state: "known", value: values[slot] });
}

function addClaim(profile: LanguageProfileV2, target: RequirementEvidenceTarget, suffix = "") {
  const slot = target.subjectRef.slot;
  const feature = syntheticFeature(slot);
  const subjectRef = !target.relevanceRequirement ? target.subjectRef : target.relevanceRequirement.scope === "feature"
    ? { kind: "feature", slot, featureId: feature.featureId }
    : { kind: "feature_mechanism", slot, featureId: feature.featureId, mechanismId: feature.mechanisms[0]!.mechanismId };
  const claim = evidenceClaimV2Schema.parse({
    claimId: `test.claim.${target.targetId}${suffix}`, statement: "Synthetic evidence claim",
    subjectRefs: [subjectRef], requirementEvidenceTargetRefs: [targetRef(target)],
    evidenceRefs: ["test.evidence.1", "test.evidence.2"].map((evidenceRef) => ({ evidenceRef, relationshipValidation: { status: "unvalidated" } })),
    confidence: "medium", reviewStatus: "cross_checked", requirementRefs: ["test.originating.requirement"],
    origin: { kind: "manual", authorRef: "test.author", recordedAt: "2026-09-06T00:00:00Z" },
  });
  profile.evidenceRegistry.claims.push(claim);
  return claim;
}

function fixture(domain: CurriculumRequirementDomain = "phonology.initial_intelligibility", complete = true): LanguageProfileV2 {
  const profile = languageProfileV2Schema.parse({
    schemaVersion: "2.0.0", version: "0.1.7", status: "canonical",
    identity: { profileId: "test.synthetic", languageId: "test", varietyId: "test.synthetic", languageName: "Synthetic language", varietyName: "Synthetic variety" },
    knowledge: Object.fromEntries(Object.entries(profileKnowledgeSectionsV2Schema.shape).map(([section, schema]) => [
      section, Object.fromEntries(Object.keys(schema.shape).map((field) => [field, { state: "unknown" }])),
    ])),
    evidenceRegistry: {
      sources: [1, 2].map((n) => ({
        sourceId: `test.source.${n}`, sourceType: "reference_book", title: `Synthetic source ${n}`, publisherOrAuthor: `Synthetic author ${n}`,
        reference: { kind: "bibliographic", citation: `Internal fixture ${n}` }, sourceLanguage: "test", authorityClass: "authoritative",
        independenceKey: { responsibleEntityId: `test.entity.${n}`, workId: `test.work.${n}`, lineageId: `test.lineage.${n}` },
      })),
      evidence: [1, 2].map((n) => ({ evidenceId: `test.evidence.${n}`, sourceRef: `test.source.${n}`, locator: `Synthetic section ${n}`, evidenceSummary: "Synthetic brief summary" })),
      claims: [], conflicts: [],
    },
  });
  if (complete) for (const group of entry(domain).groups.filter((group) => group.requirement === "required")) {
    for (const target of group.aggregation === "all" ? group.targets : group.targets.slice(0, 1)) {
      know(profile, target.subjectRef.slot);
      addClaim(profile, target);
    }
  }
  return languageProfileV2Schema.parse(profile);
}

const run = (profile: unknown, domain: CurriculumRequirementDomain = "phonology.initial_intelligibility") => resolveRequirementEvidence(requirement(domain), profile);
const allReasons = (result: RequirementEvidenceResolution) => result.gaps.map((gap) => gap.reason);
const hasReason = (result: RequirementEvidenceResolution, reason: RequirementEvidenceReason) => assert.ok(allReasons(result).includes(reason), `${reason}: ${JSON.stringify(allReasons(result))}`);
const targetResult = (result: RequirementEvidenceResolution, slot: ProfileKnowledgeSlotId) => result.groups.flatMap((group) => group.targets).find((target) => target.targetId.endsWith(`.${slot}`))!;
function human(profile: LanguageProfileV2, validated = true) {
  for (const claim of profile.evidenceRegistry.claims) {
    claim.reviewStatus = "human_reviewed";
    claim.evidenceRefs = [{ evidenceRef: "test.evidence.1", relationshipValidation: validated
      ? { status: "human_validated", validatorRef: "test.reviewer", validatedAt: "2026-09-06T00:00:00Z" }
      : { status: "unvalidated" } }];
  }
  return profile;
}

test("canonical plus all required subjects produces durable covered with exact JSON identity", () => {
  const profile = fixture("predication.identity_state");
  const result = run(profile, "predication.identity_state");
  assert.equal(result.status, "covered");
  assert.equal(result.durableConsumable, true);
  assert.equal(result.mode, "durable");
  assert.deepEqual([result.profileId, result.languageId, result.varietyId, result.profileVersion, result.schemaVersion, result.targetCatalogVersion], ["test.synthetic", "test", "test.synthetic", "0.1.7", "2.0.0", "1.0.0"]);
  assert.equal(result.requirementRef, requirement("predication.identity_state").requirementRef);
  assert.equal(result.acceptedClaims.length, 3);
  assert.equal(result.sourcesUsed.length, 2);
});

test("review candidates are epistemically evaluable in preview and never durable consumable", () => {
  const profile = fixture();
  profile.status = "review";
  const preview = resolveRequirementEvidence(requirement(), profile, { mode: "preview" });
  assert.equal(preview.status, "covered");
  assert.equal(preview.mode, "preview");
  assert.equal(preview.durableConsumable, false);
  assert.equal(resolveRequirementEvidence(requirement(), fixture(), { mode: "preview" }).durableConsumable, false);
});

for (const status of ["review", "draft", "deprecated"] as const) test(`${status} cannot produce durable covered`, () => {
  const profile = fixture();
  profile.status = status;
  const result = run(profile);
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
  hasReason(result, "profile_not_canonical");
});

test("unknown subject never covers even with a correctly targeted claim", () => {
  const profile = fixture();
  setSlot(profile, "phonology.segmentalSystem", { state: "unknown" });
  const result = run(profile);
  assert.equal(result.status, "missing");
  hasReason(result, "subject_unknown");
});

test("known subject without claim does not cover", () => {
  const profile = fixture();
  profile.evidenceRegistry.claims = [];
  assert.equal(run(profile).status, "missing");
  hasReason(run(profile), "claim_missing");
});

test("not_applicable without a claim is unsubstantiated", () => {
  const domain = "predication.identity_state";
  const profile = fixture(domain);
  setSlot(profile, "predicationSystem.identityPredication", { state: "not_applicable", reason: "Synthetic assertion" });
  profile.evidenceRegistry.claims.shift();
  const result = run(profile, domain);
  assert.equal(targetResult(result, "predicationSystem.identityPredication").status, "missing");
  hasReason(result, "not_applicable_unsubstantiated");
});

test("not_applicable requires its explicit exact subject-state assertion, never linguistic text", () => {
  const domain = "predication.identity_state";
  const profile = fixture(domain);
  setSlot(profile, "predicationSystem.identityPredication", { state: "not_applicable", reason: "Synthetic assertion" });
  const claim = profile.evidenceRegistry.claims[0]!;
  claim.statement = "This explicitly says not applicable in text, which must not be interpreted";
  assert.equal(run(profile, domain).status, "partial");
  claim.subjectStateAssertions = [{ subjectRef: claim.subjectRefs[0]!, state: "not_applicable" }];
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  assert.equal(run(profile, domain).status, "covered");
  claim.subjectStateAssertions[0]!.state = "known";
  hasReason(run(profile, domain), "claim_state_mismatch");
});

for (const reviewStatus of ["machine_synthesized", "needs_review"] as const) test(`${reviewStatus} alone is not useful eligible evidence`, () => {
  const profile = fixture();
  profile.evidenceRegistry.claims[0]!.reviewStatus = reviewStatus;
  const result = run(profile);
  assert.equal(result.status, "missing");
  assert.equal(result.acceptedClaims.length, 0);
  hasReason(result, "claim_review_status_ineligible");
});

test("human_reviewed with one authoritative and explicitly validated relation covers", () => {
  const result = run(human(fixture()));
  assert.equal(result.status, "covered");
  assert.deepEqual(result.sourcesUsed.map((source) => source.sourceId), ["test.source.1"]);
  assert.equal(result.acceptedClaims[0]!.evaluations[0]!.evidence[0]!.humanValidated, true);
});

test("human_reviewed without explicit relation validation cannot cover", () => {
  const result = run(human(fixture(), false));
  assert.equal(result.status, "missing");
  hasReason(result, "human_validation_missing");
});

test("authority derives only from authorityClass, never title, publisher or URL", () => {
  for (const authorityClass of ["reference", "community", "unassessed"] as const) {
    const profile = human(fixture());
    profile.evidenceRegistry.sources[0]!.authorityClass = authorityClass;
    profile.evidenceRegistry.sources[0]!.title = "Official authoritative source";
    profile.evidenceRegistry.sources[0]!.publisherOrAuthor = "Official authority";
    const result = run(profile);
    assert.equal(result.status, "missing");
    hasReason(result, "source_authority_insufficient");
  }
});

test("cross_checked accepts two structurally independent source identities", () => {
  const result = run(fixture());
  assert.equal(result.status, "covered");
  assert.deepEqual(result.acceptedClaims[0]!.evaluations[0]!.independentSourceRefs, ["test.source.1", "test.source.2"]);
});

test("cross_checked with one useful source is partial, not covered", () => {
  const profile = fixture();
  profile.evidenceRegistry.claims[0]!.evidenceRefs.pop();
  const result = run(profile);
  assert.equal(result.status, "partial");
  assert.equal(result.rejectedClaims.some((claim) => claim.usefulEvidence), true);
  hasReason(result, "source_independence_insufficient");
});

test("different URLs and hostnames for the same work do not establish independence", () => {
  const profile = fixture();
  profile.evidenceRegistry.sources.forEach((source, index) => {
    source.reference = { kind: "url", url: `https://mirror-${index}.invalid/reference`, accessedAt: "2026-09-06T00:00:00Z" };
    source.independenceKey.workId = "same.work";
  });
  assert.equal(run(profile).status, "partial");
  hasReason(run(profile), "source_independence_insufficient");
});

test("identical independenceKey is counted once", () => {
  const profile = fixture();
  profile.evidenceRegistry.sources[1]!.independenceKey = { ...profile.evidenceRegistry.sources[0]!.independenceKey };
  const result = run(profile);
  assert.equal(result.status, "partial");
  assert.equal(result.rejectedClaims[0]!.evaluations[0]!.independentSourceRefs.length, 1);
});

test("shared lineage or responsible entity also prevents independence", () => {
  for (const field of ["lineageId", "responsibleEntityId"] as const) {
    const profile = fixture();
    profile.evidenceRegistry.sources[1]!.independenceKey[field] = profile.evidenceRegistry.sources[0]!.independenceKey[field];
    assert.equal(run(profile).status, "partial");
  }
});

test("incomplete source identity never assumes independence", () => {
  const profile = fixture();
  const source = profile.evidenceRegistry.sources[1]!;
  const incomplete = { ...profile, evidenceRegistry: { ...profile.evidenceRegistry, sources: [
    profile.evidenceRegistry.sources[0], { ...source, independenceKey: { workId: source.independenceKey.workId } },
  ] } };
  const result = run(incomplete);
  assert.notEqual(result.status, "covered");
  hasReason(result, "source_independence_insufficient");
  hasReason(result, "source_contract_invalid");
});

test("independence selection finds a valid pair beyond a misleading first source", () => {
  const profile = fixture();
  const first = profile.evidenceRegistry.sources[0]!;
  const second = profile.evidenceRegistry.sources[1]!;
  first.independenceKey.workId = second.independenceKey.workId;
  profile.evidenceRegistry.sources.push({ ...second, sourceId: "test.source.3", independenceKey: {
    responsibleEntityId: first.independenceKey.responsibleEntityId, workId: "third.work", lineageId: "third.lineage",
  } });
  profile.evidenceRegistry.evidence.push({ ...profile.evidenceRegistry.evidence[0]!, evidenceId: "test.evidence.3", sourceRef: "test.source.3" });
  profile.evidenceRegistry.claims[0]!.evidenceRefs.push({ evidenceRef: "test.evidence.3", relationshipValidation: { status: "unvalidated" } });
  assert.equal(run(profile).status, "covered");
  assert.deepEqual(run(profile).acceptedClaims[0]!.evaluations[0]!.independentSourceRefs, ["test.source.2", "test.source.3"]);
});

for (const confidence of ["low", "contested"] as const) test(`${confidence} confidence is insufficient and does not create partial by mere presence`, () => {
  const profile = fixture();
  profile.evidenceRegistry.claims[0]!.confidence = confidence;
  const result = run(profile);
  assert.equal(result.status, "missing");
  hasReason(result, "claim_confidence_insufficient");
});

test("medium confidence is sufficient under the frozen baseline", () => {
  const profile = fixture();
  assert.equal(profile.evidenceRegistry.claims[0]!.confidence, "medium");
  assert.equal(run(profile).status, "covered");
});

function conflict(profile: LanguageProfileV2, claim = profile.evidenceRegistry.claims[0]!) {
  const alternative = structuredClone(claim);
  alternative.claimId += ".alternative";
  profile.evidenceRegistry.claims.push(alternative);
  profile.evidenceRegistry.conflicts.push({
    conflictId: `test.conflict.${claim.claimId}`, claimRefs: [claim.claimId, alternative.claimId],
    requirementEvidenceTargetRefs: [...claim.requirementEvidenceTargetRefs], conflictType: "contradiction", resolutionStatus: "unresolved", notes: "Synthetic conflict",
  });
  return profile.evidenceRegistry.conflicts.at(-1)!;
}

test("an open relevant conflict blocks the subject, including additional corroborating claims", () => {
  const profile = fixture();
  conflict(profile);
  addClaim(profile, target("phonology.initial_intelligibility", "phonology.segmentalSystem"), ".third");
  const result = run(profile);
  assert.equal(result.status, "partial");
  assert.equal(result.acceptedClaims.length, 0);
  assert.equal(result.conflicts.length, 1);
  hasReason(result, "open_conflict");
});

test("an unrelated conflict does not block the whole profile", () => {
  const profile = fixture();
  know(profile, "nominalSystem.numberMarking");
  const unrelated = addClaim(profile, target("nominal.beginner_package", "nominalSystem.numberMarking"));
  conflict(profile, unrelated);
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  const result = run(profile);
  assert.equal(result.status, "covered");
  assert.equal(result.conflicts.length, 0);
});

test("a resolved conflict is reported but does not block coverage", () => {
  const profile = fixture();
  conflict(profile).resolutionStatus = "resolved_by_evidence";
  const result = run(profile);
  assert.equal(result.status, "covered");
  assert.equal(result.conflicts.length, 1);
  assert.equal(allReasons(result).includes("open_conflict"), false);
});

test("conflicts are subject-specific inside a shared collection target", () => {
  const domain = "phonology.initial_intelligibility";
  const profile = fixture(domain, false);
  const selected = target(domain, "phonology.intelligibilityRelevantFeatures");
  const first = syntheticFeature(selected.subjectRef.slot);
  const second = syntheticFeature(selected.subjectRef.slot, ".second");
  setSlot(profile, selected.subjectRef.slot, { state: "known", value: [first, second] });
  conflict(profile, addClaim(profile, selected));
  const secondClaim = addClaim(profile, selected, ".second");
  secondClaim.subjectRefs = [{ kind: "feature", slot: "phonology.intelligibilityRelevantFeatures", featureId: second.featureId }];
  const result = run(profile);
  assert.equal(result.status, "covered");
  const subjects = targetResult(result, selected.subjectRef.slot).subjects;
  assert.deepEqual(subjects.map((subject) => subject.status).sort(), ["covered", "partial"]);
  assert.equal(result.acceptedClaims.length, 1);
});

test("required/all with two of three subjects is partial", () => {
  const profile = fixture("predication.identity_state");
  profile.evidenceRegistry.claims.pop();
  const result = run(profile, "predication.identity_state");
  assert.equal(result.status, "partial");
  assert.equal(result.groups[0]!.status, "partial");
});

test("required/any needs exactly one eligible subject and does not require all alternatives", () => {
  const result = run(fixture());
  assert.equal(result.status, "covered");
  assert.equal(result.groups[0]!.targets.filter((target) => target.status === "covered").length, 1);
  assert.equal(result.groups[0]!.targets.filter((target) => target.status === "missing").length, 8);
});

test("required/any without eligible subjects is missing", () => {
  assert.equal(run(fixture("phonology.initial_intelligibility", false)).status, "missing");
});

test("optional missing is reported and does not block covered", () => {
  const result = run(fixture("participant.basic_reference"), "participant.basic_reference");
  assert.equal(result.status, "covered");
  assert.equal(result.groups.find((group) => group.requirement === "optional")!.status, "missing");
});

test("optional evidence alone cannot create partial for missing required groups", () => {
  const domain = "participant.basic_reference";
  const profile = fixture(domain, false);
  know(profile, "participantReference.animacyDistinctions");
  addClaim(profile, target(domain, "participantReference.animacyDistinctions"));
  assert.equal(run(profile, domain).status, "missing");
});

test("correct target with incorrect subject is rejected", () => {
  const profile = fixture();
  know(profile, "phonology.stressSystem");
  profile.evidenceRegistry.claims[0]!.subjectRefs = [{ kind: "feature", slot: "phonology.stressSystem", featureId: syntheticFeature("phonology.stressSystem").featureId }];
  const result = run(profile);
  assert.notEqual(result.status, "covered");
  hasReason(result, "claim_wrong_subject");
});

test("correct subject with incorrect target cannot produce partial", () => {
  const profile = fixture();
  profile.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs = [targetRef(target("phonology.initial_intelligibility", "phonology.stressSystem"))];
  const result = run(profile);
  assert.equal(result.status, "missing");
  hasReason(result, "claim_wrong_target");
});

test("missing sourceRef is traced to exact source/evidence/claim and cannot be ignored", () => {
  const profile = fixture();
  profile.evidenceRegistry.evidence[1]!.sourceRef = "test.source.missing";
  const result = run(profile);
  assert.notEqual(result.status, "covered");
  assert.ok(result.gaps.some((gap) => gap.reason === "source_missing" && gap.sourceRef === "test.source.missing" && gap.evidenceRef === "test.evidence.2" && gap.claimRef === profile.evidenceRegistry.claims[0]!.claimId));
});

test("stricter target policy applies additively and cannot be weakened", () => {
  const profile = fixture();
  const ref = profile.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs[0]!;
  const options = { targetPolicies: [{ targetRef: ref, policy: { crossCheckedMinimumIndependentSources: 3 } }] };
  const result = resolveRequirementEvidence(requirement(), profile, options);
  assert.equal(result.status, "partial");
  hasReason(result, "target_policy_unsatisfied");
  assert.throws(() => resolveRequirementEvidence(requirement(), profile, { targetPolicies: [{ targetRef: ref, policy: { crossCheckedMinimumIndependentSources: 1 } }] }));
  assert.throws(() => resolveRequirementEvidence(requirement(), profile, { targetPolicies: [options.targetPolicies[0]!, options.targetPolicies[0]!] }));
  assert.equal(resolveRequirementEvidence(requirement(), profile, { targetPolicies: [{ targetRef: ref, policy: { allowedReviewStatuses: ["human_reviewed"] } }] }).status, "partial");
});

test("stricter human policy counts distinct authoritative sources and explicit relations", () => {
  const profile = human(fixture());
  const ref = profile.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs[0]!;
  const options = { targetPolicies: [{ targetRef: ref, policy: { humanReviewedMinimumAuthoritativeSources: 2 } }] };
  assert.equal(resolveRequirementEvidence(requirement(), profile, options).status, "partial");
  profile.evidenceRegistry.claims[0]!.evidenceRefs.push({ evidenceRef: "test.evidence.2", relationshipValidation: { status: "human_validated", validatorRef: "test.reviewer", validatedAt: "2026-09-06T00:00:00Z" } });
  assert.equal(resolveRequirementEvidence(requirement(), profile, options).status, "covered");
});

test("known empty inventory can cover when supported by eligible exact-slot evidence", () => {
  const profile = fixture("writing.beginner_system");
  assert.deepEqual(profile.knowledge.writingSystem.transliterationSystems, { state: "known", value: [] });
  const result = run(profile, "writing.beginner_system");
  assert.equal(result.status, "covered");
  assert.equal(targetResult(result, "writingSystem.transliterationSystems").status, "covered");
});

test("blanket collection refs cannot substitute for a relevant exact feature", () => {
  const domain = "phonology.initial_intelligibility";
  const profile = fixture(domain, false);
  const selected = target(domain, "phonology.intelligibilityRelevantFeatures");
  know(profile, selected.subjectRef.slot);
  addClaim(profile, selected).subjectRefs = [selected.subjectRef];
  assert.equal(run(profile).status, "missing");
  hasReason(run(profile), "claim_wrong_subject");
});

test("phonology relevance must be explicitly annotated; names and prose do not count", () => {
  const profile = fixture();
  const knowledge = profile.knowledge.phonology.segmentalSystem;
  assert.equal(knowledge.state, "known");
  if (knowledge.state === "known") {
    knowledge.value.relevance = [];
    knowledge.value.description = "Highly relevant for intelligibility";
  }
  assert.equal(run(profile).status, "missing");
  hasReason(run(profile), "subject_relevance_missing");
});

test("not_applicable cannot bypass the existential relevance requirement of an any group", () => {
  const profile = fixture();
  const claim = profile.evidenceRegistry.claims[0]!;
  setSlot(profile, "phonology.segmentalSystem", { state: "not_applicable", reason: "Synthetic" });
  claim.subjectRefs = [{ kind: "slot", slot: "phonology.segmentalSystem" }];
  claim.subjectStateAssertions = [{ subjectRef: claim.subjectRefs[0]!, state: "not_applicable" }];
  assert.equal(run(profile).status, "missing");
});

test("age requires a grounded exact mechanism, not a feature or section alone", () => {
  const profile = fixture("age.basic_expression");
  const claim = profile.evidenceRegistry.claims.find((claim) => claim.subjectRefs[0]!.kind === "feature_mechanism")!;
  const ref = claim.subjectRefs[0]!;
  assert.ok(ref.kind === "feature_mechanism");
  claim.subjectRefs = [{ kind: "feature", slot: ref.slot, featureId: ref.featureId }];
  assert.equal(run(profile, "age.basic_expression").status, "partial");
  hasReason(run(profile, "age.basic_expression"), "claim_wrong_subject");
});

for (const domain of CURRICULUM_REQUIREMENT_DOMAINS) test(`${domain} is resolvable with synthetic S1 contracts`, () => {
  const profile = fixture(domain);
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  assert.equal(run(profile, domain).status, "covered");
});

for (const [domain, onlySlot] of [
  ["age.basic_expression", "semanticSystems.age"],
  ["possession.basic", "semanticSystems.possession"],
  ["localization.first_contact", "identity.regionScope"],
] as const) test(`${domain}: ${onlySlot} alone is insufficient`, () => {
  const profile = fixture(domain, false);
  know(profile, onlySlot);
  addClaim(profile, target(domain, onlySlot));
  assert.equal(run(profile, domain).status, "partial");
});

test("action requires clause order and argument marking in addition to verbal facts", () => {
  const domain = "action.basic_pattern";
  const profile = fixture(domain);
  for (const slot of ["clauseStructure.canonicalOrders", "clauseStructure.orderFlexibility", "clauseStructure.argumentMarkingMechanisms"] as const) setSlot(profile, slot, { state: "unknown" });
  const result = run(profile, domain);
  assert.equal(result.status, "partial");
  assert.equal(targetResult(result, "clauseStructure.canonicalOrders").status, "missing");
  assert.equal(targetResult(result, "clauseStructure.argumentMarkingMechanisms").status, "missing");
});

test("historical profileCoverage and coverageDepth are never evidence authority in v2", () => {
  const profile = fixture();
  const result = run(profile);
  assert.deepEqual(run({ ...profile, profileCoverage: germanLanguageProfileFixture.profileCoverage }), result);
  assert.deepEqual(run({ ...profile, profileCoverage: [{ coverageDepth: "comprehensive", coverageStatus: "reviewed" }] }), result);
  // No coverageDepth field exists in S1 v2; the resolver must not invent one.
  profile.evidenceRegistry.claims = [];
  assert.equal(run({ ...profile, profileCoverage: germanLanguageProfileFixture.profileCoverage }).status, "missing");
});

test("German v1 and unsupported schema versions cannot be interpreted as v2", () => {
  const result = run(germanLanguageProfileFixture);
  assert.equal(result.status, "missing");
  assert.equal(result.schemaVersion, null);
  assert.equal(result.acceptedClaims.length, 0);
  hasReason(result, "unsupported_schema_version");
  for (const schemaVersion of ["1.0.0", "3.0.0", undefined]) {
    const unsupported = run({ ...fixture(), schemaVersion });
    assert.equal(unsupported.status, "missing");
    hasReason(unsupported, "unsupported_schema_version");
  }
});

test("missing and malformed slots are diagnosed without trusting invalid profiles", () => {
  const profile = fixture();
  const incomplete = { ...profile, knowledge: { ...profile.knowledge, phonology: {} } };
  const result = run(incomplete);
  assert.equal(result.status, "missing");
  hasReason(result, "subject_missing");
  hasReason(result, "profile_contract_invalid");
  const malformed = { ...profile, knowledge: { ...profile.knowledge, phonology: { ...profile.knowledge.phonology, segmentalSystem: {} } } };
  hasReason(run(malformed), "subject_invalid");
});

test("explicit state assertions remain typed, exact and additive to S1", () => {
  const profile = fixture();
  const claim = profile.evidenceRegistry.claims[0]!;
  assert.equal(evidenceClaimV2Schema.safeParse({ ...claim, subjectStateAssertions: [{ subjectRef: claim.subjectRefs[0], state: "invented" }] }).success, false);
  claim.subjectStateAssertions = [{ subjectRef: { kind: "slot", slot: "phonology.stressSystem" }, state: "not_applicable" }];
  assert.equal(languageProfileV2Schema.safeParse(profile).success, false);
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test("resolver is deterministic, mutation-free and insensitive to irrelevant ordering", () => {
  const profile = fixture("age.basic_expression");
  // Exercise set-like ordering with actual multi-subject/multi-target claims.
  const firstClaim = profile.evidenceRegistry.claims[0]!;
  const secondClaim = profile.evidenceRegistry.claims[1]!;
  firstClaim.subjectRefs.push(...secondClaim.subjectRefs);
  firstClaim.requirementEvidenceTargetRefs.push(...secondClaim.requirementEvidenceTargetRefs);
  firstClaim.requirementRefs.push("test.second.requirement");
  firstClaim.subjectStateAssertions = firstClaim.subjectRefs.map((subjectRef) => ({ subjectRef, state: "known" }));
  conflict(profile).resolutionStatus = "accepted_variation";
  const req = requirement("age.basic_expression");
  const beforeProfile = structuredClone(profile);
  const beforeRequirement = structuredClone(req);
  const beforeCatalog = structuredClone(catalog);
  const beforePolicy = structuredClone(BASELINE_EVIDENCE_POLICY_V2);
  const options = deepFreeze({ mode: "preview" as const });
  const first = resolveRequirementEvidence(deepFreeze(req), deepFreeze(profile), options);
  assert.deepEqual(resolveRequirementEvidence(req, profile, options), first);
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(req, beforeRequirement);
  assert.deepEqual(catalog, beforeCatalog);
  assert.deepEqual(BASELINE_EVIDENCE_POLICY_V2, beforePolicy);
  const reordered = structuredClone(profile);
  reordered.evidenceRegistry.claims.reverse();
  reordered.evidenceRegistry.sources.reverse();
  reordered.evidenceRegistry.evidence.reverse();
  reordered.evidenceRegistry.conflicts.reverse();
  for (const claim of reordered.evidenceRegistry.claims) {
    claim.evidenceRefs.reverse(); claim.subjectRefs.reverse(); claim.requirementEvidenceTargetRefs.reverse(); claim.requirementRefs.reverse();
    claim.subjectStateAssertions?.reverse();
  }
  reordered.evidenceRegistry.conflicts.forEach((conflict) => { conflict.claimRefs.reverse(); conflict.requirementEvidenceTargetRefs.reverse(); });
  assert.deepEqual(resolveRequirementEvidence(req, reordered, options), first);
  for (const reason of allReasons(first)) assert.equal(requirementEvidenceReasonSchema.safeParse(reason).success, true);
});

test("text changes cannot decide linguistic coverage", () => {
  const profile = fixture();
  const original = run(profile);
  profile.evidenceRegistry.claims[0]!.statement = "Different text, not_applicable covered missing unknown";
  assert.deepEqual(run(profile), original);
});

const orphanSubject = { kind: "feature", slot: "phonology.segmentalSystem", featureId: "zzz.missing.feature" } as const;

test("fix 1 A: a valid claim remains locally accepted, useful and covered", () => {
  const profile = fixture();
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  const result = run(profile);
  const local = targetResult(result, "phonology.segmentalSystem");
  assert.equal(result.acceptedClaims.length, 1);
  assert.equal(result.acceptedClaims[0]!.claimId, profile.evidenceRegistry.claims[0]!.claimId);
  assert.equal(result.acceptedClaims[0]!.usefulEvidence, true);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.equal(local.status, "covered");
  assert.equal(local.usefulEvidence, true);
  assert.equal(result.status, "covered");
  assert.equal(result.durableConsumable, true);
});

test("fix 1 B: mixed valid and orphan subjects invalidate the whole claim with exact diagnostics", () => {
  const profile = fixture();
  const claim = profile.evidenceRegistry.claims[0]!;
  claim.subjectRefs.push(orphanSubject);
  const validation = languageProfileV2Schema.safeParse(profile);
  assert.equal(validation.success, false);
  if (validation.success) assert.fail("Expected S1 rejection");
  assert.ok(validation.error.issues.some((issue) => issue.path.join(".") === "evidenceRegistry.claims.0.subjectRefs.1"));
  const result = run(profile);
  assert.deepEqual(result.acceptedClaims, []);
  const rejected = result.rejectedClaims.find((entry) => entry.claimId === claim.claimId)!;
  assert.ok(rejected);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.usefulEvidence, false);
  assert.ok(rejected.reasons.includes("claim_contract_invalid"));
  const diagnostic = rejected.contractGaps.find((entry) => entry.validationIssue?.path === "evidenceRegistry.claims.0.subjectRefs.1")!;
  assert.ok(diagnostic);
  assert.equal(diagnostic.claimRef, claim.claimId);
  assert.deepEqual(diagnostic.subjectRef, orphanSubject);
  assert.equal(diagnostic.validationIssue!.code, "STRUCTURAL_VALIDATION_ERROR");
  assert.equal(diagnostic.validationIssue!.severity, "error");
  assert.ok(result.gaps.some((entry) => entry.groupId === "phonology.initial_intelligibility.intelligibility" &&
    entry.targetId === "phonology.initial_intelligibility.phonology.segmentalSystem" &&
    entry.claimRef === claim.claimId && entry.subjectRef?.kind === "feature" && entry.subjectRef.featureId === orphanSubject.featureId));
  assert.equal(targetResult(result, "phonology.segmentalSystem").status, "missing");
  assert.equal(targetResult(result, "phonology.segmentalSystem").usefulEvidence, false);
  assert.equal(result.status, "missing");
  assert.equal(result.durableConsumable, false);
  assert.deepEqual(result.sourcesUsed, []);
});

test("fix 1 C: an invalid sibling cannot poison or borrow acceptance from a healthy claim", () => {
  const profile = fixture();
  const healthy = profile.evidenceRegistry.claims[0]!;
  const invalid = addClaim(profile, target("phonology.initial_intelligibility", "phonology.segmentalSystem"), ".invalid");
  invalid.subjectRefs.push(orphanSubject);
  const result = run(profile);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthy.claimId]);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.equal(result.acceptedClaims[0]!.usefulEvidence, true);
  assert.ok(result.rejectedClaims.some((entry) => entry.claimId === invalid.claimId && !entry.usefulEvidence && entry.reasons.includes("claim_contract_invalid")));
  assert.equal(targetResult(result, "phonology.segmentalSystem").status, "covered");
  assert.equal(result.status, "partial"); // The global invalid-profile gate remains.
  assert.equal(result.durableConsumable, false);
});

test("fix 1 D: an invalid claim in another domain remains localized without rejecting the relevant claim", () => {
  const profile = fixture();
  const healthyId = profile.evidenceRegistry.claims[0]!.claimId;
  know(profile, "nominalSystem.numberMarking");
  const unrelated = addClaim(profile, target("nominal.beginner_package", "nominalSystem.numberMarking"));
  const unrelatedOrphan = { kind: "feature", slot: "nominalSystem.numberMarking", featureId: "zzz.missing.nominal" } as const;
  unrelated.subjectRefs.push(unrelatedOrphan);
  const result = run(profile);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthyId]);
  assert.deepEqual(result.rejectedClaims, []);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.ok(result.gaps.some((entry) => entry.claimRef === unrelated.claimId &&
    entry.validationIssue?.path.includes("subjectRefs") && entry.subjectRef?.kind === "feature" &&
    entry.subjectRef.featureId === unrelatedOrphan.featureId));
  assert.equal(targetResult(result, "phonology.segmentalSystem").status, "covered");
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
});

test("fix 1 E: several semantically invalid claims cannot create useful evidence or partial", () => {
  const profile = fixture();
  const first = profile.evidenceRegistry.claims[0]!;
  first.subjectRefs.push(orphanSubject);
  const second = addClaim(profile, target("phonology.initial_intelligibility", "phonology.segmentalSystem"), ".second");
  second.evidenceRefs.push({ evidenceRef: "zzz.missing.evidence", relationshipValidation: { status: "unvalidated" } });
  const result = run(profile);
  assert.deepEqual(result.acceptedClaims, []);
  assert.equal(result.rejectedClaims.length, 2);
  assert.ok(result.rejectedClaims.every((entry) => entry.status === "rejected" && !entry.usefulEvidence && entry.reasons.includes("claim_contract_invalid")));
  assert.ok(result.groups.flatMap((group) => group.targets).every((entry) => entry.status === "missing" && !entry.usefulEvidence));
  assert.equal(result.status, "missing");
  assert.equal(result.durableConsumable, false);
});

test("fix 1 F: invalid-claim decisions and localized diagnostics are deterministic under reference reordering", () => {
  const profile = fixture();
  profile.evidenceRegistry.claims[0]!.subjectRefs.push(orphanSubject);
  addClaim(profile, target("phonology.initial_intelligibility", "phonology.segmentalSystem"), ".healthy");
  const before = structuredClone(profile);
  const first = run(deepFreeze(profile));
  const reordered = structuredClone(profile);
  reordered.evidenceRegistry.claims.reverse();
  reordered.evidenceRegistry.evidence.reverse();
  reordered.evidenceRegistry.sources.reverse();
  for (const claim of reordered.evidenceRegistry.claims) {
    claim.subjectRefs.reverse();
    claim.evidenceRefs.reverse();
    claim.requirementEvidenceTargetRefs.reverse();
  }
  assert.deepEqual(run(reordered), first);
  assert.deepEqual(run(profile), first);
  assert.deepEqual(profile, before);
});

test("fix 1: malformed unrelated knowledge cannot suppress S1 claim integrity checks", () => {
  const profile = fixture();
  const invalid = profile.evidenceRegistry.claims[0]!;
  invalid.subjectRefs.push(orphanSubject);
  const healthy = addClaim(profile, target("phonology.initial_intelligibility", "phonology.segmentalSystem"), ".healthy");
  setSlot(profile, "nominalSystem.numberMarking", { state: "known", value: {} });
  const result = run(profile);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthy.claimId]);
  assert.ok(result.rejectedClaims.some((entry) => entry.claimId === invalid.claimId && !entry.usefulEvidence && entry.contractGaps.some((gap) => gap.subjectRef?.kind === "feature" && gap.subjectRef.featureId === orphanSubject.featureId)));
  assert.ok(result.gaps.some((entry) => entry.validationIssue?.path.startsWith("knowledge.nominalSystem.numberMarking")));
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
});

for (const defect of ["duplicate_reference", "undeclared_assertion", "ungrounded_target", "missing_source"] as const) {
  test(`fix 1: ${defect} rejects the whole claim locally`, () => {
    const profile = fixture();
    const claim = profile.evidenceRegistry.claims[0]!;
    if (defect === "duplicate_reference") claim.subjectRefs.push(claim.subjectRefs[0]!);
    if (defect === "undeclared_assertion") claim.subjectStateAssertions = [{ subjectRef: { kind: "slot", slot: "phonology.stressSystem" }, state: "known" }];
    if (defect === "ungrounded_target") claim.requirementEvidenceTargetRefs.push(targetRef(target("nominal.beginner_package", "nominalSystem.numberMarking")));
    if (defect === "missing_source") profile.evidenceRegistry.evidence[1]!.sourceRef = "zzz.missing.source";
    assert.equal(languageProfileV2Schema.safeParse(profile).success, false);
    const result = run(profile);
    assert.deepEqual(result.acceptedClaims, []);
    assert.ok(result.rejectedClaims.every((entry) => !entry.usefulEvidence && entry.reasons.includes("claim_contract_invalid")));
    assert.ok(result.rejectedClaims.some((entry) => entry.contractGaps.length > 0));
    assert.equal(targetResult(result, "phonology.segmentalSystem").status, "missing");
    assert.equal(result.status, "missing");
  });
}

for (const registryKind of ["claims", "evidence", "sources"] as const) for (const malformedUnrelated of [false, true]) {
  test(`fix 1: ambiguous ${registryKind} IDs isolate affected claims (unrelated malformed: ${malformedUnrelated})`, () => {
    const profile = fixture();
    const invalidId = profile.evidenceRegistry.claims[0]!.claimId;
    const healthy = addClaim(profile, target("phonology.initial_intelligibility", "phonology.segmentalSystem"), ".healthy");
    healthy.evidenceRefs = [healthy.evidenceRefs[1]!];
    healthy.reviewStatus = "human_reviewed";
    healthy.evidenceRefs[0]!.relationshipValidation = { status: "human_validated", validatorRef: "test.reviewer", validatedAt: "2026-09-06T00:00:00Z" };
    if (registryKind === "claims") profile.evidenceRegistry.claims.push(structuredClone(profile.evidenceRegistry.claims[0]!));
    if (registryKind === "evidence") profile.evidenceRegistry.evidence.push(structuredClone(profile.evidenceRegistry.evidence[0]!));
    if (registryKind === "sources") profile.evidenceRegistry.sources.push(structuredClone(profile.evidenceRegistry.sources[0]!));
    if (malformedUnrelated) setSlot(profile, "nominalSystem.numberMarking", { state: "known", value: {} });
    const result = run(profile);
    assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthy.claimId]);
    assert.ok(result.rejectedClaims.filter((entry) => entry.claimId === invalidId).every((entry) => !entry.usefulEvidence && entry.reasons.includes("claim_contract_invalid")));
    assert.equal(result.status, "partial");
    assert.equal(result.durableConsumable, false);
  });
}

test("fix 1: human validation and preview cannot promote a semantically invalid claim", () => {
  const profile = human(fixture());
  profile.status = "review";
  profile.evidenceRegistry.claims[0]!.subjectRefs.push(orphanSubject);
  const result = resolveRequirementEvidence(requirement(), profile, { mode: "preview" });
  assert.deepEqual(result.acceptedClaims, []);
  assert.ok(result.rejectedClaims.every((entry) => !entry.usefulEvidence));
  assert.equal(targetResult(result, "phonology.segmentalSystem").status, "missing");
  assert.equal(result.status, "missing");
  assert.equal(result.durableConsumable, false);
});

function independenceFixture(count: number) {
  const profile = fixture();
  const source = profile.evidenceRegistry.sources[0]!;
  const evidence = profile.evidenceRegistry.evidence[0]!;
  profile.evidenceRegistry.sources = Array.from({ length: count }, (_, index) => {
    const id = String(index).padStart(2, "0");
    return { ...source, sourceId: `bounded.source.${id}`, independenceKey: {
      responsibleEntityId: `bounded.entity.${id}`, workId: `bounded.work.${id}`, lineageId: `bounded.lineage.${id}`,
    } };
  });
  profile.evidenceRegistry.evidence = profile.evidenceRegistry.sources.map((entry, index) => ({
    ...evidence, evidenceId: `bounded.evidence.${String(index).padStart(2, "0")}`, sourceRef: entry.sourceId,
  }));
  profile.evidenceRegistry.claims[0]!.evidenceRefs = profile.evidenceRegistry.evidence.map((entry) => ({
    evidenceRef: entry.evidenceId, relationshipValidation: { status: "unvalidated" },
  }));
  return profile;
}

function independenceOptions(profile: LanguageProfileV2, minimum: number) {
  return { targetPolicies: [{ targetRef: profile.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs[0]!,
    policy: { crossCheckedMinimumIndependentSources: minimum } }] };
}

test("fix 2 A: small sufficient sets retain the exact canonical witness without new gaps", () => {
  const result = run(independenceFixture(3));
  assert.equal(result.status, "covered");
  const claim = result.acceptedClaims[0]!.evaluations[0]!;
  assert.equal(claim.independenceEvaluation, "evaluated");
  assert.deepEqual(claim.independentSourceRefs, ["bounded.source.00", "bounded.source.01"]);
  assert.deepEqual(claim.reasons, []);
  assert.deepEqual(targetResult(result, "phonology.segmentalSystem").subjects[0]!.gaps, []);
});

test("fix 2 B: small insufficient sets retain the exact largest insufficient witness", () => {
  const profile = independenceFixture(4);
  profile.evidenceRegistry.sources.forEach((source, index) => { source.independenceKey.workId = `pair.${Math.floor(index / 2)}`; });
  const result = resolveRequirementEvidence(requirement(), profile, independenceOptions(profile, 3));
  const claim = result.rejectedClaims[0]!.evaluations[0]!;
  assert.equal(claim.independenceEvaluation, "evaluated");
  assert.deepEqual(claim.independentSourceRefs, ["bounded.source.00", "bounded.source.02"]);
  assert.ok(claim.reasons.includes("source_independence_insufficient"));
  assert.equal(claim.usefulEvidence, true);
  assert.equal(result.status, "partial");
});

for (const priorFailure of ["contract", "unknown", "target", "state", "confidence", "machine", "needs_review", "policy", "conflict", "human_authority", "human_validation"] as const) {
  test(`fix 2 C: ${priorFailure} skips independence before the size guard or exact search`, () => {
    const profile = independenceFixture(40);
    profile.evidenceRegistry.sources.forEach((source, index) => { source.independenceKey.workId = `group.${index % 10}`; });
    const claim = profile.evidenceRegistry.claims[0]!;
    const options = independenceOptions(profile, independenceLimits.maximumRequiredIndependentSources);
    let expected: RequirementEvidenceReason;
    switch (priorFailure) {
      case "contract": claim.subjectRefs.push(orphanSubject); expected = "claim_contract_invalid"; break;
      case "unknown": setSlot(profile, "phonology.segmentalSystem", { state: "unknown" }); expected = "subject_unknown"; break;
      case "target": claim.requirementEvidenceTargetRefs = [targetRef(target("phonology.initial_intelligibility", "phonology.stressSystem"))]; expected = "claim_wrong_target"; break;
      case "state": claim.subjectStateAssertions = [{ subjectRef: claim.subjectRefs[0]!, state: "not_applicable" }]; expected = "claim_state_mismatch"; break;
      case "confidence": claim.confidence = "low"; expected = "claim_confidence_insufficient"; break;
      case "machine": claim.reviewStatus = "machine_synthesized"; expected = "claim_review_status_ineligible"; break;
      case "needs_review": claim.reviewStatus = "needs_review"; expected = "claim_review_status_ineligible"; break;
      case "policy": expected = "target_policy_unsatisfied"; break;
      case "conflict": conflict(profile); expected = "open_conflict"; break;
      case "human_authority": claim.reviewStatus = "human_reviewed"; profile.evidenceRegistry.sources.forEach((source) => { source.authorityClass = "reference"; }); expected = "source_authority_insufficient"; break;
      case "human_validation": claim.reviewStatus = "human_reviewed"; expected = "human_validation_missing"; break;
    }
    const result = resolveRequirementEvidence(requirement(), profile, priorFailure === "policy"
      ? { targetPolicies: [{ targetRef: claim.requirementEvidenceTargetRefs[0]!, policy: { allowedReviewStatuses: ["human_reviewed"] } }] } : options);
    assert.deepEqual(result.acceptedClaims, []);
    assert.ok(result.rejectedClaims.some((entry) => entry.reasons.includes(expected)));
    assert.ok(result.claimEvaluations.every((entry) => entry.independenceEvaluation === "skipped" && entry.independentSourceRefs.length === 0));
    assert.ok(result.rejectedClaims.every((entry) => !entry.reasons.includes("independence_evaluation_limit_exceeded")));
    assert.equal(result.durableConsumable, false);
  });
}

test("fix 2: eligible human claims do not search independence or inherit its source cap", () => {
  const profile = independenceFixture(40);
  const claim = profile.evidenceRegistry.claims[0]!;
  claim.reviewStatus = "human_reviewed";
  claim.evidenceRefs[0]!.relationshipValidation = { status: "human_validated", validatorRef: "test.reviewer", validatedAt: "2026-09-07T00:00:00Z" };
  const result = run(profile);
  assert.equal(result.status, "covered");
  assert.equal(result.acceptedClaims[0]!.evaluations[0]!.independenceEvaluation, "skipped");
  assert.deepEqual(result.acceptedClaims[0]!.evaluations[0]!.independentSourceRefs, []);
  assert.equal(result.acceptedClaims[0]!.evaluations[0]!.sourceRefs.length, 40);
  assert.deepEqual(result.acceptedClaims[0]!.evaluations[0]!.usedSourceRefs, ["bounded.source.00"]);
});

test("fix 2 D: exact maximum sources and minimum are supported without a limit gap", () => {
  const profile = independenceFixture(independenceLimits.maximumSourcesPerClaim);
  const options = independenceOptions(profile, independenceLimits.maximumRequiredIndependentSources);
  assert.equal(targetEvidencePolicySchema.safeParse(options.targetPolicies[0]!.policy).success, true);
  const result = resolveRequirementEvidence(requirement(), profile, options);
  assert.equal(result.status, "covered");
  assert.equal(result.acceptedClaims[0]!.evaluations[0]!.independenceEvaluation, "evaluated");
  assert.deepEqual(result.acceptedClaims[0]!.evaluations[0]!.independentSourceRefs, profile.evidenceRegistry.sources.map((source) => source.sourceId));
  assert.ok(!allReasons(result).includes("independence_evaluation_limit_exceeded"));
});

test("fix 2 E: above the source cap rejects without search, truncation or a fabricated witness", () => {
  const profile = independenceFixture(independenceLimits.maximumSourcesPerClaim + 1);
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true); // An evaluation limit, not invalid provenance.
  const result = run(profile);
  assert.deepEqual(result.acceptedClaims, []);
  const claim = result.rejectedClaims[0]!.evaluations[0]!;
  assert.equal(claim.independenceEvaluation, "limit_exceeded");
  assert.deepEqual(claim.reasons, ["independence_evaluation_limit_exceeded"]);
  assert.equal(claim.sourceRefs.length, independenceLimits.maximumSourcesPerClaim + 1);
  assert.equal(claim.evidence.length, independenceLimits.maximumSourcesPerClaim + 1);
  assert.deepEqual(claim.independentSourceRefs, []);
  assert.deepEqual(claim.usedSourceRefs, []);
  assert.equal(claim.usefulEvidence, true); // Valid relevant evidence remains useful, never sufficient.
  assert.equal(targetResult(result, "phonology.segmentalSystem").status, "partial");
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
  assert.ok(result.gaps.some((gap) => gap.reason === "independence_evaluation_limit_exceeded" &&
    gap.claimRef === profile.evidenceRegistry.claims[0]!.claimId && gap.targetId === "phonology.initial_intelligibility.phonology.segmentalSystem"));
});

test("fix 2 F: excessive independent minima fail contractual validation before resolution", () => {
  const profile = independenceFixture(2);
  for (const minimum of [independenceLimits.maximumRequiredIndependentSources + 1, 21, 31]) {
    const options = independenceOptions(profile, minimum);
    assert.equal(targetEvidencePolicySchema.safeParse(options.targetPolicies[0]!.policy).success, false);
    assert.throws(() => resolveRequirementEvidence(requirement(), profile, options), (error: unknown) => {
      assert.ok(error instanceof Error && error.name === "ZodError");
      return true;
    });
  }
  assert.equal(profile.evidenceRegistry.claims[0]!.evidenceRefs.length, 2);
});

test("fix 2 G: maximum adversarial and over-limit sets have identical outputs after reordering", () => {
  for (const size of [independenceLimits.maximumSourcesPerClaim, independenceLimits.maximumSourcesPerClaim + 1]) {
    const profile = independenceFixture(size);
    profile.evidenceRegistry.sources.forEach((source, index) => { source.independenceKey.workId = `pair.${Math.floor(index / 2)}`; });
    const options = independenceOptions(profile, 7);
    const original = structuredClone(profile);
    const result = resolveRequirementEvidence(requirement(), deepFreeze(profile), options);
    const reordered = structuredClone(profile);
    reordered.evidenceRegistry.sources.reverse();
    reordered.evidenceRegistry.evidence.reverse();
    reordered.evidenceRegistry.claims[0]!.evidenceRefs.reverse();
    assert.deepEqual(resolveRequirementEvidence(requirement(), reordered, options), result);
    assert.deepEqual(profile, original);
    assert.equal(result.rejectedClaims[0]!.evaluations[0]!.independenceEvaluation, size === independenceLimits.maximumSourcesPerClaim ? "evaluated" : "limit_exceeded");
    if (size === independenceLimits.maximumSourcesPerClaim) {
      assert.deepEqual(result.rejectedClaims[0]!.evaluations[0]!.independentSourceRefs, ["bounded.source.00", "bounded.source.02", "bounded.source.04", "bounded.source.06", "bounded.source.08", "bounded.source.10"]);
    }
  }
});

test("fix 2 H: incomplete identities remain invalid and skip the exact search", () => {
  const profile = independenceFixture(independenceLimits.maximumSourcesPerClaim);
  profile.evidenceRegistry.sources[0]!.independenceKey.lineageId = "";
  const result = run(profile);
  assert.deepEqual(result.acceptedClaims, []);
  assert.equal(result.rejectedClaims[0]!.evaluations[0]!.independenceEvaluation, "skipped");
  assert.equal(result.rejectedClaims[0]!.usefulEvidence, false);
  hasReason(result, "source_contract_invalid");
  hasReason(result, "source_independence_insufficient");
  assert.equal(result.status, "missing");
});

test("fix 2 I: a misleading first source cannot hide a sufficient non-greedy subset", () => {
  const profile = independenceFixture(5);
  const [first, second, third] = profile.evidenceRegistry.sources;
  first!.independenceKey.workId = second!.independenceKey.workId;
  first!.independenceKey.responsibleEntityId = third!.independenceKey.responsibleEntityId;
  const result = resolveRequirementEvidence(requirement(), profile, independenceOptions(profile, 4));
  assert.equal(result.status, "covered");
  assert.equal(result.acceptedClaims[0]!.evaluations[0]!.independenceEvaluation, "evaluated");
  assert.deepEqual(result.acceptedClaims[0]!.evaluations[0]!.independentSourceRefs, ["bounded.source.01", "bounded.source.02", "bounded.source.03", "bounded.source.04"]);
});

test("fix 2: exact results agree with exhaustive bitmask enumeration across small conflict structures", () => {
  for (let seed = 0; seed < 16; seed++) {
    const profile = independenceFixture(6);
    profile.evidenceRegistry.sources.forEach((source, index) => {
      source.independenceKey = { responsibleEntityId: `entity.${(index + seed) % (2 + seed % 5)}`,
        workId: `work.${(index * 3 + seed) % (3 + seed % 4)}`, lineageId: `lineage.${(index * 5 + seed) % (4 + seed % 3)}` };
    });
    // Independent oracle: enumerate all bitmasks, including every pair in each set.
    let maximum = 0;
    for (let mask = 0; mask < 64; mask++) {
      const subset = profile.evidenceRegistry.sources.filter((_, index) => (mask & (1 << index)) !== 0);
      const valid = subset.every((source, index) => subset.slice(index + 1).every((other) =>
        ["responsibleEntityId", "workId", "lineageId"].every((field) =>
          source.independenceKey[field as keyof typeof source.independenceKey] !== other.independenceKey[field as keyof typeof other.independenceKey])));
      if (valid) maximum = Math.max(maximum, subset.length);
    }
    for (let minimum = 2; minimum <= 6; minimum++) {
      const result = resolveRequirementEvidence(requirement(), profile, independenceOptions(profile, minimum));
      const assessment = result.claimEvaluations[0]!;
      assert.equal(assessment.independenceEvaluation, "evaluated");
      assert.equal(assessment.accepted, maximum >= minimum, `seed=${seed}, minimum=${minimum}`);
      assert.equal(assessment.independentSourceRefs.length, Math.min(maximum, minimum));
      const witness = profile.evidenceRegistry.sources.filter((source) => assessment.independentSourceRefs.includes(source.sourceId));
      for (const field of ["responsibleEntityId", "workId", "lineageId"] as const) {
        assert.equal(new Set(witness.map((source) => source.independenceKey[field])).size, witness.length);
      }
    }
  }
});

test("fix 2: over-limit evidence stays monotonic when a stricter policy skips independence", () => {
  const profile = independenceFixture(independenceLimits.maximumSourcesPerClaim + 1);
  const baselineResult = run(profile);
  const restricted = resolveRequirementEvidence(requirement(), profile, { targetPolicies: [{
    targetRef: profile.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs[0]!, policy: { allowedReviewStatuses: ["human_reviewed"] },
  }] });
  assert.equal(baselineResult.status, "partial");
  assert.equal(restricted.status, "partial");
  assert.equal(restricted.rejectedClaims[0]!.evaluations[0]!.independenceEvaluation, "skipped");
  assert.equal(restricted.durableConsumable, false);
});

const collectionSlot = "phonology.intelligibilityRelevantFeatures";
function collectionFixture(both = false) {
  const profile = fixture("phonology.initial_intelligibility", false);
  const a = syntheticFeature(collectionSlot);
  const b = syntheticFeature(collectionSlot, ".b");
  setSlot(profile, collectionSlot, { state: "known", value: [a, b] });
  const claim = addClaim(profile, target("phonology.initial_intelligibility", collectionSlot));
  if (both) claim.subjectRefs.push({ kind: "feature", slot: collectionSlot, featureId: b.featureId });
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  return { profile, claim, a, b };
}

function assertUniqueSummaries(result: RequirementEvidenceResolution) {
  const ids = [...result.acceptedClaims, ...result.rejectedClaims].map((claim) => claim.claimId);
  assert.equal(new Set(ids).size, ids.length);
  for (const summary of [...result.acceptedClaims, ...result.rejectedClaims]) {
    assert.deepEqual(summary.evaluations, result.claimEvaluations.filter((entry) => entry.claimId === summary.claimId));
  }
}

function assertContractRejected(result: RequirementEvidenceResolution, claimId: string) {
  assertUniqueSummaries(result);
  assert.ok(!result.acceptedClaims.some((entry) => entry.claimId === claimId));
  const summary = result.rejectedClaims.find((entry) => entry.claimId === claimId)!;
  assert.ok(summary);
  assert.equal(summary.status, "rejected");
  assert.equal(summary.usefulEvidence, false);
  assert.ok(summary.reasons.includes("claim_contract_invalid"));
  assert.ok(summary.evaluations.length > 0);
  assert.ok(summary.evaluations.every((entry) => !entry.accepted && !entry.usefulEvidence && entry.independenceEvaluation === "skipped"));
}

test("fix 3a: A-only claim is accepted once and B is unclaimed, not rejected", () => {
  const { profile, claim, b } = collectionFixture();
  const result = run(profile);
  assertUniqueSummaries(result);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [claim.claimId]);
  assert.deepEqual(result.rejectedClaims, []);
  assert.equal(result.claimEvaluations.length, 1);
  const resolved = targetResult(result, collectionSlot);
  const unclaimed = resolved.subjects.find((subject) => subject.subjectRef.kind === "feature" && subject.subjectRef.featureId === b.featureId)!;
  assert.deepEqual(unclaimed.claimEvaluations, []);
  assert.equal(unclaimed.status, "missing");
  assert.equal(resolved.status, "covered"); // Existential relevance target; A suffices.
  assert.ok(!allReasons(result).includes("claim_wrong_subject"));
});

test("fix 3a: A+B yields two local evaluations and exactly one accepted summary", () => {
  const { profile } = collectionFixture(true);
  const result = run(profile);
  assertUniqueSummaries(result);
  assert.equal(result.claimEvaluations.length, 2);
  assert.ok(result.claimEvaluations.every((entry) => entry.accepted));
  assert.equal(result.acceptedClaims.length, 1);
  assert.equal(result.acceptedClaims[0]!.status, "accepted");
  assert.deepEqual(result.rejectedClaims, []);
  assert.equal(result.sourcesUsed.length, 2); // Two evaluations do not invent four sources.
  assert.ok(targetResult(result, collectionSlot).subjects.every((subject) => subject.status === "covered"));
});

test("fix 3a: policy failure for A+B yields one rejected summary with both evaluations", () => {
  const { profile, claim } = collectionFixture(true);
  const result = resolveRequirementEvidence(requirement(), profile, { targetPolicies: [{
    targetRef: claim.requirementEvidenceTargetRefs[0]!, policy: { crossCheckedMinimumIndependentSources: 3 },
  }] });
  assertUniqueSummaries(result);
  assert.deepEqual(result.acceptedClaims, []);
  assert.equal(result.rejectedClaims.length, 1);
  assert.equal(result.claimEvaluations.length, 2);
  assert.ok(result.claimEvaluations.every((entry) => !entry.accepted && entry.independentSourceRefs.length === 2));
  assert.equal(targetResult(result, collectionSlot).status, "partial");
  assert.deepEqual(result.sourcesUsed, []);
});

test("fix 3a: mixed target policies preserve partial acceptance and local coverage", () => {
  const { profile, claim } = collectionFixture(true);
  know(profile, "phonology.stressSystem");
  const extra = addClaim(profile, target("phonology.initial_intelligibility", "phonology.stressSystem"));
  claim.subjectRefs.push(...extra.subjectRefs);
  claim.requirementEvidenceTargetRefs.push(...extra.requirementEvidenceTargetRefs);
  profile.evidenceRegistry.claims.pop();
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  const options = { targetPolicies: [{ targetRef: extra.requirementEvidenceTargetRefs[0]!, policy: { crossCheckedMinimumIndependentSources: 3 } }] };
  const result = resolveRequirementEvidence(requirement(), profile, options);
  assertUniqueSummaries(result);
  assert.equal(result.acceptedClaims.length, 1);
  assert.equal(result.acceptedClaims[0]!.status, "partially_accepted");
  assert.deepEqual(result.rejectedClaims, []);
  assert.equal(result.claimEvaluations.length, 3);
  assert.equal(targetResult(result, collectionSlot).status, "covered");
  assert.equal(targetResult(result, "phonology.stressSystem").status, "partial");
  const reordered = structuredClone(profile);
  reordered.evidenceRegistry.claims[0]!.subjectRefs.reverse();
  reordered.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs.reverse();
  const knowledge = reordered.knowledge.phonology.intelligibilityRelevantFeatures;
  assert.equal(knowledge.state, "known");
  if (knowledge.state === "known") knowledge.value.reverse();
  assert.deepEqual(resolveRequirementEvidence(requirement(), reordered, options), result);
});

test("fix 3a: mixed valid and missing declared refs reject the entire multi-subject claim", () => {
  const { profile, claim } = collectionFixture(true);
  claim.subjectRefs.push(orphanSubject);
  const result = run(profile);
  assertContractRejected(result, claim.claimId);
  assert.equal(targetResult(result, collectionSlot).status, "missing");
  assert.equal(result.status, "missing");
});

test("fix 3a: multiple local evaluations cannot pool sources for cross-check", () => {
  const { profile, claim } = collectionFixture(true);
  claim.evidenceRefs = claim.evidenceRefs.slice(0, 1);
  const result = run(profile);
  assertUniqueSummaries(result);
  assert.equal(result.rejectedClaims.length, 1);
  assert.equal(result.claimEvaluations.length, 2);
  assert.ok(result.claimEvaluations.every((entry) => !entry.accepted && entry.sourceRefs.length === 1 && entry.independentSourceRefs.length === 1));
  assert.equal(result.status, "partial");
  assert.deepEqual(result.sourcesUsed, []);
});

for (const identity of ["feature", "mechanism"] as const) {
  test(`fix 3a: duplicate ${identity} IDs reject ambiguous references without useful evidence or coverage`, () => {
    const { profile, claim, a, b } = collectionFixture();
    if (identity === "feature") b.featureId = a.featureId;
    else b.mechanisms[0]!.mechanismId = a.mechanisms[0]!.mechanismId;
    const validation = languageProfileV2Schema.safeParse(profile);
    assert.equal(validation.success, false);
    if (!validation.success) {
      const duplicates = validation.error.issues.filter((issue) => issue.message.startsWith(`Duplicate ${identity} ID`));
      assert.equal(duplicates.length, 2);
      assert.ok(duplicates.every((issue) => issue.path[0] === "knowledge" && issue.path.length >= 6));
    }
    const original = structuredClone(profile);
    const result = run(deepFreeze(profile));
    assert.deepEqual(profile, original);
    assertContractRejected(result, claim.claimId);
    assert.equal(targetResult(result, collectionSlot).status, "missing");
    assert.equal(result.status, "missing");
    assert.ok(result.rejectedClaims[0]!.contractGaps.some((gap) => gap.subjectRef?.kind === (identity === "feature" ? "feature" : "feature_mechanism")));
    const reordered = structuredClone(profile);
    const knowledge = reordered.knowledge.phonology.intelligibilityRelevantFeatures;
    if (knowledge.state === "known") knowledge.value.reverse();
    assert.deepEqual(run(reordered), result);
  });

  test(`fix 3a: duplicate ${identity} IDs isolate a healthy sibling in the same collection`, () => {
    const { profile, claim, a, b } = collectionFixture();
    const duplicate = structuredClone(a);
    if (identity === "feature") duplicate.mechanisms[0]!.mechanismId += ".duplicate";
    else duplicate.featureId += ".duplicate";
    setSlot(profile, collectionSlot, { state: "known", value: [a, duplicate, b] });
    const healthy = structuredClone(claim);
    healthy.claimId += ".healthy";
    healthy.subjectRefs = [{ kind: "feature", slot: collectionSlot, featureId: b.featureId }];
    profile.evidenceRegistry.claims.push(healthy);
    const result = run(profile);
    assertContractRejected(result, claim.claimId);
    assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthy.claimId]);
    assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
    assert.equal(targetResult(result, collectionSlot).status, "covered");
    assert.equal(result.status, "partial"); // Invalid profile still blocks durable coverage.
    assert.equal(result.durableConsumable, false);
    const reordered = structuredClone(profile);
    reordered.evidenceRegistry.claims.reverse();
    const knowledge = reordered.knowledge.phonology.intelligibilityRelevantFeatures;
    if (knowledge.state === "known") knowledge.value.reverse();
    assert.deepEqual(run(reordered), result);
  });
}

test("fix 3a: duplicates outside the domain preserve healthy claim eligibility", () => {
  const profile = fixture();
  const a = syntheticFeature("nominalSystem.numberMarking");
  const b = syntheticFeature("nominalSystem.grammaticalGender");
  b.featureId = a.featureId;
  b.mechanisms[0]!.mechanismId = a.mechanisms[0]!.mechanismId;
  setSlot(profile, "nominalSystem.numberMarking", { state: "known", value: a });
  setSlot(profile, "nominalSystem.grammaticalGender", { state: "known", value: b });
  const result = run(profile);
  assertUniqueSummaries(result);
  assert.equal(result.acceptedClaims.length, 1);
  assert.deepEqual(result.rejectedClaims, []);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.equal(result.status, "partial");
});

test("fix 3a: duplicate identity detection survives unrelated structural errors", () => {
  const { profile, claim, a, b } = collectionFixture();
  b.featureId = a.featureId;
  const malformed = { ...profile, identity: {} };
  assertContractRejected(run(malformed), claim.claimId);
});

test("fix 3a: mechanism ambiguity spans features and structural argument items", () => {
  const profile = fixture("age.basic_expression", false);
  const slot = "predicationSystem.identityPredication";
  know(profile, slot);
  const claim = addClaim(profile, target("age.basic_expression", slot));
  const feature = syntheticFeature(slot);
  setSlot(profile, "clauseStructure.argumentMarkingMechanisms", { state: "known", value: [{
    mechanismId: feature.mechanisms[0]!.mechanismId, mechanism: "context", applicability: "common", conditions: [], relevance: [],
  }] });
  const result = run(profile, "age.basic_expression");
  assertContractRejected(result, claim.claimId);
  assert.equal(targetResult(result, slot).status, "missing");
});

test("fix 3a: an unrelated domain claim on the same slot is omitted", () => {
  const profile = fixture("possession.basic", false);
  const shared = entry("possession.basic").groups.flatMap((group) => group.targets).find((candidate) =>
    entry("age.basic_expression").groups.some((group) => group.targets.some((other) => other.subjectRef.slot === candidate.subjectRef.slot)))!;
  assert.ok(shared);
  know(profile, shared.subjectRef.slot);
  addClaim(profile, shared);
  const result = run(profile, "age.basic_expression");
  assert.deepEqual(result.claimEvaluations, []);
  assert.deepEqual(result.acceptedClaims, []);
  assert.deepEqual(result.rejectedClaims, []);
});

test("fix 3a: exact mechanism claims isolate a healthy mechanism in the same feature", () => {
  const domain = "age.basic_expression";
  const slot = "predicationSystem.identityPredication";
  const profile = fixture(domain, false);
  const feature = syntheticFeature(slot);
  const ambiguous = feature.mechanisms[0]!;
  const healthyMechanism = { ...structuredClone(ambiguous), mechanismId: "test.mechanism.healthy" };
  feature.mechanisms.push({ ...structuredClone(ambiguous), role: "Second occurrence" }, healthyMechanism);
  setSlot(profile, slot, { state: "known", value: feature });
  const invalid = addClaim(profile, target(domain, slot));
  const healthy = addClaim(profile, target(domain, slot), ".healthy");
  healthy.subjectRefs = [{ kind: "feature_mechanism", slot, featureId: feature.featureId, mechanismId: healthyMechanism.mechanismId }];
  const validation = languageProfileV2Schema.safeParse(profile);
  assert.equal(validation.success, false);
  const result = run(profile, domain);
  assertContractRejected(result, invalid.claimId);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthy.claimId]);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  const resolved = targetResult(result, slot);
  assert.equal(resolved.subjects.length, 2); // One context per exact identity; all duplicate paths retained in gaps.
  assert.equal(resolved.status, "covered");
  assert.equal(result.rejectedClaims[0]!.contractGaps.filter((gap) => gap.subjectRef?.kind === "feature_mechanism").length, 2);
  feature.mechanisms.reverse();
  profile.evidenceRegistry.claims.reverse();
  assert.deepEqual(run(profile, domain), result);
});

test("fix 3a: unidentified malformed claims retain diagnostics without colliding with a real ID", () => {
  const { profile, claim } = collectionFixture();
  claim.claimId = "invalid-claim";
  const malformed = structuredClone(claim) as unknown as Record<string, unknown>;
  delete malformed.claimId;
  const raw = { ...profile, evidenceRegistry: { ...profile.evidenceRegistry, claims: [claim, malformed] } };
  const result = run(raw);
  assertUniqueSummaries(result);
  assert.equal(result.acceptedClaims.length, 1);
  assert.equal(result.acceptedClaims[0]!.claimId, claim.claimId);
  assert.equal(result.acceptedClaims[0]!.status, "accepted");
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.deepEqual(result.rejectedClaims, []);
  const unidentified = result.claimEvaluations.filter((entry) => entry.claimId === null);
  assert.equal(unidentified.length, 1);
  assert.ok(unidentified.every((entry) => !entry.accepted && !entry.usefulEvidence && entry.contractGaps.length > 0));
  assert.equal(result.durableConsumable, false);
});

test("fix 3a: structurally invalid duplicate claims share the normalized S1 claim identity", () => {
  const { profile, claim } = collectionFixture();
  const malformed = { ...structuredClone(claim), claimId: ` ${claim.claimId} `, confidence: "invalid" };
  const raw = { ...profile, evidenceRegistry: { ...profile.evidenceRegistry, claims: [claim, malformed] } };
  const result = run(raw);
  assertContractRejected(result, claim.claimId);
  assert.equal(result.rejectedClaims.length, 1);
  assert.equal(result.rejectedClaims[0]!.evaluations.length, 2);
  assert.equal(result.status, "missing");
});

const mechanismSlots = ["predicationSystem.identityPredication", "predicationSystem.propertyPredication", "predicationSystem.statePredication"] as const;
function incompleteMechanismFixture(incomplete?: number, count = 2) {
  const profile = fixture("age.basic_expression", false);
  const features = mechanismSlots.slice(0, count).map((slot) => syntheticFeature(slot));
  features.forEach((feature, index) => {
    feature.mechanisms[0]!.mechanismId = "mechanism.shared";
    if (index === incomplete) delete (feature as Partial<LanguageFeatureV2>).featureId;
    setSlot(profile, mechanismSlots[index]!, { state: "known", value: feature });
  });
  // Reference the complete counterpart, including when the first parent is malformed.
  const index = incomplete === 0 ? 1 : 0;
  const slot = mechanismSlots[index]!;
  const claim = addClaim(profile, target("age.basic_expression", slot));
  claim.subjectRefs = [{ kind: "feature_mechanism", slot, featureId: features[index]!.featureId, mechanismId: "mechanism.shared" }];
  return { profile, features, claim, slot };
}

for (const [name, incomplete, count] of [
  ["complete parents", undefined, 2], ["second parent missing featureId", 1, 2],
  ["first parent missing featureId", 0, 2], ["three occurrences with one incomplete parent", 1, 3],
] as const) {
  test(`fix 3b: ${name} preserves every duplicate occurrence and rejects the affected claim`, () => {
    const { profile, claim, slot } = incompleteMechanismFixture(incomplete, count);
    const original = structuredClone(profile);
    const identityIssues = profileKnowledgeIdentityIssues(profile.knowledge);
    assert.equal(identityIssues.length, count);
    assert.ok(identityIssues.every((issue) => issue.message === "Duplicate mechanism ID: mechanism.shared"));
    const validation = languageProfileV2Schema.safeParse(profile);
    assert.equal(validation.success, false);
    if (!validation.success) {
      assert.equal(validation.error.issues.filter((issue) => issue.message === "Duplicate mechanism ID: mechanism.shared").length, count);
      if (incomplete !== undefined) {
        const path = ["knowledge", ...mechanismSlots[incomplete]!.split("."), "value", "featureId"].join(".");
        assert.ok(validation.error.issues.some((issue) => issue.code === "invalid_type" && issue.path.join(".") === path));
        const unaddressable = identityIssues.find((issue) => issue.path[2] === mechanismSlots[incomplete]!.split(".")[1])!;
        assert.ok(unaddressable.code === "custom" && unaddressable.params?.subjectRef === null);
      }
    }
    const result = run(deepFreeze(profile), "age.basic_expression");
    assert.deepEqual(profile, original);
    assertContractRejected(result, claim.claimId);
    assert.equal(result.claimEvaluations.length, 1);
    assert.equal(result.rejectedClaims.length, 1);
    assert.ok(result.rejectedClaims[0]!.contractGaps.some((gap) => gap.claimRef === claim.claimId &&
      gap.subjectRef?.kind === "feature_mechanism" && gap.subjectRef.mechanismId === "mechanism.shared" &&
      gap.validationIssue?.path.endsWith("mechanisms.0.mechanismId")));
    assert.equal(targetResult(result, slot).status, "missing");
    assert.equal(targetResult(result, slot).usefulEvidence, false);
    assert.equal(result.status, "missing");
    assert.equal(result.durableConsumable, false);
    assert.deepEqual(result.sourcesUsed, []);
  });
}

test("fix 3b: a unique mechanism under an incomplete parent creates no duplicate or fabricated subject", () => {
  const { profile, features, claim, slot } = incompleteMechanismFixture(1);
  features[1]!.mechanisms[0]!.mechanismId = "mechanism.unique";
  assert.deepEqual(profileKnowledgeIdentityIssues(profile.knowledge), []);
  const validation = languageProfileV2Schema.safeParse(profile);
  assert.equal(validation.success, false);
  if (!validation.success) assert.ok(validation.error.issues.some((issue) => issue.path.at(-1) === "featureId"));
  const result = run(profile, "age.basic_expression");
  assertUniqueSummaries(result);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [claim.claimId]);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.equal(targetResult(result, slot).status, "covered");
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
});

test("fix 3b: missing mechanism IDs are structural errors, never duplicate identifiers", () => {
  const { profile, features, claim } = incompleteMechanismFixture(1);
  const mechanism = features[1]!.mechanisms[0]!;
  delete (mechanism as Partial<typeof mechanism>).mechanismId;
  features[1]!.mechanisms.push(structuredClone(mechanism));
  assert.deepEqual(profileKnowledgeIdentityIssues(profile.knowledge), []);
  const validation = languageProfileV2Schema.safeParse(profile);
  assert.equal(validation.success, false);
  if (!validation.success) assert.equal(validation.error.issues.filter((issue) => issue.path.at(-1) === "mechanismId").length, 2);
  const result = run(profile, "age.basic_expression");
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [claim.claimId]);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.equal(result.durableConsumable, false);
});

test("fix 3b: a healthy mechanism in the same complete parent remains isolated", () => {
  const { profile, features, claim, slot } = incompleteMechanismFixture(1);
  const unique = { ...structuredClone(features[0]!.mechanisms[0]!), mechanismId: "mechanism.healthy" };
  features[0]!.mechanisms.push(unique);
  const healthy = addClaim(profile, target("age.basic_expression", slot), ".healthy");
  healthy.subjectRefs = [{ kind: "feature_mechanism", slot, featureId: features[0]!.featureId, mechanismId: unique.mechanismId }];
  const result = run(profile, "age.basic_expression");
  assertContractRejected(result, claim.claimId);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthy.claimId]);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  const subjects = targetResult(result, slot).subjects;
  assert.equal(subjects.find((subject) => subject.subjectRef.kind === "feature_mechanism" && subject.subjectRef.mechanismId === "mechanism.shared")!.status, "missing");
  assert.equal(subjects.find((subject) => subject.subjectRef.kind === "feature_mechanism" && subject.subjectRef.mechanismId === unique.mechanismId)!.status, "covered");
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
});

test("fix 3b: an incomplete duplicate outside the domain does not contaminate the healthy claim", () => {
  const profile = fixture();
  const { features } = incompleteMechanismFixture(1);
  features.forEach((feature, index) => setSlot(profile, mechanismSlots[index]!, { state: "known", value: feature }));
  const result = run(profile);
  assert.equal(profileKnowledgeIdentityIssues(profile.knowledge).length, 2);
  assert.equal(result.acceptedClaims.length, 1);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.deepEqual(result.rejectedClaims, []);
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
});

test("fix 3b: reordering malformed feature collections and mechanism arrays preserves diagnostics and decisions", () => {
  const { profile, features, claim } = incompleteMechanismFixture(1);
  setSlot(profile, mechanismSlots[1], { state: "unknown" });
  const healthy = syntheticFeature(collectionSlot, ".unique");
  setSlot(profile, collectionSlot, { state: "known", value: [features[1]!, healthy] });
  features[0]!.mechanisms.push({ ...structuredClone(features[0]!.mechanisms[0]!), mechanismId: "mechanism.other" });
  features[1]!.mechanisms.push({ ...structuredClone(features[0]!.mechanisms[0]!), mechanismId: "mechanism.other.incomplete" });
  const result = run(profile, "age.basic_expression");
  assertContractRejected(result, claim.claimId);
  const reordered = structuredClone(profile);
  const collection = reordered.knowledge.phonology.intelligibilityRelevantFeatures;
  if (collection.state === "known") { collection.value.reverse(); collection.value.forEach((feature) => feature.mechanisms.reverse()); }
  const complete = reordered.knowledge.predicationSystem.identityPredication;
  if (complete.state === "known") complete.value.mechanisms.reverse();
  assert.equal(profileKnowledgeIdentityIssues(reordered.knowledge).length, 2);
  assert.deepEqual(run(reordered, "age.basic_expression"), result);
});

test("fix 3b: incomplete-parent ambiguity dominates a potential partially accepted summary", () => {
  const { profile, claim } = incompleteMechanismFixture(1);
  const slot = mechanismSlots[2];
  know(profile, slot);
  const extra = addClaim(profile, target("age.basic_expression", slot));
  claim.subjectRefs.push(...extra.subjectRefs);
  claim.requirementEvidenceTargetRefs.push(...extra.requirementEvidenceTargetRefs);
  profile.evidenceRegistry.claims.pop();
  const result = resolveRequirementEvidence(requirement("age.basic_expression"), profile, { targetPolicies: [{
    targetRef: extra.requirementEvidenceTargetRefs[0]!, policy: { crossCheckedMinimumIndependentSources: 3 },
  }] });
  assertContractRejected(result, claim.claimId);
  assert.equal(result.rejectedClaims.length, 1);
  assert.equal(result.claimEvaluations.length, 2);
  assert.equal(result.status, "missing");
  assert.equal(result.durableConsumable, false);
});

test("fix 3b: feature IDs remain counted when another feature field is structurally missing", () => {
  const { profile, features } = incompleteMechanismFixture();
  features[1]!.featureId = features[0]!.featureId;
  delete (features[1] as Partial<LanguageFeatureV2>).description;
  const validation = languageProfileV2Schema.safeParse(profile);
  assert.equal(validation.success, false);
  if (!validation.success) {
    assert.equal(validation.error.issues.filter((issue) => issue.message.startsWith("Duplicate feature ID:")).length, 2);
    assert.ok(validation.error.issues.some((issue) => issue.path.at(-1) === "description"));
  }
});

const writingDomain = "writing.beginner_system";
function writingIdentityFixture(kind: "script" | "system", count = 2) {
  const profile = fixture(writingDomain, false);
  const slot: ProfileKnowledgeSlotId = kind === "script" ? "writingSystem.scripts" : "writingSystem.transliterationSystems";
  know(profile, "writingSystem.scripts");
  const item: Record<string, unknown> = kind === "script"
    ? { scriptId: "inventory.shared", name: "Synthetic script", family: "other", role: "primary", usage: "Synthetic", coexistsWith: [] }
    : { systemId: "inventory.shared", name: "Synthetic system", role: "reference", usage: "Synthetic", targetScriptRefs: ["test.script"] };
  const items: Record<string, unknown>[] = Array.from({ length: count }, (_, i) => ({ ...structuredClone(item), name: `Synthetic ${i}` }));
  setSlot(profile, slot, { state: "known", value: items });
  const claim = addClaim(profile, target(writingDomain, slot));
  return { profile, slot, claim, items, idField: kind === "script" ? "scriptId" : "systemId" };
}

function withoutDirection(profile: LanguageProfileV2) {
  delete (profile.knowledge.writingSystem as Partial<LanguageProfileV2["knowledge"]["writingSystem"]>).direction;
}

for (const kind of ["script", "system"] as const) {
  for (const variant of ["complete", "missing direction", "first malformed", "second malformed", "three occurrences", "missing state"] as const) {
    test(`fix 3c: ${kind} duplicates survive ${variant} with structural and integrity diagnostics`, () => {
      const { profile, slot, claim, items, idField } = writingIdentityFixture(kind, variant === "three occurrences" ? 3 : 2);
      if (variant === "missing direction") withoutDirection(profile);
      if (variant === "first malformed") delete items[0]!.name;
      if (variant === "second malformed" || variant === "three occurrences") delete items[1]!.usage;
      if (variant === "missing state") setSlot(profile, slot, { value: items });
      const snapshot = structuredClone(profile);
      const parsed = languageProfileV2Schema.safeParse(profile);
      assert.equal(parsed.success, false);
      if (!parsed.success) {
        const duplicates = parsed.error.issues.filter((issue) => issue.message === `Duplicate ${kind} ID: inventory.shared`);
        assert.equal(duplicates.length, items.length);
        assert.ok(duplicates.every((issue) => issue.path.at(-1) === idField && typeof issue.path.at(-2) === "number"));
        if (variant !== "complete") assert.ok(parsed.error.issues.some((issue) => issue.code !== "custom"));
      }
      const result = run(deepFreeze(profile), writingDomain);
      assertContractRejected(result, claim.claimId);
      assert.equal(result.rejectedClaims.length, 1);
      assert.equal(targetResult(result, slot).status, "missing");
      assert.equal(targetResult(result, slot).usefulEvidence, false);
      assert.equal(result.durableConsumable, false);
      assert.deepEqual(result.sourcesUsed, []);
      assert.deepEqual(profile, snapshot);
    });
  }

  test(`fix 3c: absent or invalid own ${kind} IDs never become synthetic duplicates`, () => {
    const { profile, items, idField } = writingIdentityFixture(kind, 3);
    delete items[1]![idField];
    items[2]![idField] = "not an ID";
    assert.deepEqual(profileKnowledgeIdentityIssues(profile.knowledge), []);
    const parsed = languageProfileV2Schema.safeParse(profile);
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(parsed.error.issues.filter((issue) => issue.path.at(-1) === idField).length, 2);
  });

  test(`fix 3c: ${kind} ambiguity isolates a healthy sibling claim`, () => {
    const { profile, claim } = writingIdentityFixture(kind);
    withoutDirection(profile);
    const healthySlot = "writingSystem.orthographicDepth";
    know(profile, healthySlot);
    const healthy = addClaim(profile, target(writingDomain, healthySlot));
    const result = run(profile, writingDomain);
    assertContractRejected(result, claim.claimId);
    assert.deepEqual(result.acceptedClaims.map((summary) => summary.claimId), [healthy.claimId]);
    assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
    assert.equal(targetResult(result, healthySlot).status, "covered");
    assert.equal(result.status, "partial");
    assert.equal(result.durableConsumable, false);
  });

  test(`fix 3c: ${kind} duplicates outside the domain preserve healthy eligibility`, () => {
    const profile = fixture();
    profile.knowledge.writingSystem = writingIdentityFixture(kind).profile.knowledge.writingSystem;
    withoutDirection(profile);
    const result = run(profile);
    assertUniqueSummaries(result);
    assert.equal(result.acceptedClaims.length, 1);
    assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
    assert.deepEqual(result.rejectedClaims, []);
    assert.equal(result.status, "partial");
    assert.equal(result.durableConsumable, false);
  });

  test(`fix 3c: ${kind} ambiguity dominates every local evaluation and cannot be partially accepted`, () => {
    const { profile, claim } = writingIdentityFixture(kind);
    withoutDirection(profile);
    const extraSlot = "writingSystem.orthographicDepth";
    know(profile, extraSlot);
    const extra = addClaim(profile, target(writingDomain, extraSlot));
    claim.subjectRefs.push(...extra.subjectRefs);
    claim.requirementEvidenceTargetRefs.push(...extra.requirementEvidenceTargetRefs);
    profile.evidenceRegistry.claims.pop();
    const result = resolveRequirementEvidence(requirement(writingDomain), profile, {
      targetPolicies: [{ targetRef: extra.requirementEvidenceTargetRefs[0]!, policy: { crossCheckedMinimumIndependentSources: 3 } }],
    });
    assertContractRejected(result, claim.claimId);
    assert.equal(result.claimEvaluations.length, 2);
    assert.equal(result.rejectedClaims.length, 1);
    assert.equal(result.status, "missing");
  });

  test(`fix 3c: ${kind} raw collection reorder preserves full output without mutation`, () => {
    const { profile, items, slot } = writingIdentityFixture(kind, 3);
    delete items[1]!.name;
    setSlot(profile, slot, { value: items });
    const first = run(profile, writingDomain);
    const reordered = structuredClone(profile);
    const wrapper = reordered.knowledge.writingSystem[slot === "writingSystem.scripts" ? "scripts" : "transliterationSystems"];
    if ("value" in wrapper) wrapper.value.reverse();
    reordered.evidenceRegistry.sources.reverse();
    reordered.evidenceRegistry.evidence.reverse();
    assert.deepEqual(run(deepFreeze(reordered), writingDomain), first);
  });
}

for (const kind of ["feature", "mechanism", "structural mechanism"] as const) {
  test(`fix 3c: ${kind} IDs under an invalid wrapper still reject the complete counterpart`, () => {
    const { profile, features, claim, slot } = incompleteMechanismFixture();
    const otherSlot = mechanismSlots[1];
    if (kind === "feature") {
      features[1]!.featureId = features[0]!.featureId;
      features[1]!.mechanisms[0]!.mechanismId = "mechanism.unique";
    }
    if (kind === "structural mechanism") {
      setSlot(profile, otherSlot, { state: "unknown" });
      setSlot(profile, "clauseStructure.argumentMarkingMechanisms", {
        value: [{ mechanismId: "mechanism.shared", mechanism: "context", applicability: "common", conditions: [], relevance: [] }],
      });
    } else setSlot(profile, otherSlot, { value: features[1] });
    const parsed = languageProfileV2Schema.safeParse(profile);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.equal(parsed.error.issues.filter((issue) => issue.message.startsWith(`Duplicate ${kind === "feature" ? "feature" : "mechanism"} ID:`)).length, 2);
      assert.ok(parsed.error.issues.some((issue) => issue.code === "invalid_union_discriminator"));
    }
    const result = run(profile, "age.basic_expression");
    assertContractRejected(result, claim.claimId);
    assert.equal(targetResult(result, slot).status, "missing");
  });
}

test("fix 3c: owned namespaces stay distinct and ignore IDs outside declared positions", () => {
  const profile = fixture(writingDomain, false);
  const shared = "namespace.same";
  const feature = syntheticFeature(mechanismSlots[0]);
  feature.featureId = shared;
  feature.mechanisms[0]!.mechanismId = shared;
  setSlot(profile, mechanismSlots[0], { state: "known", value: feature });
  setSlot(profile, "writingSystem.scripts", { state: "known", value: [{
    scriptId: shared, name: "Synthetic", family: "other", role: "primary", usage: "Synthetic", coexistsWith: [],
  }] });
  setSlot(profile, "writingSystem.transliterationSystems", { state: "known", value: [{
    systemId: shared, name: "Synthetic", role: "reference", usage: "Synthetic", targetScriptRefs: [shared],
  }] });
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  assert.deepEqual(profileKnowledgeIdentityIssues(profile.knowledge), []);
  setSlot(profile, "identity.regionScope", { value: [{ featureId: shared, mechanismId: shared, scriptId: shared, systemId: shared }] });
  assert.deepEqual(profileKnowledgeIdentityIssues(profile.knowledge), []);
});

for (const location of ["scriptScope", "primaryScriptStrategy", "coexistsWith", "targetScriptRefs"] as const) {
  for (const fault of ["duplicate", "unknown"] as const) {
    test(`fix 3c: ${location} ${fault} references survive an unrelated structural failure`, () => {
      const { profile, items } = writingIdentityFixture("system", 1);
      const refs = fault === "duplicate" ? ["test.script", "test.script"] : ["script.missing"];
      let claimSlot: ProfileKnowledgeSlotId = "writingSystem.transliterationSystems";
      if (location === "scriptScope") setSlot(profile, "identity.scriptScope", { state: "known", value: refs });
      if (location === "primaryScriptStrategy") {
        claimSlot = "writingSystem.primaryScriptStrategy";
        setSlot(profile, claimSlot, { state: "known", value: { strategy: "single", scriptRefs: refs } });
      }
      if (location === "coexistsWith") {
        claimSlot = "writingSystem.scripts";
        const scripts = profile.knowledge.writingSystem.scripts;
        if (scripts.state === "known") scripts.value[0]!.coexistsWith = refs;
      }
      if (location === "targetScriptRefs") items[0]!.targetScriptRefs = refs;
      profile.evidenceRegistry.claims = [];
      const claim = addClaim(profile, target(writingDomain, claimSlot));
      const message = fault === "duplicate" ? "Duplicate reference or ID" : "Unknown script reference";
      for (const incomplete of [false, true]) {
        if (incomplete) withoutDirection(profile);
        const parsed = languageProfileV2Schema.safeParse(profile);
        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.equal(parsed.error.issues.filter((issue) => issue.message === message).length, refs.length);
          if (incomplete) assert.ok(parsed.error.issues.some((issue) => issue.path.at(-1) === "direction"));
        }
        const result = run(profile, writingDomain);
        if (location === "scriptScope") {
          // Identity scope is outside this claim's slot; preserve local isolation.
          assert.equal(result.acceptedClaims.length, 1);
          assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
        } else {
          assertContractRejected(result, claim.claimId);
          assert.equal(targetResult(result, claimSlot).status, "missing");
        }
        assert.equal(result.durableConsumable, false);
      }
    });
  }
}

test("fix 3c: script references resolve to one identity, never an ambiguous inventory entry", () => {
  const { profile } = writingIdentityFixture("script");
  setSlot(profile, "writingSystem.primaryScriptStrategy", { state: "known", value: { strategy: "single", scriptRefs: ["inventory.shared"] } });
  const claim = addClaim(profile, target(writingDomain, "writingSystem.primaryScriptStrategy"));
  withoutDirection(profile);
  const result = run(profile, writingDomain);
  assertContractRejected(result, claim.claimId);
  assert.ok(result.rejectedClaims.find((summary) => summary.claimId === claim.claimId)!.contractGaps.some((gap) => gap.validationIssue?.message === "Ambiguous script reference"));
  assert.equal(targetResult(result, "writingSystem.primaryScriptStrategy").status, "missing");
});

test("fix 3c: script reference list ordering and per-list scope remain deterministic", () => {
  const { profile, items } = writingIdentityFixture("system", 1);
  const scripts = profile.knowledge.writingSystem.scripts;
  assert.equal(scripts.state, "known");
  if (scripts.state !== "known") return;
  scripts.value.push({ ...structuredClone(scripts.value[0]!), scriptId: "script.other" });
  items[0]!.targetScriptRefs = ["test.script", "script.other"];
  setSlot(profile, "identity.scriptScope", { state: "known", value: ["script.other", "test.script"] });
  setSlot(profile, "writingSystem.primaryScriptStrategy", { state: "known", value: { strategy: "mixed", scriptRefs: ["test.script", "script.other"] } });
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  items[0]!.targetScriptRefs = ["script.missing", "test.script", "test.script"];
  withoutDirection(profile);
  const result = run(profile, writingDomain);
  const reordered = structuredClone(profile);
  const writing = reordered.knowledge.writingSystem;
  if (writing.scripts.state === "known") writing.scripts.value.reverse();
  if (writing.transliterationSystems.state === "known") writing.transliterationSystems.value.forEach((item) => item.targetScriptRefs.reverse());
  if (writing.primaryScriptStrategy.state === "known") writing.primaryScriptStrategy.value.scriptRefs.reverse();
  if (reordered.knowledge.identity.scriptScope.state === "known") reordered.knowledge.identity.scriptScope.value.reverse();
  assert.deepEqual(run(reordered, writingDomain), result);
});

function multiTargetClaimFixture(domain: CurriculumRequirementDomain = "possession.basic") {
  const profile = fixture(domain);
  const claims = profile.evidenceRegistry.claims;
  const claim = claims[0]!;
  claim.subjectRefs = claims.flatMap((entry) => entry.subjectRefs);
  claim.requirementEvidenceTargetRefs = claims.flatMap((entry) => entry.requirementEvidenceTargetRefs);
  profile.evidenceRegistry.claims = [claim];
  return { profile, claim };
}

function assertAncestorRejection(profile: unknown, claimId: string, path: string, domain: CurriculumRequirementDomain = "possession.basic") {
  const validation = languageProfileV2Schema.safeParse(profile);
  assert.equal(validation.success, false);
  if (!validation.success) assert.ok(validation.error.issues.some((issue) => issue.code === "invalid_type" && issue.path.join(".") === path));
  const result = run(profile, domain);
  assertContractRejected(result, claimId);
  assert.equal(result.acceptedClaims.length, 0);
  assert.equal(result.rejectedClaims.length, 1);
  const summary = result.rejectedClaims[0]!;
  assert.ok(summary.contractGaps.some((gap) => gap.claimRef === claimId && gap.validationIssue?.path === path));
  assert.ok(result.claimEvaluations.every((evaluation) => evaluation.contractGaps.some((gap) => gap.validationIssue?.path === path)));
  assert.ok(result.groups.flatMap((group) => group.targets).every((target) => target.status !== "covered" && !target.usefulEvidence));
  assert.equal(result.status, "missing");
  assert.equal(result.durableConsumable, false);
  assert.deepEqual(result.sourcesUsed, []);
  return result;
}

test("fix 3d: valid possession multi-subject claim covers all three targets with one summary", () => {
  const { profile, claim } = multiTargetClaimFixture();
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  const result = run(profile, "possession.basic");
  assertUniqueSummaries(result);
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [claim.claimId]);
  assert.equal(result.acceptedClaims[0]!.status, "accepted");
  assert.equal(result.acceptedClaims[0]!.usefulEvidence, true);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.deepEqual(result.rejectedClaims, []);
  assert.equal(result.claimEvaluations.length, 3);
  assert.ok(result.claimEvaluations.every((evaluation) => evaluation.accepted));
  assert.equal(result.groups.flatMap((group) => group.targets).filter((target) => target.status === "covered").length, 3);
  assert.equal(result.status, "covered");
  assert.equal(result.durableConsumable, true);
});

for (const variant of ["missing", "null", "invalid scalar", "missing child"] as const) {
  test(`fix 3d: ${variant} predication rejects the whole dependent multi-target claim`, () => {
    const { profile, claim } = multiTargetClaimFixture();
    const knowledge = profile.knowledge as unknown as Record<string, unknown>;
    if (variant === "missing") delete knowledge.predicationSystem;
    if (variant === "null") knowledge.predicationSystem = null;
    if (variant === "invalid scalar") knowledge.predicationSystem = 7;
    if (variant === "missing child") delete (knowledge.predicationSystem as Record<string, unknown>).possessionPredication;
    const path = "knowledge.predicationSystem" + (variant === "missing child" ? ".possessionPredication" : "");
    const original = structuredClone(profile);
    const result = assertAncestorRejection(deepFreeze(profile), claim.claimId, path);
    assert.equal(result.claimEvaluations.length, 3);
    assert.deepEqual(profile, original);
  });
}

for (const broken of ["sibling", "other section"] as const) {
  test(`fix 3d: broken ${broken} does not contaminate a healthy possession subject`, () => {
    const profile = fixture("possession.basic", false);
    const slot = "predicationSystem.possessionPredication";
    know(profile, slot);
    const claim = addClaim(profile, target("possession.basic", slot));
    if (broken === "sibling") setSlot(profile, "predicationSystem.identityPredication", null);
    else (profile.knowledge as unknown as Record<string, unknown>).verbalSystem = null;
    assert.equal(languageProfileV2Schema.safeParse(profile).success, false);
    const result = run(profile, "possession.basic");
    assertUniqueSummaries(result);
    assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [claim.claimId]);
    assert.equal(result.acceptedClaims[0]!.status, "accepted");
    assert.equal(result.acceptedClaims[0]!.usefulEvidence, true);
    assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
    assert.deepEqual(result.rejectedClaims, []);
    assert.equal(result.claimEvaluations.length, 1);
    assert.equal(result.claimEvaluations[0]!.accepted, true);
    assert.equal(targetResult(result, slot).status, "covered");
    assert.equal(result.status, "partial");
    assert.equal(result.durableConsumable, false);
  });
}

test("fix 3d: ancestor failure rejects its claim and preserves a distinct healthy claim", () => {
  const profile = fixture("possession.basic", false);
  const brokenSlot = "predicationSystem.possessionPredication", healthySlot = "semanticSystems.possession";
  know(profile, brokenSlot); know(profile, healthySlot);
  const affected = addClaim(profile, target("possession.basic", brokenSlot));
  const healthy = addClaim(profile, target("possession.basic", healthySlot));
  delete (profile.knowledge as Partial<LanguageProfileV2["knowledge"]>).predicationSystem;
  const result = run(profile, "possession.basic");
  assertContractRejected(result, affected.claimId);
  assert.equal(result.rejectedClaims.length, 1);
  assert.ok(result.rejectedClaims[0]!.contractGaps.some((gap) => gap.validationIssue?.path === "knowledge.predicationSystem"));
  assert.deepEqual(result.acceptedClaims.map((entry) => entry.claimId), [healthy.claimId]);
  assert.equal(result.acceptedClaims[0]!.status, "accepted");
  assert.equal(result.acceptedClaims[0]!.usefulEvidence, true);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.equal(result.claimEvaluations.length, 2);
  assert.equal(targetResult(result, brokenSlot).status, "missing");
  assert.equal(targetResult(result, healthySlot).status, "covered");
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
});

test("fix 3d: policy differences still permit contract-valid partial acceptance", () => {
  const { profile, claim } = multiTargetClaimFixture();
  const restricted = claim.requirementEvidenceTargetRefs[0]!;
  const result = resolveRequirementEvidence(requirement("possession.basic"), profile, {
    targetPolicies: [{ targetRef: restricted, policy: { crossCheckedMinimumIndependentSources: 3 } }],
  });
  assert.equal(languageProfileV2Schema.safeParse(profile).success, true);
  assertUniqueSummaries(result);
  assert.equal(result.acceptedClaims.length, 1);
  assert.equal(result.acceptedClaims[0]!.status, "partially_accepted");
  assert.equal(result.acceptedClaims[0]!.usefulEvidence, true);
  assert.deepEqual(result.acceptedClaims[0]!.contractGaps, []);
  assert.deepEqual(result.rejectedClaims, []);
  assert.equal(result.claimEvaluations.length, 3);
  assert.equal(result.claimEvaluations.filter((evaluation) => evaluation.accepted).length, 2);
  assert.equal(result.groups.flatMap((group) => group.targets).filter((target) => target.status === "covered").length, 2);
  assert.equal(result.status, "partial");
  assert.equal(result.durableConsumable, false);
});

test("fix 3d: ancestor contract gaps dominate a potential policy-based partial acceptance", () => {
  const { profile, claim } = multiTargetClaimFixture();
  delete (profile.knowledge as Partial<LanguageProfileV2["knowledge"]>).predicationSystem;
  const result = resolveRequirementEvidence(requirement("possession.basic"), profile, {
    targetPolicies: [{ targetRef: claim.requirementEvidenceTargetRefs[0]!, policy: { crossCheckedMinimumIndependentSources: 3 } }],
  });
  assertContractRejected(result, claim.claimId);
  assert.equal(result.claimEvaluations.length, 3);
  assert.equal(result.status, "missing");
  assert.equal(result.durableConsumable, false);
  assert.ok(result.groups.flatMap((group) => group.targets).every((target) => target.status === "missing"));
});

test("fix 3d: ancestor diagnostics and summaries remain deterministic after reordering", () => {
  const { profile, claim } = multiTargetClaimFixture();
  delete (profile.knowledge as Partial<LanguageProfileV2["knowledge"]>).predicationSystem;
  const expected = assertAncestorRejection(profile, claim.claimId, "knowledge.predicationSystem");
  const reordered = structuredClone(profile);
  reordered.evidenceRegistry.sources.reverse();
  reordered.evidenceRegistry.evidence.reverse();
  reordered.evidenceRegistry.claims[0]!.subjectRefs.reverse();
  reordered.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs.reverse();
  reordered.evidenceRegistry.claims[0]!.evidenceRefs.reverse();
  assert.deepEqual(run(deepFreeze(reordered), "possession.basic"), expected);
});

for (const variant of ["missing", "null"] as const) {
  test(`fix 3d: ${variant} writingSystem ancestor follows the same structural rule`, () => {
    const { profile, claim } = multiTargetClaimFixture("writing.beginner_system");
    const knowledge = profile.knowledge as unknown as Record<string, unknown>;
    if (variant === "missing") delete knowledge.writingSystem;
    else knowledge.writingSystem = null;
    assertAncestorRejection(profile, claim.claimId, "knowledge.writingSystem", "writing.beginner_system");
  });
}

test("fix 3d: an invalid knowledge root affects subjects that require that root", () => {
  const { profile, claim } = multiTargetClaimFixture();
  assertAncestorRejection({ ...profile, knowledge: null }, claim.claimId, "knowledge");
});
