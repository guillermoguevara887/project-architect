import assert from "node:assert/strict";
import { languageProfileV2Schema, type LanguageProfileV2 } from "../../src/languages/profile/language-profile-v2.js";
import { profileKnowledgeSectionsV2Schema } from "../../src/languages/profile/profile-knowledge-v2.js";
import { createProfileReviewCandidateV2, type ProfileReviewCandidateV2 } from "../../src/languages/profile/profile-lifecycle-v2.js";

export function lifecycleProfile(profileId = "test.persistence"): LanguageProfileV2 {
  return languageProfileV2Schema.parse({
    schemaVersion: "2.0.0", version: "0.1.0", status: "draft",
    identity: { profileId, languageId: "test", languageName: "Synthetic language", varietyId: "test.variety", varietyName: "Synthetic variety" },
    knowledge: Object.fromEntries(Object.entries(profileKnowledgeSectionsV2Schema.shape).map(([section, schema]) => [
      section, Object.fromEntries(Object.keys(schema.shape).map((slot) => [slot, { state: "unknown" }])),
    ])),
    evidenceRegistry: { sources: [], evidence: [], claims: [], conflicts: [] },
  });
}

export function lifecycleCandidate(profileId = "test.persistence", version = "1.0.0", parent: LanguageProfileV2 | null = null, context = "test.origin") {
  const result = createProfileReviewCandidateV2({
    profile: parent ?? lifecycleProfile(profileId), proposedVersion: version, parentCanonical: parent,
    origin: { kind: "researched", originRef: context, runRef: "test.run" },
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.candidate;
}

export function lifecycleDecision(candidate: ProfileReviewCandidateV2, decision: "ACCEPT" | "REJECT" = "ACCEPT", decidedAt = "2026-09-13T00:00:00Z") {
  return {
    candidateSha256: candidate.candidateSha256, contentSha256: candidate.snapshot.contentSha256,
    decision, reviewer: { kind: "human" as const, reviewerRef: "test.reviewer" }, decidedAt,
    note: "Synthetic persistence test",
  };
}
