import assert from "node:assert/strict";
import { m13Context, m13Input, m13Profile, m13Targets } from "./m13-target-evidence-v2.js";
import { lifecycleDecision } from "./profile-lifecycle-v2.js";
import { createProfileReviewCandidateV2, reviewProfileCandidateV2, type ProfileReviewCandidateV2 } from "../../src/languages/profile/profile-lifecycle-v2.js";
import { TargetEvidenceResolverV2 } from "../../src/languages/resolution/target-evidence-v2.js";
import { m14GapReferenceV2, type ControlledResearchInputV2, type ProfileResearchResultV2 } from "../../src/languages/profile-research/contracts-v2.js";
import { candidateResearchProvenanceV2Schema, type CandidateResearchProvenanceV2, type ResearchKnowledgeChangeV2 } from "../../src/languages/profile/candidate-research-provenance-v2.js";
import { languageProfileV2Schema, type LanguageProfileV2 } from "../../src/languages/profile/language-profile-v2.js";
import { profileCandidateContextShaV2 } from "../../src/languages/profile/profile-candidate-context-sha-v2.js";
import { researchSharedSlotEffectsV2 } from "../../src/languages/profile-research/scoped-knowledge-v2.js";

/** Fault injection, using the actual S3A constructor for normalized snapshot
 * hashes and its internal context SHA primitive for a cryptographically valid
 * envelope. This does NOT assert lifecycle admission: that is what tests reject. */
export function m14SemanticEnvelope(candidate: ProfileReviewCandidateV2, parent: LanguageProfileV2,
  mutate: (input: { profile: LanguageProfileV2; provenance: CandidateResearchProvenanceV2 }) => void) {
  const state = { profile: languageProfileV2Schema.parse(JSON.parse(candidate.snapshotJson)),
    provenance: candidateResearchProvenanceV2Schema.parse(candidate.lineage.origin.researchProvenance) };
  mutate(state);
  const { kind, originRef, runRef } = candidate.lineage.origin;
  const origin = { kind, originRef, ...(runRef !== undefined ? { runRef } : {}), researchProvenance: state.provenance };
  const args = { profile: state.profile, parentCanonical: parent, proposedVersion: state.profile.version };
  const construction = createProfileReviewCandidateV2({ ...args, origin });
  const legacy = createProfileReviewCandidateV2({ ...args, origin: { kind, originRef, ...(runRef !== undefined ? { runRef } : {}) } });
  assert.ok(legacy.ok, JSON.stringify(legacy));
  const envelope = { ...legacy.candidate, lineage: { ...legacy.candidate.lineage, origin } };
  return { construction, candidate: { ...envelope, candidateSha256: profileCandidateContextShaV2(envelope) } };
}

export function m14Profile(profileId = "test.m14") {
  const profile = m13Profile(profileId);
  profile.evidenceRegistry.claims.shift();
  return profile;
}

/** Test provider explicitly signs each concrete S1 leaf; never used in M14's
 * production authorization boundary. Mutating the asserted blob afterward must fail. */
export function m14Changes(value: unknown, prefix = "change", path: (string | number)[] = []): ResearchKnowledgeChangeV2[] {
  if (typeof value === "string" || Array.isArray(value) && value.length === 0) return [{ changeId: `${prefix}.${path.join(".") || "root"}`, path, value: typeof value === "string" ? value : [] }];
  if (Array.isArray(value)) return value.flatMap((item, index) => m14Changes(item, prefix, [...path, index]));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => m14Changes(child, prefix, [...path, key]));
}
export function m14Context(profile = m14Profile()) {
  const pair = m13Context();
  const created = createProfileReviewCandidateV2({ profile: { ...profile, status: "draft" }, proposedVersion: "1.0.0", parentCanonical: null,
    origin: { kind: "manual", originRef: "test.m14.base" } });
  assert.ok(created.ok);
  const reviewed = reviewProfileCandidateV2(created.candidate, lifecycleDecision(created.candidate), null);
  assert.ok(reviewed.ok && reviewed.outcome === "accepted");
  pair.canonical = { ...pair.canonical, ...reviewed.canonical, profileId: profile.identity.profileId };
  pair.registry = { ...pair.registry, profileBinding: { ...pair.registry.profileBinding, profileId: profile.identity.profileId,
    profileVersion: reviewed.canonical.snapshot.version, canonicalSha256: reviewed.canonical.snapshot.contentSha256 } };
  return pair;
}
export async function m14Input(pair = m14Context()): Promise<ControlledResearchInputV2> {
  const evidenceRequest = { ...m13Input(), userId: pair.registry.userId, canonicalRecordId: pair.canonical.id, registryRecordId: pair.registry.id };
  const gap = await new TargetEvidenceResolverV2({ getRegistryForCanonical: async () => pair }).resolve(evidenceRequest);
  assert.ok(gap.outcome === "gap");
  return { evidenceRequest, gap: m14GapReferenceV2(gap), research: { runRef: "test.m14.run", proposedVersion: "2.0.0", materialRefs: ["test.document"] } };
}
export function m14Research(): ProfileResearchResultV2 {
  const source = structuredClone(m13Profile().evidenceRegistry.sources[0]!);
  source.sourceId = "research.source";
  return {
    provenance: { providerRef: "test.provider", responseRef: "test.response" }, sources: [source],
    findings: [{ findingId: "finding.one", requirementRef: "test.requirement", target: m13Input().target,
      claimId: "research.claim", statement: "Synthetic proposed claim", subjectRefs: [m13Targets[0]!.subjectRef], confidence: "medium",
      evidence: [{ evidenceId: "research.evidence", sourceRef: source.sourceId, evidenceSummary: "Synthetic finding", materialRef: "test.document", extractionRef: "test.extraction" }],
      rationale: "Proposed evidence for the exact missing target" }],
    knowledgeAddition: null, conflicts: [], rationale: "Synthetic controlled research",
  };
}

