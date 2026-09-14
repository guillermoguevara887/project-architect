import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createProfileReviewCandidateV2, reviewProfileCandidateV2, profileReviewDecisionV2Schema,
  type ProfileReviewCandidateV2, type ProfileReviewDecisionV2,
} from "../src/languages/profile/profile-lifecycle-v2.js";
import { languageProfileV2Schema, type LanguageProfileV2 } from "../src/languages/profile/language-profile-v2.js";
import { profileKnowledgeSectionsV2Schema } from "../src/languages/profile/profile-knowledge-v2.js";
import { REQUIREMENT_EVIDENCE_TARGET_CATALOG as catalog } from "../src/languages/profile/requirement-evidence-targets.js";
import { canConsumeRequirementEvidenceDurably, resolveRequirementEvidence } from "../src/languages/profile/requirement-evidence.js";

const origin = { kind: "manual", originRef: "test.editor" } as const;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function fixture(status: LanguageProfileV2["status"] = "draft"): LanguageProfileV2 {
  return languageProfileV2Schema.parse({
    schemaVersion: "2.0.0", version: "0.1.0", status,
    identity: { profileId: "test.profile", languageId: "test", languageName: "Synthetic language", varietyId: "test.variety", varietyName: "Synthetic variety" },
    knowledge: Object.fromEntries(Object.entries(profileKnowledgeSectionsV2Schema.shape).map(([section, schema]) => [
      section, Object.fromEntries(Object.keys(schema.shape).map((field) => [field, { state: "unknown" }])),
    ])),
    evidenceRegistry: { sources: [], evidence: [], claims: [], conflicts: [] },
  });
}
function candidate(profile = fixture(), parentCanonical: LanguageProfileV2 | null = null, proposedVersion = "0.2.0") {
  const result = createProfileReviewCandidateV2({ profile, parentCanonical, proposedVersion, origin });
  assert.ok(result.ok, JSON.stringify(result));
  return result.candidate;
}
function decision(value: ProfileReviewCandidateV2, action: "ACCEPT" | "REJECT" = "ACCEPT"): ProfileReviewDecisionV2 {
  return profileReviewDecisionV2Schema.parse({
    candidateSha256: value.candidateSha256, contentSha256: value.snapshot.contentSha256,
    decision: action, reviewer: { kind: "human", reviewerRef: "test.reviewer" }, decidedAt: "2026-09-13T00:00:00Z",
  });
}
function accepted(value = candidate(), parent: LanguageProfileV2 | null = null) {
  const result = reviewProfileCandidateV2(value, decision(value), parent);
  assert.ok(result.ok && result.outcome === "accepted", JSON.stringify(result));
  return result;
}
function errorCode(result: ReturnType<typeof reviewProfileCandidateV2> | ReturnType<typeof createProfileReviewCandidateV2>, code: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.code, code);
}
// Adversarial caller: even rehashing a forged envelope cannot bypass S1 or lifecycle validation.
function reseal(value: ProfileReviewCandidateV2, profile: unknown): ProfileReviewCandidateV2 {
  const copy = JSON.parse(JSON.stringify(value));
  copy.snapshotJson = JSON.stringify(profile);
  copy.snapshot.contentSha256 = sha(copy.snapshotJson);
  copy.snapshot.status = (profile as LanguageProfileV2).status;
  copy.candidateSha256 = sha(JSON.stringify({ snapshotJson: copy.snapshotJson, snapshot: copy.snapshot, lineage: copy.lineage }));
  return copy;
}
function assertFrozen(value: unknown) {
  if (value !== null && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertFrozen(child);
  }
}

