import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { RegistryGroundingStoreV2 } from "../../src/languages/knowledge/registry-grounding-v2.js";
import { createProfileReviewCandidateV2, reviewProfileCandidateV2 } from "../../src/languages/profile/profile-lifecycle-v2.js";
import { languageProfileV2Schema } from "../../src/languages/profile/language-profile-v2.js";
import { REQUIREMENT_EVIDENCE_TARGET_CATALOG as catalog } from "../../src/languages/profile/requirement-evidence-targets.js";
import { groundingProfile, groundingRegistry } from "./registry-grounding-v2.js";
import { lifecycleDecision } from "./profile-lifecycle-v2.js";

export const m13Ids = {
  userId: "00000000-0000-4000-8000-000000000001",
  canonicalRecordId: "00000000-0000-4000-8000-000000000002",
  registryRecordId: "00000000-0000-4000-8000-000000000003",
};
export const m13Targets = catalog.domains.find((entry) => entry.domain === "possession.basic")!.groups[0]!.targets;
export function m13Input(mode: "preview" | "durable" = "durable") {
  return { ...m13Ids, requirement: { requirementRef: "test.requirement", domain: "possession.basic" as const },
    target: { catalogVersion: "1.0.0" as const, targetId: m13Targets[0]!.targetId }, mode };
}
/** Synthetic facts with two independent sources; never real language evidence. */
export function m13Profile(profileId = "test.m13", sourceCount = 2) {
  const profile = groundingProfile(profileId);
  profile.status = "canonical";
  profile.evidenceRegistry.sources = Array.from({ length: sourceCount }, (_, i) => ({
    sourceId: `test.source.${i}`, sourceType: "reference_book" as const, title: `Synthetic source ${i}`,
    publisherOrAuthor: `Synthetic author ${i}`, sourceLanguage: "test", authorityClass: "authoritative" as const,
    reference: { kind: "bibliographic" as const, citation: `Synthetic reference ${i}` },
    independenceKey: { responsibleEntityId: `test.entity.${i}`, workId: `test.work.${i}`, lineageId: `test.lineage.${i}` },
  }));
  profile.evidenceRegistry.evidence = profile.evidenceRegistry.sources.map((source, i) => ({
    evidenceId: `test.evidence.${i}`, sourceRef: source.sourceId, locator: `Synthetic section ${i}`, evidenceSummary: "Synthetic evidence",
  }));
  for (const target of m13Targets) {
    const [section, slot] = target.subjectRef.slot.split(".");
    (profile.knowledge as unknown as Record<string, Record<string, unknown>>)[section!]![slot!] = {
      state: "known", value: { featureId: `test.${slot}`, description: "Synthetic possession feature", applicability: "common",
        values: ["synthetic"], mechanisms: [], conditions: [], variation: "none_known", relevance: [] },
    };
    profile.evidenceRegistry.claims.push({
      claimId: `claim.${target.targetId}`, statement: "Synthetic claim", subjectRefs: [target.subjectRef],
      requirementEvidenceTargetRefs: [{ catalogVersion: "1.0.0", targetId: target.targetId }],
      evidenceRefs: profile.evidenceRegistry.evidence.map((evidence) => ({ evidenceRef: evidence.evidenceId, relationshipValidation: { status: "unvalidated" } })),
      confidence: "medium", reviewStatus: "cross_checked", requirementRefs: ["test.requirement"],
      origin: { kind: "manual", authorRef: "test.author", recordedAt: "2026-09-16T00:00:00Z" },
    });
  }
  return languageProfileV2Schema.parse(profile);
}

export function m13Context(): Awaited<ReturnType<RegistryGroundingStoreV2["getRegistryForCanonical"]>> {
  const profile = m13Profile(); profile.status = "draft";
  const candidate = createProfileReviewCandidateV2({ profile, proposedVersion: "1.0.0", parentCanonical: null, origin: { kind: "manual", originRef: "test.m13" } });
  assert.ok(candidate.ok);
  const outcome = reviewProfileCandidateV2(candidate.candidate, lifecycleDecision(candidate.candidate), null);
  assert.ok(outcome.ok && outcome.outcome === "accepted");
  const snapshot = outcome.canonical.snapshot, registry = groundingRegistry();
  return {
    canonical: { id: m13Ids.canonicalRecordId, profileId: snapshot.profileId, eventSequence: "3", createdAt: new Date("2026-09-16T00:00:00Z"),
      kind: "canonical", parentCanonicalRecordId: null, candidateRecordId: m13Ids.userId, decisionRecordId: m13Ids.registryRecordId,
      snapshotJson: outcome.canonical.snapshotJson, snapshot },
    registry: { id: m13Ids.registryRecordId, userId: m13Ids.userId, registry, createdAt: new Date("2026-09-16T00:00:00Z"),
      contentSha256: createHash("sha256").update(JSON.stringify(registry)).digest("hex"),
      profileBinding: { bindingVersion: "1.0.0", profileId: snapshot.profileId, profileVersion: snapshot.version, schemaVersion: snapshot.schemaVersion,
        contractVersion: snapshot.contractVersion, canonicalRecordId: m13Ids.canonicalRecordId, canonicalSha256: snapshot.contentSha256 } },
  };
}