export function m14ForeignConflict(parent: LanguageProfileV2): ProfileResearchResultV2["conflicts"][number] {
  return { conflictId: "audit.foreign.conflict", claimRefs: parent.evidenceRegistry.claims.map((claim) => claim.claimId),
    requirementEvidenceTargetRefs: [parent.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs[0]!],
    conflictType: "contradiction", resolutionStatus: "unresolved", notes: "Unrelated historical claims" };
}

/** Two exact-target research findings, with an allowed evidence-only conflict. */
export function m14ConflictResearch(): ProfileResearchResultV2 {
  const output = m14Research(), second = structuredClone(output.findings[0]!);
  second.findingId = "finding.two"; second.claimId = "research.claim.two"; second.evidence[0]!.evidenceId = "research.evidence.two";
  output.findings.push(second);
  output.conflicts = [{ conflictId: "research.conflict", claimRefs: output.findings.map((finding) => finding.claimId),
    requirementEvidenceTargetRefs: [output.findings[0]!.target], conflictType: "contradiction", resolutionStatus: "unresolved", notes: "Proposed contradictory findings" }];
  return output;
}

/** Existing S2 semantics distinguish the age-relevant mechanism from a real
 * sibling in the same slot. Both remain ordinary normalized S1 data. */
export function m14AgeApplicabilityFixture(profileId = "test.m14.applicability") {
  const profile = m14Profile(profileId);
  profile.knowledge.verbalSystem.tense = { state: "known", value: {
    featureId: "audit.tense", description: "Synthetic tense", applicability: "common",
    values: ["synthetic"], mechanisms: [
      { mechanismId: "audit.age", role: "Age expression", applicability: "common",
        conditions: [], variation: "none_known", relevance: ["age_realization"] },
      { mechanismId: "audit.foreign", role: "Unrelated action", applicability: "common",
        conditions: [], variation: "none_known", relevance: [] },
    ], conditions: [], variation: "none_known", relevance: [],
  } };
  const output = m14Research(), finding = output.findings[0]!;
  finding.target = { catalogVersion: "1.0.0", targetId: "age.basic_expression.verbalSystem.tense" };
  finding.subjectRefs = [{ kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.age" }];
  finding.knowledgeChanges = [{ changeId: "audit.age.condition", path: ["mechanisms", 0, "conditions", 0], value: "legitimate age condition" }];
  output.knowledgeAddition = null;
  return { profile, output };
}

/** Reseal the confirmed attack with the official S3A constructor/context hash.
 * The caller supplies the exact target context through durable provenance. */
export function m14MoveAgeFindingToForeignMechanism(candidate: ProfileReviewCandidateV2, parent: LanguageProfileV2,
  findingIndex = 0, reverseFindings = false) {
  return m14SemanticEnvelope(candidate, parent, ({ profile, provenance }) => {
    const slot = profile.knowledge.verbalSystem.tense;
    assert.ok(slot.state === "known");
    const finding = provenance.findings[findingIndex]!, claim = profile.evidenceRegistry.claims
      .find((entry) => entry.claimId === finding.claimRef)!;
    const originalConditionIndex = finding.knowledgeChanges[0]!.path[3];
    if (typeof originalConditionIndex !== "number") assert.fail("Expected a concrete condition index");
    slot.value.mechanisms[0]!.conditions.splice(originalConditionIndex, 1);
    slot.value.mechanisms[1]!.conditions.push("UNRELATED action condition");
    claim.subjectRefs = [{ kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.foreign" }];
    finding.knowledgeChanges[0]!.path = ["mechanisms", 1, "conditions", 0];
    finding.knowledgeChanges[0]!.subject = { kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.foreign" };
    provenance.sharedSlotEffects = researchSharedSlotEffectsV2(parent, profile.knowledge, profile.version,
      provenance.gap.requirement, provenance.gap.target, provenance.gap.options);
    if (reverseFindings) provenance.findings.reverse();
  });
}

/** The Fix 7 attack keeps an applicable subject in the same claim while the
 * mapped leaf still belongs to the unrelated mechanism. */
export function m14MixedSubjectForeignMechanism(candidate: ProfileReviewCandidateV2, parent: LanguageProfileV2,
  subjects: "both" | "reversed" | "broad" = "both", findingIndex = 0, reverseFindings = false) {
  const moved = m14MoveAgeFindingToForeignMechanism(candidate, parent, findingIndex, reverseFindings);
  return m14SemanticEnvelope(moved.candidate, parent, ({ profile, provenance }) => {
    const finding = provenance.findings.find((entry) => entry.findingRef ===
      candidate.lineage.origin.researchProvenance!.findings[findingIndex]!.findingRef)!;
    const claim = profile.evidenceRegistry.claims.find((entry) => entry.claimId === finding.claimRef)!;
    const age: typeof claim.subjectRefs[number] = { kind: "feature_mechanism", slot: "verbalSystem.tense",
      featureId: "audit.tense", mechanismId: "audit.age" };
    const foreign: typeof claim.subjectRefs[number] = { kind: "feature_mechanism", slot: "verbalSystem.tense",
      featureId: "audit.tense", mechanismId: "audit.foreign" };
    const feature: typeof claim.subjectRefs[number] = { kind: "feature", slot: "verbalSystem.tense", featureId: "audit.tense" };
    claim.subjectRefs = subjects === "both" ? [age, foreign] : subjects === "reversed" ? [foreign, age] : [age, feature];
  });
}

/** Official bootstrap/ACCEPT plus candidate, represented as S3B rows in memory. */
export function m14HistoryRows(parent: LanguageProfileV2, candidate: ProfileReviewCandidateV2) {
  const bootstrap = createProfileReviewCandidateV2({ profile: { ...parent, status: "draft" }, proposedVersion: parent.version,
    parentCanonical: null, origin: { kind: "manual", originRef: "test.reaudit.bootstrap" } });
  assert.ok(bootstrap.ok);
  const decision = lifecycleDecision(bootstrap.candidate), accepted = reviewProfileCandidateV2(bootstrap.candidate, decision, null);
  assert.ok(accepted.ok && accepted.outcome === "accepted");
  assert.equal(accepted.canonical.snapshotJson, JSON.stringify(parent));
  const canonicalId = candidate.lineage.origin.researchProvenance!.registry.binding.canonicalRecordId;
  const bootstrapId = "00000000-0000-4000-8000-000000000010", decisionId = "00000000-0000-4000-8000-000000000011";
  const meta = { profile_id: parent.identity.profileId, created_at: "2026-09-19T00:00:00Z" };
  const versions = { schema_version: "2.0.0", contract_version: "1.0.0" };
  const row = (c: ProfileReviewCandidateV2) => ({ ...meta, ...versions, version: c.snapshot.version, status: "review", snapshot_json: c.snapshotJson,
    content_sha256: c.snapshot.contentSha256, candidate_sha256: c.candidateSha256, lineage: c.lineage });
  return {
    candidates: [{ ...row(bootstrap.candidate), id: bootstrapId, event_sequence: "1", parent_canonical_record_id: null },
      { ...row(candidate), id: "00000000-0000-4000-8000-000000000013", event_sequence: "4", parent_canonical_record_id: canonicalId }],
    decisions: [{ ...meta, id: decisionId, event_sequence: "2", candidate_record_id: bootstrapId, action: "ACCEPT", decision_json: decision, canonical_record_id: canonicalId }],
    canonicals: [{ ...meta, ...versions, id: canonicalId, event_sequence: "3", version: parent.version, status: "canonical", snapshot_json: accepted.canonical.snapshotJson,
      content_sha256: accepted.canonical.snapshot.contentSha256, parent_canonical_record_id: null, candidate_record_id: bootstrapId, decision_record_id: decisionId }],
  };
}