test("S3A candidate fixes review state, proposed version, schema, contract and origin", () => {
  const value = candidate();
  assert.equal(value.snapshot.status, "review");
  assert.equal(value.snapshot.profileId, "test.profile");
  assert.equal(value.snapshot.version, "0.2.0");
  assert.equal(value.snapshot.schemaVersion, "2.0.0");
  assert.equal(value.snapshot.contractVersion, catalog.catalogVersion);
  assert.deepEqual(value.lineage.origin, origin);
  assert.equal(value.lineage.source.status, "draft");
  assert.equal(value.lineage.source.version, "0.1.0");
});
test("S3A candidate creation does not mutate inputs and freezes its complete record", () => {
  const profile = fixture();
  const before = structuredClone(profile);
  const value = candidate(profile);
  assert.deepEqual(profile, before);
  assertFrozen(value);
  profile.identity.languageName = "Changed input";
  assert.equal(JSON.parse(value.snapshotJson).identity.languageName, before.identity.languageName);
});
test("S3A SHA covers the exact stored UTF-8 review snapshot", () => {
  const value = candidate();
  assert.equal(value.snapshot.contentSha256, sha(value.snapshotJson));
  assert.equal(value.lineage.source.contentSha256, sha(JSON.stringify(fixture())));
  assert.notEqual(value.snapshot.contentSha256, sha(value.snapshotJson + "\n"));
});
test("S3A changing content creates a different candidate and content SHA", () => {
  const first = candidate();
  const profile = fixture();
  profile.identity.languageName = "Another reviewed name";
  const second = candidate(profile);
  assert.notEqual(first.snapshot.contentSha256, second.snapshot.contentSha256);
  assert.notEqual(first.candidateSha256, second.candidateSha256);
});
test("S3A candidate normalizes S1 text before review, never at ACCEPT time", () => {
  const profile = fixture();
  profile.identity.languageName = "  Synthetic language  ";
  const value = candidate(profile);
  assert.equal(JSON.parse(value.snapshotJson).identity.languageName, "Synthetic language");
  assert.equal(accepted(value).candidate.snapshotJson, value.snapshotJson);
});
test("S3A correct human ACCEPT bootstraps a new canonical without a parent", () => {
  const result = accepted();
  assert.equal(result.canonical.snapshot.status, "canonical");
  assert.equal(result.canonical.snapshot.version, "0.2.0");
  assert.equal(result.candidate.lineage.parentCanonical, null);
  assert.equal(result.decision.decision, "ACCEPT");
  assert.equal(result.decision.reviewer.reviewerRef, "test.reviewer");
});
test("S3A canonical preserves exact approved content and version except the explicit lifecycle change", () => {
  const value = candidate();
  const result = accepted(value);
  const expected = JSON.parse(value.snapshotJson);
  expected.status = "canonical";
  assert.equal(result.canonical.snapshotJson, JSON.stringify(expected));
  assert.equal(result.canonical.snapshot.contentSha256, sha(result.canonical.snapshotJson));
  assert.notEqual(result.canonical.snapshot.contentSha256, value.snapshot.contentSha256);
  assert.deepEqual(result.candidate, value);
  assert.equal(result.decision.contentSha256, value.snapshot.contentSha256);
});
test("S3A missing or implicit reviewer cannot authorize promotion", () => {
  const value = candidate();
  const raw = { ...decision(value), reviewer: undefined };
  errorCode(reviewProfileCandidateV2(value, raw, null), "decision_invalid");
  errorCode(reviewProfileCandidateV2(value, { ...decision(value), reviewer: { kind: "human", reviewerRef: " " } }, null), "decision_invalid");
});
test("S3A machine reviewer and inferred actions cannot authorize promotion", () => {
  const value = candidate();
  errorCode(reviewProfileCandidateV2(value, { ...decision(value), reviewer: { kind: "machine", reviewerRef: "test.ai" } }, null), "decision_invalid");
  errorCode(reviewProfileCandidateV2(value, { ...decision(value), decision: "approved" }, null), "decision_invalid");
});
test("S3A preserves origin and explicit run lineage through ACCEPT", () => {
  const input = { profile: fixture(), parentCanonical: null, proposedVersion: "0.2.0", origin: { kind: "researched", originRef: "test.research", runRef: "test.run" } };
  const created = createProfileReviewCandidateV2(input);
  assert.ok(created.ok);
  assert.deepEqual(accepted(created.candidate).candidate.lineage.origin, input.origin);
  errorCode(reviewProfileCandidateV2(created.candidate, undefined, null), "decision_invalid");
});
test("S3A revision binds the exact parent and leaves the previous canonical untouched", () => {
  const parent = fixture("canonical");
  const before = structuredClone(parent);
  const value = candidate(parent, parent);
  const result = accepted(value, parent);
  assert.equal(result.candidate.lineage.parentCanonical?.contentSha256, sha(JSON.stringify(parent)));
  assert.deepEqual(result.candidate.lineage.source, result.candidate.lineage.parentCanonical);
  assert.equal(result.canonical.snapshot.version, "0.2.0");
  assert.deepEqual(parent, before);
  assert.equal(parent.version, "0.1.0");
});
test("S3A decision for content A cannot be applied to candidate B", () => {
  const a = candidate();
  const profile = fixture();
  profile.identity.varietyName = "Updated variety display name";
  const b = candidate(profile);
  errorCode(reviewProfileCandidateV2(b, decision(a), null), "snapshot_mismatch");
});
test("S3A modifying a sealed candidate invalidates its existing decision", () => {
  const value = candidate();
  const changed = { ...value, snapshotJson: value.snapshotJson.replace("Synthetic language", "Altered language") };
  errorCode(reviewProfileCandidateV2(changed, decision(value), null), "snapshot_mismatch");
});
test("S3A a newly sealed context requires a new decision even for identical review content", () => {
  const a = candidate();
  const created = createProfileReviewCandidateV2({ profile: fixture(), parentCanonical: null, proposedVersion: "0.2.0", origin: { ...origin, originRef: "test.other" } });
  assert.ok(created.ok);
  assert.equal(a.snapshot.contentSha256, created.candidate.snapshot.contentSha256);
  errorCode(reviewProfileCandidateV2(created.candidate, decision(a), null), "stale_decision");
});
test("S3A REJECT records the decision and lineage without a canonical or parent mutation", () => {
  const parent = fixture("canonical");
  const before = structuredClone(parent);
  const value = candidate(parent, parent);
  const result = reviewProfileCandidateV2(value, decision(value, "REJECT"), parent);
  assert.ok(result.ok && result.outcome === "rejected");
  assert.equal(result.canonical, null);
  assert.deepEqual(result.candidate, value);
  assert.equal(result.decision.decision, "REJECT");
  assert.equal(JSON.parse(result.candidate.snapshotJson).status, "review");
  assert.deepEqual(parent, before);
  assertFrozen(result);
});
test("S3A REJECT is also bound to its exact snapshot", () => {
  const value = candidate();
  errorCode(reviewProfileCandidateV2(value, { ...decision(value, "REJECT"), contentSha256: "0".repeat(64) }, null), "snapshot_mismatch");
});
test("S3A draft and review sources both create review snapshots without auto-promotion", () => {
  for (const state of ["draft", "review"] as const) {
    const value = candidate(fixture(state));
    assert.equal(value.snapshot.status, "review");
    assert.equal("canonical" in value, false);
    errorCode(reviewProfileCandidateV2(value, undefined, null), "decision_invalid");
    assert.equal(accepted(value).canonical.snapshot.status, "canonical");
  }
});
for (const state of ["draft", "canonical", "deprecated"] as const) {
  test(`S3A direct ${state} to canonical promotion is illegal even with a matching ACCEPT`, () => {
    const value = candidate();
    const profile = JSON.parse(value.snapshotJson);
    profile.status = state;
    const forged = reseal(value, profile);
    errorCode(reviewProfileCandidateV2(forged, decision(forged), null), "illegal_lifecycle_transition");
  });
}
test("S3A deprecated sources cannot silently return to review", () => {
  errorCode(createProfileReviewCandidateV2({ profile: fixture("deprecated"), parentCanonical: null, proposedVersion: "0.2.0", origin }), "illegal_lifecycle_transition");
});
test("S3A canonical sources require their real parent and a different proposed version", () => {
  const parent = fixture("canonical");
  errorCode(createProfileReviewCandidateV2({ profile: parent, parentCanonical: null, proposedVersion: "0.2.0", origin }), "lineage_mismatch");
  errorCode(createProfileReviewCandidateV2({ profile: parent, parentCanonical: parent, proposedVersion: parent.version, origin }), "lineage_mismatch");
});
test("S3A candidate rejects invalid S1 contracts instead of repairing them", () => {
  const profile = fixture();
  delete (profile as Partial<LanguageProfileV2>).knowledge;
  errorCode(createProfileReviewCandidateV2({ profile, parentCanonical: null, proposedVersion: "0.2.0", origin }), "candidate_invalid");
});
test("S3A ACCEPT cannot promote a contract-invalid profile even with recomputed hashes", () => {
  const value = candidate();
  const profile = JSON.parse(value.snapshotJson);
  delete profile.knowledge.predicationSystem;
  const forged = reseal(value, profile);
  errorCode(reviewProfileCandidateV2(forged, decision(forged), null), "candidate_invalid");
});
test("S3A snapshot metadata and digest must match the reviewed content", () => {
  const value = candidate();
  const forged = reseal({ ...value, snapshot: { ...value.snapshot, version: "9.0.0" } }, JSON.parse(value.snapshotJson));
  errorCode(reviewProfileCandidateV2(forged, decision(forged), null), "snapshot_mismatch");
});
test("S3A rejects stale parent bindings rather than silently rebasing review", () => {
  const parent = fixture("canonical");
  const value = candidate(parent, parent);
  const newer = structuredClone(parent);
  newer.version = "0.3.0";
  errorCode(reviewProfileCandidateV2(value, decision(value), newer), "lineage_mismatch");
  errorCode(reviewProfileCandidateV2(value, decision(value), null), "lineage_mismatch");
  errorCode(reviewProfileCandidateV2(candidate(), decision(candidate()), newer), "lineage_mismatch");
});
test("S3A lineage rejects foreign identities and non-canonical parents", () => {
  const parent = fixture("canonical");
  const foreign = fixture();
  foreign.identity.profileId = "test.foreign";
  errorCode(createProfileReviewCandidateV2({ profile: foreign, parentCanonical: parent, proposedVersion: "0.2.0", origin }), "lineage_mismatch");
  errorCode(createProfileReviewCandidateV2({ profile: fixture(), parentCanonical: fixture("review"), proposedVersion: "0.2.0", origin }), "lineage_mismatch");
});
test("S3A explicit parent context and decision timestamp are required", () => {
  errorCode(createProfileReviewCandidateV2({ profile: fixture(), proposedVersion: "0.2.0", origin }), "candidate_invalid");
  const value = candidate();
  errorCode(reviewProfileCandidateV2(value, { ...decision(value), decidedAt: undefined }, null), "decision_invalid");
  errorCode(reviewProfileCandidateV2(value, decision(value), undefined), "lineage_mismatch");
});
test("S3A same inputs give identical candidates and review outcomes without mutation", () => {
  const value = candidate();
  const review = decision(value);
  const before = JSON.stringify({ value, review });
  assert.deepEqual(candidate(), value);
  assert.deepEqual(reviewProfileCandidateV2(value, review, null), reviewProfileCandidateV2(value, review, null));
  assert.equal(JSON.stringify({ value, review }), before);
  assertFrozen(accepted(value));
});
test("S3A partial canonical approval does not invent evidence sufficiency", () => {
  const result = accepted();
  const evidence = resolveRequirementEvidence({ requirementRef: "test.req", domain: "phonology.initial_intelligibility" }, JSON.parse(result.canonical.snapshotJson));
  assert.equal(evidence.status, "missing");
  assert.equal(canConsumeRequirementEvidenceDurably(evidence), false);
});

function coveredProfile(): LanguageProfileV2 {
  const profile = fixture("review");
  const domain = catalog.domains.find((entry) => entry.domain === "phonology.initial_intelligibility")!;
  const target = domain.groups[0]!.targets[0]!;
  profile.knowledge.phonology.segmentalSystem = { state: "known", value: {
    featureId: "test.feature", description: "Synthetic feature", applicability: "common", values: ["test"],
    conditions: [], variation: "none_known", relevance: ["initial_intelligibility"], mechanisms: [],
  } };
  profile.evidenceRegistry.sources = [1, 2].map((n) => ({
    sourceId: `test.source.${n}`, sourceType: "reference_book", title: "Synthetic source", publisherOrAuthor: "Synthetic author",
    reference: { kind: "bibliographic", citation: "Synthetic citation" }, sourceLanguage: "test", authorityClass: "authoritative",
    independenceKey: { responsibleEntityId: `test.author.${n}`, workId: `test.work.${n}`, lineageId: `test.lineage.${n}` },
  }));
  profile.evidenceRegistry.evidence = [1, 2].map((n) => ({ evidenceId: `test.evidence.${n}`, sourceRef: `test.source.${n}`, locator: "Synthetic section", evidenceSummary: "Synthetic evidence" }));
  profile.evidenceRegistry.claims = [{
    claimId: "test.claim", statement: "Synthetic claim",
    subjectRefs: [{ kind: "feature", slot: "phonology.segmentalSystem", featureId: "test.feature" }],
    requirementEvidenceTargetRefs: [{ catalogVersion: "1.0.0", targetId: target.targetId }],
    evidenceRefs: [1, 2].map((n) => ({ evidenceRef: `test.evidence.${n}`, relationshipValidation: { status: "unvalidated" } })),
    confidence: "medium", reviewStatus: "cross_checked", requirementRefs: ["test.req"],
    origin: { kind: "manual", authorRef: "test.author", recordedAt: "2026-09-13T00:00:00Z" },
  }];
  return languageProfileV2Schema.parse(profile);
}
test("S3A covered preview without explicit ACCEPT cannot create canonical", () => {
  const profile = coveredProfile();
  const evidence = resolveRequirementEvidence({ requirementRef: "test.req", domain: "phonology.initial_intelligibility" }, profile, { mode: "preview" });
  assert.equal(evidence.status, "covered");
  const value = candidate(profile);
  errorCode(reviewProfileCandidateV2(value, evidence, null), "decision_invalid");
});
test("S3A durableConsumable true is not a human ACCEPT", () => {
  const profile = coveredProfile();
  profile.status = "canonical";
  const evidence = resolveRequirementEvidence({ requirementRef: "test.req", domain: "phonology.initial_intelligibility" }, profile);
  assert.equal(evidence.status, "covered");
  assert.equal(canConsumeRequirementEvidenceDurably(evidence), true);
  const value = candidate(profile, profile);
  errorCode(reviewProfileCandidateV2(value, evidence, profile), "decision_invalid");
});
