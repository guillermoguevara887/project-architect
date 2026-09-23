import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { ControlledProfileResearchV2, type ProfileResearchProviderV2 } from "../src/languages/profile-research/controlled-research-v2.js";
import { buildProfileResearchProposalV2 } from "../src/languages/profile-research/proposal-v2.js";
import { classifyM14GapV2, m14GapReferenceV2 } from "../src/languages/profile-research/contracts-v2.js";
import { RegistryGroundingErrorV2 } from "../src/languages/knowledge/registry-grounding-v2.js";
import { decodeProfileHistoryV2, ProfileLifecycleStoreError, type ProfileCandidateRecordV2, type ProfileDecisionRecordV2 } from "../src/languages/profile/profile-lifecycle-store-v2.js";
import { createProfileReviewCandidateV2, reviewProfileCandidateV2, validateProfileReviewCandidateV2 } from "../src/languages/profile/profile-lifecycle-v2.js";
import { languageProfileV2Schema } from "../src/languages/profile/language-profile-v2.js";
import { canConsumeRequirementEvidenceDurably, resolveRequirementEvidence } from "../src/languages/profile/requirement-evidence.js";
import type { ControlledResearchInputV2 } from "../src/languages/profile-research/contracts-v2.js";
import { lifecycleDecision } from "./fixtures/profile-lifecycle-v2.js";
import { TargetEvidenceResolverV2 } from "../src/languages/resolution/target-evidence-v2.js";
import { m13Input, m13Profile, m13Targets } from "./fixtures/m13-target-evidence-v2.js";
import { m14AgeApplicabilityFixture, m14Changes, m14Context, m14Input, m14Profile, m14Research, m14SemanticEnvelope,
  m14ForeignConflict, m14ConflictResearch, m14HistoryRows, m14MoveAgeFindingToForeignMechanism,
  m14MixedSubjectForeignMechanism } from "./fixtures/m14-controlled-research-v2.js";
import { profileCandidateContextShaV2 } from "../src/languages/profile/profile-candidate-context-sha-v2.js";
import { researchSharedSlotEffectsV2 } from "../src/languages/profile-research/scoped-knowledge-v2.js";

async function harness(profile = m14Profile()) {
  const pair = m14Context(profile), input = await m14Input(pair);
  let current = pair.canonical;
  let providerCalls = 0, persistCalls = 0, readCalls = 0;
  let decision: ProfileDecisionRecordV2 | null = null;
  let readError: Error | undefined, persistError: Error | undefined;
  let action: ProfileResearchProviderV2["research"] = async () => m14Research();
  let beforePersist = () => {};
  const records: ProfileCandidateRecordV2[] = [];
  const grounding = { getRegistryForCanonical: async (userId: string, registryId: string, canonicalId: string) => {
    readCalls++;
    if (readError) throw readError;
    if (userId !== pair.registry.userId || registryId !== pair.registry.id) throw new RegistryGroundingErrorV2("registry_not_found");
    if (canonicalId !== pair.canonical.id) throw new RegistryGroundingErrorV2("registry_profile_mismatch");
    return pair;
  } };
  const candidates = {
    getCurrentCanonical: async () => current,
    getReviewDecision: async () => decision,
    persistReviewCandidate: async ({ candidate, parentCanonicalRecordId }: { candidate: unknown; parentCanonicalRecordId: string | null }) => {
      persistCalls++; beforePersist();
      if (persistError) throw persistError;
      const checked = validateProfileReviewCandidateV2(candidate, JSON.parse(pair.canonical.snapshotJson));
      assert.ok(checked.ok);
      const existing = records.find((entry) => entry.candidate.candidateSha256 === checked.candidate.candidateSha256);
      if (existing) return existing;
      if (current.id !== parentCanonicalRecordId) throw new ProfileLifecycleStoreError("stale_parent");
      const record: ProfileCandidateRecordV2 = { id: "00000000-0000-4000-8000-000000000014", profileId: pair.canonical.profileId,
        kind: "candidate", eventSequence: "4", createdAt: new Date("2026-09-16T00:00:00Z"), parentCanonicalRecordId, candidate: checked.candidate };
      records.push(record); return record;
    },
  };
  const service = new ControlledProfileResearchV2({ research: async (...args) => { providerCalls++; return action(...args); } }, grounding, candidates);
  return { pair, input, service, grounding, candidates, records, counts: () => ({ providerCalls, persistCalls, readCalls }),
    provider: (next: typeof action) => { action = next; }, readError: (error: Error) => { readError = error; }, persistError: (error: Error) => { persistError = error; },
    promote: () => { current = { ...pair.canonical, id: "00000000-0000-4000-8000-000000000099" }; },
    beforePersist: (callback: () => void) => { beforePersist = callback; },
    reviewed: () => { decision = {} as ProfileDecisionRecordV2; },
  };
}

test("M14 missing gap -> proposal -> S1/S3A review candidate with exact parent, no authority", async () => {
  const h = await harness(), before = structuredClone(h.pair), result = await h.service.research(h.input);
  assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  assert.equal(result.candidateStatus, "review"); assert.equal(result.humanReviewRequired, true); assert.equal(result.canonicalChangedByM14, false);
  assert.equal(result.candidate.parentCanonicalRecordId, h.pair.canonical.id);
  assert.deepEqual(result.candidate.candidate.lineage.parentCanonical, h.pair.canonical.snapshot);
  assert.equal(result.candidate.candidate.lineage.origin.originRef, `m14.${result.proposal.proposalSha256}`);
  const profile = languageProfileV2Schema.parse(JSON.parse(result.candidate.candidate.snapshotJson));
  assert.equal(profile.status, "review"); assert.equal(profile.version, "2.0.0");
  const claim = profile.evidenceRegistry.claims.at(-1)!;
  assert.equal(claim.reviewStatus, "needs_review"); assert.equal(claim.evidenceRefs[0]!.relationshipValidation.status, "unvalidated");
  assert.equal(result.preview.mode, "preview"); assert.equal(canConsumeRequirementEvidenceDurably(result.preview), false);
  assert.equal(result.preview.profileVersion, "2.0.0");
  assert.ok(result.preview.claimEvaluations.filter((entry) => entry.claimId === claim.claimId).every((entry) => !entry.accepted));
  assert.deepEqual(h.pair, before); assert.equal(h.records.length, 1);
});

test("M14 partial/independence gap permits one proposer call", async () => {
  const profile = m13Profile(); profile.evidenceRegistry.claims[0]!.evidenceRefs = profile.evidenceRegistry.claims[0]!.evidenceRefs.slice(0, 1);
  const h = await harness(profile); assert.equal(h.input.gap.reason, "evidence_partial");
  assert.equal((await h.service.research(h.input)).outcome, "proposal_created"); assert.equal(h.counts().providerCalls, 1);
});

test("M14 currently authorized target blocks an old/fabricated gap before research", async () => {
  const h = await harness(); h.pair.canonical.snapshotJson = JSON.stringify(m13Profile());
  assert.deepEqual(await h.service.research(h.input), { outcome: "not_researchable", reason: "no_gap" });
  assert.equal(h.counts().providerCalls, 0);
});

test("M14 rejects fabricated provenance, reason, resolution, target and policy", async () => {
  for (const change of [
    (input: Awaited<ReturnType<typeof m14Input>>) => { input.gap.reason = "evidence_partial"; },
    (input: Awaited<ReturnType<typeof m14Input>>) => { input.gap.resolutionSha256 = "0".repeat(64); },
    (input: Awaited<ReturnType<typeof m14Input>>) => { input.gap.provenance.binding.canonicalSha256 = "0".repeat(64); },
    (input: Awaited<ReturnType<typeof m14Input>>) => { input.evidenceRequest.target = { ...input.evidenceRequest.target, targetId: m13Targets[1]!.targetId }; },
    (input: Awaited<ReturnType<typeof m14Input>>) => { input.evidenceRequest.options = { targetPolicies: [{ targetRef: input.evidenceRequest.target, policy: { crossCheckedMinimumIndependentSources: 3 } }] }; },
  ]) {
    const h = await harness(); change(h.input);
    assert.equal((await h.service.research(h.input)).outcome, "not_researchable"); assert.equal(h.counts().providerCalls, 0);
  }
});

for (const reason of ["storage_integrity", "registry_profile_mismatch", "registry_unbound", "canonical_not_found", "registry_not_found"] as const) {
  test(`M14 ${reason} cannot masquerade as missing`, async () => {
    const h = await harness(); h.readError(new RegistryGroundingErrorV2(reason));
    assert.deepEqual(await h.service.research(h.input), { outcome: "error", reason, stage: "revalidation" });
    assert.equal(h.counts().providerCalls, 0); assert.equal(h.records.length, 0);
  });
}

test("M14 ownership and stale Registry reject exact reference substitutions", async () => {
  for (const key of ["userId", "canonicalRecordId", "registryRecordId"] as const) {
    const h = await harness(); h.input.evidenceRequest[key] = "00000000-0000-4000-8000-000000000099";
    assert.equal((await h.service.research(h.input)).outcome, "error"); assert.equal(h.counts().providerCalls, 0);
  }
});

test("M14 malformed/free-text/profile/claims inputs and preview never enter research", async () => {
  const h = await harness();
  for (const input of ["investiga alemán", {}, { ...h.input, profile: m13Profile() }, { ...h.input, claims: [] },
    { ...h.input, evidenceRequest: { ...h.input.evidenceRequest, mode: "preview" } },
    { ...h.input, gap: { ...h.input.gap, outcome: "error" } }]) {
    assert.deepEqual(await h.service.research(input), { outcome: "error", reason: "invalid_input", stage: "input" });
  }
  assert.equal(h.counts().readCalls, 0); assert.equal(h.counts().providerCalls, 0);
});

test("M14 S2 contract corruption is an error, never research", async () => {
  const h = await harness(), corrupt = JSON.parse(h.pair.canonical.snapshotJson); delete corrupt.knowledge.semanticSystems;
  h.pair.canonical.snapshotJson = JSON.stringify(corrupt);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "error"); assert.equal(result.reason, "evidence_invalid");
  assert.equal(h.counts().providerCalls, 0);
});

test("M14 refuses evaluation limits, review-only deficits and locally covered targets", async () => {
  const profiles = [m13Profile("test.limit", 13), m13Profile(), m13Profile()];
  profiles[1]!.evidenceRegistry.claims[0]!.reviewStatus = "needs_review";
  profiles[2]!.evidenceRegistry.claims.pop();
  for (const profile of profiles) {
    const h = await harness(profile);
    assert.deepEqual(await h.service.research(h.input), { outcome: "not_researchable", reason: "non_epistemic_gap" });
    assert.equal(h.counts().providerCalls, 0);
  }
});

test("M14 empty result is unresolved and never creates a candidate", async () => {
  const h = await harness(); h.provider(async () => ({ ...m14Research(), sources: [], findings: [] }));
  const result = await h.service.research(h.input); assert.ok(result.outcome === "gap_unresolved"); assert.equal(result.reason, "no_findings");
  assert.equal(h.counts().persistCalls, 0);
});

test("M14 provider failure terminates once without persistence or leaked error text", async () => {
  const h = await harness(); h.provider(async () => { throw new Error("sensitive provider detail"); });
  assert.deepEqual(await h.service.research(h.input), { outcome: "error", reason: "provider_failed", stage: "provider" });
  assert.equal(h.counts().providerCalls, 1); assert.equal(h.counts().persistCalls, 0);
});

test("M14 provider timeout aborts and a late result has no write path", async () => {
  const h = await harness(); let signal: AbortSignal | undefined, finish: ((value: unknown) => void) | undefined;
  const service = new ControlledProfileResearchV2({ research: async (_, abort) => { signal = abort; return new Promise((resolve) => { finish = resolve; }); } }, h.grounding, h.candidates, 10);
  assert.deepEqual(await service.research(h.input), { outcome: "error", reason: "provider_timeout", stage: "provider" });
  assert.equal(signal?.aborted, true); finish!(m14Research()); await Promise.resolve(); assert.equal(h.counts().persistCalls, 0);
});

test("M14 validates scope, references, collisions and provider authority claims before S3A", async () => {
  for (const mutate of [
    (r: ReturnType<typeof m14Research>) => { r.findings[0]!.target = { ...m13Input().target, targetId: m13Targets[1]!.targetId }; },
    (r: ReturnType<typeof m14Research>) => { r.findings[0]!.requirementRef = "other.requirement"; },
    (r: ReturnType<typeof m14Research>) => { r.findings[0]!.subjectRefs = [m13Targets[1]!.subjectRef]; },
    (r: ReturnType<typeof m14Research>) => { r.findings[0]!.evidence[0]!.sourceRef = "unknown.source"; },
    (r: ReturnType<typeof m14Research>) => { r.sources[0]!.sourceId = "test.source.0"; r.findings[0]!.evidence[0]!.sourceRef = "test.source.0"; },
    (r: ReturnType<typeof m14Research>) => { Reflect.set(r.findings[0]!, "reviewStatus", "human_reviewed"); },
    (r: ReturnType<typeof m14Research>) => { Reflect.set(r.findings[0]!, "relationshipValidation", { status: "human_validated" }); },
    (r: ReturnType<typeof m14Research>) => { r.findings[0]!.evidence[0]!.materialRef = "other.document"; },
  ]) {
    const h = await harness(), output = m14Research(); mutate(output); h.provider(async () => output);
    const result = await h.service.research(h.input); assert.ok(result.outcome === "error", JSON.stringify(result));
    assert.equal(result.reason, "invalid_proposal"); assert.equal(h.counts().persistCalls, 0);
  }
});

test("M14 existing knowledge/evidence and unrelated targets are preserved", async () => {
  const h = await harness(), result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const base = JSON.parse(h.pair.canonical.snapshotJson), proposed = JSON.parse(result.candidate.candidate.snapshotJson);
  assert.deepEqual(proposed.knowledge, base.knowledge); assert.deepEqual(proposed.identity, base.identity);
  for (const key of ["claims", "evidence", "sources", "conflicts"]) assert.deepEqual(proposed.evidenceRegistry[key].slice(0, base.evidenceRegistry[key].length), base.evidenceRegistry[key]);
  assert.deepEqual(proposed.evidenceRegistry.claims.at(-1).requirementEvidenceTargetRefs, [h.input.evidenceRequest.target]);
});

test("M14 can initialize only the exact unknown slot, validated by S1", async () => {
  const profile = m14Profile(), value = profile.knowledge.semanticSystems.possession;
  assert.ok(value.state === "known"); profile.knowledge.semanticSystems.possession = { state: "unknown" };
  const h = await harness(profile), output = m14Research();
  output.knowledgeAddition = { subject: m13Targets[0]!.subjectRef, value: value.value, findingRefs: ["finding.one"] };
  output.findings[0]!.knowledgeChanges = m14Changes(value.value);
  h.provider(async () => output); const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const proposed = JSON.parse(result.candidate.candidate.snapshotJson); assert.deepEqual(proposed.knowledge.semanticSystems.possession, value);
  assert.equal(JSON.parse(h.pair.canonical.snapshotJson).knowledge.semanticSystems.possession.state, "unknown");
  output.knowledgeAddition.value = { malformed: true };
  const failed = await h.service.research(h.input); assert.ok(failed.outcome === "error"); assert.equal(failed.reason, "invalid_proposal");
  assert.equal(h.records.length, 1);
});

test("M14 does not overwrite existing knowledge or create empty evidence for unknown subjects", async () => {
  const h = await harness(), output = m14Research();
  output.knowledgeAddition = { subject: m13Targets[0]!.subjectRef, value: {}, findingRefs: ["finding.one"] };
  h.provider(async () => output); const result = await h.service.research(h.input);
  assert.ok(result.outcome === "error"); assert.equal(result.reason, "invalid_proposal");
  const unknown = m14Profile(); unknown.knowledge.semanticSystems.possession = { state: "unknown" };
  const other = await harness(unknown); const unresolved = await other.service.research(other.input);
  assert.ok(unresolved.outcome === "gap_unresolved"); assert.equal(unresolved.reason, "target_not_addressed");
  assert.equal(other.records.length, 0);
});

test("M14 conflicting findings remain explicitly unresolved and visible in candidate/S2", async () => {
  const h = await harness(), output = m14Research(), second = structuredClone(output.findings[0]!);
  second.findingId = "finding.two"; second.claimId = "research.opposite"; second.statement = "Conflicting synthetic claim";
  second.evidence[0]!.evidenceId = "research.opposite.evidence"; output.findings.push(second);
  output.conflicts = [{ conflictId: "research.conflict", claimRefs: ["research.claim", "research.opposite"], requirementEvidenceTargetRefs: [m13Input().target],
    conflictType: "contradiction", resolutionStatus: "unresolved", notes: "Sources disagree; human review required" }];
  h.provider(async () => output); const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  assert.deepEqual(JSON.parse(result.candidate.candidate.snapshotJson).evidenceRegistry.conflicts, output.conflicts);
  assert.ok(result.preview.gaps.some((gap) => gap.reason === "open_conflict"));
  assert.equal(canConsumeRequirementEvidenceDurably(result.preview), false);
});

test("M14 fixed output gives deterministic pure proposal and idempotent candidate retry", async () => {
  const h = await harness(); const before = structuredClone(h.input), output = m14Research(), outputBefore = structuredClone(output);
  const gap = await new TargetEvidenceResolverV2(h.grounding).resolve(h.input.evidenceRequest); assert.ok(gap.outcome === "gap");
  const base = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  assert.deepEqual(buildProfileResearchProposalV2(h.input, gap, base, output), buildProfileResearchProposalV2(h.input, gap, base, output));
  const first = await h.service.research(h.input), second = await h.service.research(h.input);
  assert.deepEqual(first, second); assert.equal(h.records.length, 1); assert.equal(h.counts().providerCalls, 2);
  assert.deepEqual(output, outputBefore); assert.deepEqual(h.input, before);
  h.reviewed(); assert.equal((await h.service.research(h.input)).outcome, "not_researchable");
});

test("M14 changing run context changes candidate identity without global idempotency", async () => {
  const h = await harness(); const first = await h.service.research(h.input); h.input.research.runRef = "test.other.run";
  const second = await h.service.research(h.input); assert.ok(first.outcome === "proposal_created" && second.outcome === "proposal_created");
  assert.notEqual(first.candidate.candidate.candidateSha256, second.candidate.candidate.candidateSha256); assert.equal(h.records.length, 2);
});

test("M14 caller/provider mutations cannot alter the pinned context", async () => {
  const h = await harness(); h.provider(async (context) => {
    h.input.research.proposedVersion = "9.0.0"; context.input.evidenceRequest.userId = "other";
    context.baseProfile.identity.profileId = "other"; context.gap.reason = "evidence_partial"; return m14Research();
  });
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  assert.equal(result.candidate.candidate.snapshot.version, "2.0.0"); assert.equal(result.candidate.profileId, h.pair.canonical.profileId);
});

test("M14 S1-normalized knowledge and provenance are detached from provider-owned values", async () => {
  const profile = m14Profile(), known = profile.knowledge.semanticSystems.possession;
  assert.ok(known.state === "known"); profile.knowledge.semanticSystems.possession = { state: "unknown" };
  const h = await harness(profile), raw = m14Research();
  raw.knowledgeAddition = { subject: m13Targets[0]!.subjectRef, value: known.value, findingRefs: ["finding.one"] };
  raw.findings[0]!.knowledgeChanges = m14Changes(known.value);
  let reads = 0;
  const grounding = { getRegistryForCanonical: async (...args: Parameters<typeof h.grounding.getRegistryForCanonical>) => {
    if (++reads === 2) known.value.description = "Provider changed its retained object during post-research IO";
    return h.grounding.getRegistryForCanonical(...args);
  } };
  const result = await new ControlledProfileResearchV2({ research: async () => raw }, grounding, h.candidates).research(h.input);
  assert.ok(result.outcome === "proposal_created");
  const value = result.proposal.research.knowledgeAddition!.value as { description: string };
  assert.equal(value.description, "Synthetic possession feature");
  assert.deepEqual(value, JSON.parse(result.candidate.candidate.snapshotJson).knowledge.semanticSystems.possession.value);
});

test("M14 rechecks ownership after research and never persists revoked context", async () => {
  const h = await harness(); h.provider(async () => { h.readError(new RegistryGroundingErrorV2("registry_not_found")); return m14Research(); });
  const result = await h.service.research(h.input); assert.ok(result.outcome === "error"); assert.equal(result.reason, "registry_not_found"); assert.equal(h.records.length, 0);
});

test("M14 concurrent promotion during research or final write never rebases", async () => {
  for (const finalWrite of [false, true]) {
    const h = await harness();
    if (finalWrite) h.beforePersist(h.promote); else h.provider(async () => { h.promote(); return m14Research(); });
    const result = await h.service.research(h.input); assert.ok(result.outcome === "error"); assert.equal(result.reason, "stale_parent"); assert.equal(h.records.length, 0);
  }
});

test("M14 historical A is refused before research; a B resolving the gap is not researched", async () => {
  const h = await harness(); h.promote();
  const old = await h.service.research(h.input); assert.ok(old.outcome === "error"); assert.equal(old.reason, "stale_parent");
  const pairB = m14Context(m13Profile());
  const serviceB = new ControlledProfileResearchV2({ research: async () => { assert.fail("Authorized B must not research"); } }, { getRegistryForCanonical: async () => pairB }, h.candidates);
  assert.equal((await serviceB.research(h.input)).outcome, "not_researchable"); assert.equal(h.counts().providerCalls, 0);
});

test("M14 persistence error is explicit, never a durable proposal success", async () => {
  const h = await harness(); h.persistError(new Error("connection unavailable"));
  assert.deepEqual(await h.service.research(h.input), { outcome: "error", reason: "infrastructure_failure", stage: "persistence" }); assert.equal(h.records.length, 0);
});

test("M14 exposes only official candidate writes, no review decisions/legacy/SQL/M4/PDF/routes", async () => {
  const files = ["contracts-v2.ts", "proposal-v2.ts", "controlled-research-v2.ts", "scoped-knowledge-v2.ts"];
  const source = (await Promise.all(files.map((file) => readFile(new URL(`../src/languages/profile-research/${file}`, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /recordReviewDecision\(|reviewProfileCandidateV2\(|createRegistry\(|getDb|drizzle|sql`|INSERT |UPDATE |DELETE |"ACCEPT"|"REJECT"|\.\/service\.js|\.\/researcher\.js|adaptation-plan|register.*Routes|\bpdf\b|\bocr\b/iu);
  assert.match(source, /createProfileReviewCandidateV2\(/u); assert.match(source, /\.persistReviewCandidate\(/u);
  const pair = m14Context(), request = await m14Input(pair), gap = await new TargetEvidenceResolverV2({ getRegistryForCanonical: async () => pair }).resolve(request.evidenceRequest);
  assert.ok(gap.outcome === "gap"); assert.equal(classifyM14GapV2(gap).kind, "researchable_gap"); assert.deepEqual(m14GapReferenceV2(gap), request.gap);
});

async function retarget(h: Awaited<ReturnType<typeof harness>>, domain: ControlledResearchInputV2["evidenceRequest"]["requirement"]["domain"], targetId: string) {
  h.input.evidenceRequest.requirement.domain = domain;
  h.input.evidenceRequest.target.targetId = targetId;
  const gap = await new TargetEvidenceResolverV2(h.grounding).resolve(h.input.evidenceRequest);
  assert.ok(gap.outcome === "gap"); h.input.gap = m14GapReferenceV2(gap);
}

async function ageApplicabilityCandidate(twoFindings = false) {
  const { profile, output } = m14AgeApplicabilityFixture(), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  if (twoFindings) {
    const second = structuredClone(output.findings[0]!);
    second.findingId = "finding.two"; second.claimId = "research.claim.two";
    second.evidence[0]!.evidenceId = "research.evidence.two";
    second.knowledgeChanges = [{ changeId: "audit.age.condition.two", path: ["mechanisms", 0, "conditions", 1], value: "legitimate second age condition" }];
    output.findings.push(second);
  }
  h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  return { h, output, result, parent: languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson)) };
}

test("Fix 6 producer and lifecycle share exact S2 target applicability", async () => {
  const legitimate = await ageApplicabilityCandidate();
  assert.ok(validateProfileReviewCandidateV2(legitimate.result.candidate.candidate, legitimate.parent).ok);
  assert.equal(decodeProfileHistoryV2(legitimate.parent.identity.profileId,
    m14HistoryRows(legitimate.parent, legitimate.result.candidate.candidate)).length, 4);

  const { profile, output } = m14AgeApplicabilityFixture("test.m14.producer.parity"), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  const finding = output.findings[0]!;
  finding.subjectRefs = [{ kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.foreign" }];
  finding.knowledgeChanges = [{ changeId: "audit.foreign.condition", path: ["mechanisms", 1, "conditions", 0], value: "UNRELATED action condition" }];
  h.provider(async () => output);
  const rejected = await h.service.research(h.input);
  assert.ok(rejected.outcome === "gap_unresolved"); assert.equal(rejected.reason, "target_not_addressed");
  assert.equal(h.records.length, 0);
});

test("Fix 6 hash-valid same-slot foreign mechanism is rejected by every lifecycle boundary", async () => {
  const { result, parent } = await ageApplicabilityCandidate();
  const artifact = m14MoveAgeFindingToForeignMechanism(result.candidate.candidate, parent);
  assert.ok(!artifact.construction.ok); assert.equal(artifact.construction.code, "lineage_mismatch");
  assert.equal(artifact.candidate.candidateSha256, profileCandidateContextShaV2(artifact.candidate));
  assert.equal(artifact.candidate.snapshot.contentSha256, createHash("sha256").update(artifact.candidate.snapshotJson).digest("hex"));
  const checked = validateProfileReviewCandidateV2(artifact.candidate, parent);
  assert.ok(!checked.ok); assert.equal(checked.code, "lineage_mismatch");
  const review = reviewProfileCandidateV2(artifact.candidate, lifecycleDecision(artifact.candidate), parent);
  assert.ok(!review.ok); assert.equal(review.code, "lineage_mismatch");
  assert.throws(() => decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, artifact.candidate)),
    (error) => error instanceof ProfileLifecycleStoreError && error.code === "storage_integrity");
});

test("Fix 6 rejects one inapplicable finding among two independent of finding order", async () => {
  const { result, parent } = await ageApplicabilityCandidate(true);
  for (const reverse of [false, true]) {
    const artifact = m14MoveAgeFindingToForeignMechanism(result.candidate.candidate, parent, 1, reverse);
    assert.ok(!artifact.construction.ok); assert.equal(validateProfileReviewCandidateV2(artifact.candidate, parent).ok, false);
  }
});

test("Fix 6 allows the same foreign mechanism change for its valid action target", async () => {
  const { profile, output } = m14AgeApplicabilityFixture("test.m14.correct.target"), h = await harness(profile);
  await retarget(h, "action.basic_pattern", "action.basic_pattern.verbalSystem.tense");
  const finding = output.findings[0]!;
  finding.target = h.input.evidenceRequest.target;
  finding.subjectRefs = [{ kind: "feature", slot: "verbalSystem.tense", featureId: "audit.tense" }];
  finding.knowledgeChanges = [{ changeId: "audit.foreign.action", path: ["mechanisms", 1, "conditions", 0], value: "legitimate action condition" }];
  h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  assert.ok(validateProfileReviewCandidateV2(result.candidate.candidate, parent).ok);
});

function rejectsFix7Envelope(artifact: ReturnType<typeof m14SemanticEnvelope>, parent: ReturnType<typeof m14Profile>) {
  const c = artifact.candidate;
  assert.equal(c.snapshot.contentSha256, createHash("sha256").update(c.snapshotJson).digest("hex"));
  assert.equal(c.candidateSha256, profileCandidateContextShaV2(c));
  assert.ok(!artifact.construction.ok); assert.equal(artifact.construction.code, "lineage_mismatch");
  const checked = validateProfileReviewCandidateV2(c, parent);
  assert.ok(!checked.ok); assert.equal(checked.code, "lineage_mismatch");
  const reviewed = reviewProfileCandidateV2(c, lifecycleDecision(c), parent);
  assert.ok(!reviewed.ok); assert.equal(reviewed.code, "lineage_mismatch");
  assert.throws(() => decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, c)),
    (error) => error instanceof ProfileLifecycleStoreError && error.code === "storage_integrity");
}

for (const subjects of ["both", "reversed", "broad"] as const) {
  test(`Fix 7 rejects ${subjects} subjects laundering a foreign mechanism on every lifecycle boundary`, async () => {
    const { result, parent } = await ageApplicabilityCandidate();
    rejectsFix7Envelope(m14MixedSubjectForeignMechanism(result.candidate.candidate, parent, subjects), parent);

    const { profile, output } = m14AgeApplicabilityFixture(`test.m14.fix7.producer.${subjects}`), h = await harness(profile);
    await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
    const finding = output.findings[0]!;
    const age = structuredClone(finding.subjectRefs[0]!);
    const foreign = { ...age, mechanismId: "audit.foreign" } as typeof age;
    finding.subjectRefs = subjects === "both" ? [age, foreign] : subjects === "reversed" ? [foreign, age] :
      [age, { kind: "feature", slot: "verbalSystem.tense", featureId: "audit.tense" }];
    finding.knowledgeChanges = [{ changeId: "audit.foreign.condition", path: ["mechanisms", 1, "conditions", 0],
      value: "UNRELATED action condition" }];
    h.provider(async () => output);
    const rejected = await h.service.research(h.input);
    assert.ok(rejected.outcome === "gap_unresolved"); assert.equal(rejected.reason, "target_not_addressed");
    assert.equal(h.records.length, 0);
  });
}

test("Fix 7 permits contextual foreign subject only when the actual change addresses age", async () => {
  const { profile, output } = m14AgeApplicabilityFixture("test.m14.fix7.context"), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  output.findings[0]!.subjectRefs.push({ kind: "feature_mechanism", slot: "verbalSystem.tense",
    featureId: "audit.tense", mechanismId: "audit.foreign" });
  h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  assert.ok(validateProfileReviewCandidateV2(result.candidate.candidate, parent).ok);
});

for (const changed of ["first", "second"] as const) {
  test(`Fix 7 permits a multi-subject finding changing the ${changed} applicable mechanism`, async () => {
    const { profile, output } = m14AgeApplicabilityFixture(`test.m14.fix7.multi.${changed}`);
    const tense = profile.knowledge.verbalSystem.tense; assert.ok(tense.state === "known");
    tense.value.mechanisms.push({ ...structuredClone(tense.value.mechanisms[0]!), mechanismId: "audit.age.two", conditions: [] });
    const h = await harness(profile); await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
    const finding = output.findings[0]!;
    finding.subjectRefs.push({ kind: "feature_mechanism", slot: "verbalSystem.tense",
      featureId: "audit.tense", mechanismId: "audit.age.two" });
    finding.knowledgeChanges![0]!.path[1] = changed === "first" ? 0 : 2;
    h.provider(async () => output);
    const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
    const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
    assert.ok(validateProfileReviewCandidateV2(result.candidate.candidate, parent).ok);
    assert.equal(decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, result.candidate.candidate)).length, 4);
  });
}

test("Fix 7 rejects a mixed finding when one of two concrete changes is foreign", async () => {
  const { profile, output } = m14AgeApplicabilityFixture("test.m14.fix7.two-changes"), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  const finding = output.findings[0]!;
  finding.subjectRefs.push({ kind: "feature_mechanism", slot: "verbalSystem.tense",
    featureId: "audit.tense", mechanismId: "audit.foreign" });
  finding.knowledgeChanges!.push({ changeId: "audit.foreign.extra", path: ["mechanisms", 1, "conditions", 0], value: "foreign" });
  h.provider(async () => output);
  const rejected = await h.service.research(h.input);
  assert.ok(rejected.outcome === "gap_unresolved"); assert.equal(rejected.reason, "target_not_addressed");
  assert.equal(h.records.length, 0);
});

test("Fix 7 rejects a hash-valid candidate with one age change and one foreign change", async () => {
  const { result, parent } = await ageApplicabilityCandidate();
  const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile, provenance }) => {
    const tense = profile.knowledge.verbalSystem.tense; assert.ok(tense.state === "known");
    tense.value.mechanisms[1]!.conditions.push("UNRELATED action condition");
    profile.evidenceRegistry.claims.at(-1)!.subjectRefs.push({ kind: "feature_mechanism", slot: "verbalSystem.tense",
      featureId: "audit.tense", mechanismId: "audit.foreign" });
    provenance.findings[0]!.knowledgeChanges.push({ changeId: "audit.foreign.second", slot: "verbalSystem.tense",
      path: ["mechanisms", 1, "conditions", 0], subject: { kind: "feature_mechanism", slot: "verbalSystem.tense",
        featureId: "audit.tense", mechanismId: "audit.foreign" } });
    provenance.sharedSlotEffects = researchSharedSlotEffectsV2(parent, profile.knowledge, profile.version,
      provenance.gap.requirement, provenance.gap.target, provenance.gap.options);
  });
  rejectsFix7Envelope(artifact, parent);
});

test("Fix 7 producer rejects a mixed foreign change in the second finding", async () => {
  const { profile, output } = m14AgeApplicabilityFixture("test.m14.fix7.two-findings"), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  const second = structuredClone(output.findings[0]!);
  second.findingId = "finding.two"; second.claimId = "research.claim.two";
  second.evidence[0]!.evidenceId = "research.evidence.two";
  second.subjectRefs.push({ kind: "feature_mechanism", slot: "verbalSystem.tense",
    featureId: "audit.tense", mechanismId: "audit.foreign" });
  second.knowledgeChanges = [{ changeId: "audit.foreign.second", path: ["mechanisms", 1, "conditions", 0],
    value: "UNRELATED action condition" }];
  output.findings.push(second); h.provider(async () => output);
  const rejected = await h.service.research(h.input);
  assert.ok(rejected.outcome === "gap_unresolved"); assert.equal(rejected.reason, "target_not_addressed");
  assert.equal(h.records.length, 0);
});

test("Fix 7 permits feature initialization but rejects a second unrelated mechanism", async () => {
  const { profile, output, value } = ageFixture(), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  const extra = { ...structuredClone(value.mechanisms[0]!), mechanismId: "audit.foreign", relevance: [] };
  const blob = { ...structuredClone(value), mechanisms: [...value.mechanisms, extra] };
  output.findings[0]!.knowledgeChanges = m14Changes(blob);
  output.knowledgeAddition!.value = structuredClone(blob);
  h.provider(async () => output);
  const rejected = await h.service.research(h.input);
  assert.ok(rejected.outcome === "gap_unresolved"); assert.equal(rejected.reason, "target_not_addressed");
  assert.equal(h.records.length, 0);
});

test("Fix 7 rejects one mixed foreign change among two findings regardless of order", async () => {
  const { result, parent } = await ageApplicabilityCandidate(true);
  for (const reverse of [false, true]) {
    rejectsFix7Envelope(m14MixedSubjectForeignMechanism(result.candidate.candidate, parent, "both", 1, reverse), parent);
  }
});

test("Fix 7 uses mechanism ID after reordering the parent mechanisms", async () => {
  const { profile, output } = m14AgeApplicabilityFixture("test.m14.fix7.order");
  const tense = profile.knowledge.verbalSystem.tense; assert.ok(tense.state === "known");
  tense.value.mechanisms.reverse(); output.findings[0]!.knowledgeChanges![0]!.path[1] = 1;
  const h = await harness(profile); await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
});
function ageFixture() {
  const profile = m14Profile();
  const targetY = { catalogVersion: "1.0.0" as const, targetId: "action.basic_pattern.verbalSystem.tense" };
  profile.evidenceRegistry.claims.push({ ...structuredClone(profile.evidenceRegistry.claims[0]!), claimId: "audit.claim.y",
    subjectRefs: [{ kind: "slot", slot: "verbalSystem.tense" }], requirementEvidenceTargetRefs: [targetY] });
  const value = { featureId: "audit.tense", description: "A supported age fact", applicability: "common" as const,
    values: ["supported age value"], mechanisms: [{ mechanismId: "audit.age", role: "Express age", applicability: "common" as const,
      conditions: [], variation: "none_known" as const, relevance: ["age_realization" as const] }],
    conditions: [], variation: "none_known" as const, relevance: [] };
  const output = m14Research(), finding = output.findings[0]!;
  finding.target.targetId = "age.basic_expression.verbalSystem.tense";
  finding.subjectRefs = [{ kind: "feature", slot: "verbalSystem.tense", featureId: value.featureId },
    { kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: value.featureId, mechanismId: "audit.age" }];
  finding.knowledgeChanges = m14Changes(value);
  output.knowledgeAddition = { subject: { kind: "slot", slot: "verbalSystem.tense" }, value: structuredClone(value), findingRefs: [finding.findingId] };
  return { profile, output, value, targetY };
}
const actionStatus = (profile: unknown) => resolveRequirementEvidence({ requirementRef: "test.requirement", domain: "action.basic_pattern" }, profile,
  { mode: "preview" }).groups.flatMap((group) => group.targets).find((target) => target.targetId === "action.basic_pattern.verbalSystem.tense")!.status;

for (const extra of ["mechanism", "value", "full-slot", "original-probe"] as const) {
  test(`M14 rejects ${extra} without a finding; original X/Y contamination cannot create a candidate`, async () => {
    const { profile, output, value } = ageFixture(), h = await harness(profile);
    await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
    const blob = structuredClone(value);
    if (extra !== "value") blob.mechanisms.push({ ...value.mechanisms[0]!, mechanismId: "audit.unrelated", role: "Unrelated tense fact", relevance: [] });
    if (extra !== "mechanism") blob.values.push("UNRELATED tense value with no finding");
    output.knowledgeAddition!.value = blob;
    if (extra === "original-probe") {
      // Exact original wire shape: one mechanism finding plus a whole slot blob.
      output.findings[0]!.subjectRefs = [{ kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.age" }];
      delete output.findings[0]!.knowledgeChanges;
    }
    const contaminated = structuredClone(profile); contaminated.knowledge.verbalSystem.tense = { state: "known", value: blob };
    assert.equal(actionStatus(profile), "missing"); assert.equal(actionStatus(contaminated), "covered");
    h.provider(async () => output);
    const result = await h.service.research(h.input);
    assert.ok(result.outcome === "error", JSON.stringify(result)); assert.equal(result.reason, "invalid_proposal");
    assert.match(result.issues!.join(" "), /Overbroad/u); assert.equal(h.counts().persistCalls, 0); assert.equal(h.records.length, 0);
    assert.equal(actionStatus(JSON.parse(h.pair.canonical.snapshotJson)), "missing");
  });
}

test("M14 explicitly reports legitimate shared-slot effect from the SAME fully supported fact", async () => {
  const { profile, output, value, targetY } = ageFixture(), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense"); h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const candidate = JSON.parse(result.candidate.candidate.snapshotJson);
  assert.deepEqual(candidate.knowledge.verbalSystem.tense.value, value); assert.equal(actionStatus(candidate), "covered");
  assert.deepEqual(result.proposal.sharedSlotEffects.find((effect) => effect.targetId === targetY.targetId),
    { domain: "action.basic_pattern", targetId: targetY.targetId, before: "missing", after: "covered" });
  assert.deepEqual(candidate.knowledge.semanticSystems, profile.knowledge.semanticSystems);
  assert.deepEqual(candidate.evidenceRegistry.claims.find((claim: { claimId: string }) => claim.claimId === "audit.claim.y"), profile.evidenceRegistry.claims.at(-1));
  assert.equal(actionStatus(profile), "missing");
});

test("M14 two findings authorize two appended values, preserve canonical arrays and merge deterministically", async () => {
  const h = await harness(), output = m14Research(), second = structuredClone(output.findings[0]!);
  output.findings[0]!.knowledgeChanges = [{ changeId: "change.a", path: ["values", 1], value: "supported A" }];
  second.findingId = "finding.two"; second.claimId = "research.claim.two"; second.evidence[0]!.evidenceId = "research.evidence.two";
  second.knowledgeChanges = [{ changeId: "change.b", path: ["values", 2], value: "supported B" }]; output.findings.push(second);
  h.provider(async () => output);
  const before = structuredClone(h.pair), result = await h.service.research(h.input), retry = await h.service.research(h.input);
  assert.ok(result.outcome === "proposal_created"); assert.deepEqual(retry, result);
  const proposed = JSON.parse(result.candidate.candidate.snapshotJson), base = JSON.parse(h.pair.canonical.snapshotJson);
  assert.deepEqual(proposed.knowledge.semanticSystems.possession.value.values, ["synthetic", "supported A", "supported B"]);
  proposed.knowledge.semanticSystems.possession.value.values = base.knowledge.semanticSystems.possession.value.values;
  assert.deepEqual(proposed.knowledge, base.knowledge); assert.deepEqual(h.pair, before);
  const provenance = result.candidate.candidate.lineage.origin.researchProvenance!;
  assert.equal(provenance.findings[0]!.knowledgeChanges[0]!.changeId, "change.a");
  assert.equal(provenance.findings[1]!.knowledgeChanges[0]!.changeId, "change.b");
});

test("M14 rejects a sibling structural system hidden inside a slot assertion", async () => {
  const h = await harness(); await retarget(h, "writing.beginner_system", "writing.beginner_system.writingSystem.scripts");
  const output = m14Research(), script = { scriptId: "test.script.a", name: "A", family: "latin", role: "primary", usage: "Supported", coexistsWith: [] };
  output.findings[0]!.target = h.input.evidenceRequest.target;
  output.findings[0]!.subjectRefs = [{ kind: "slot", slot: "writingSystem.scripts" }, { kind: "structural_item", slot: "writingSystem.scripts", itemId: script.scriptId }];
  output.findings[0]!.knowledgeChanges = m14Changes([script]);
  output.knowledgeAddition = { subject: { kind: "slot", slot: "writingSystem.scripts" }, findingRefs: ["finding.one"], value: [script, { ...script, scriptId: "test.script.extra" }] };
  h.provider(async () => output); const rejected = await h.service.research(h.input);
  assert.ok(rejected.outcome === "error"); assert.match(rejected.issues!.join(" "), /Overbroad/u); assert.equal(h.records.length, 0);
  output.knowledgeAddition.value = [script];
  assert.equal((await h.service.research(h.input)).outcome, "proposal_created");
});

test("M14 rejects full profile reconstruction, broad object changes and ancestor/duplicate paths", async () => {
  for (const changes of [
    [{ changeId: "bad", path: [], value: m14Profile() }],
    [{ changeId: "bad", path: ["values"], value: ["many", "values"] }],
    [{ changeId: "a", path: ["values", 1], value: "A" }, { changeId: "b", path: ["values", 1], value: "B" }],
    [{ changeId: "a", path: ["__proto__", "polluted"], value: "A" }],
    [{ changeId: "a", path: ["values", 0], value: "overwrite" }],
  ]) {
    const h = await harness(), output = m14Research(); Reflect.set(output.findings[0]!, "knowledgeChanges", changes);
    h.provider(async () => output); const result = await h.service.research(h.input);
    assert.ok(result.outcome === "error"); assert.equal(h.counts().persistCalls, 0);
  }
});

test("M14 exact leaf assertions still cannot escape the finding's mechanism subject", async () => {
  const { profile, output } = ageFixture(), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  output.findings[0]!.subjectRefs = [{ kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.age" }];
  h.provider(async () => output); const result = await h.service.research(h.input);
  assert.ok(result.outcome === "error"); assert.match(result.issues!.join(" "), /outside finding/u); assert.equal(h.records.length, 0);
});

test("M14 durable origin contains exact M13, provider and finding/evidence context without response blobs", async () => {
  const h = await harness(), result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const p = result.candidate.candidate.lineage.origin.researchProvenance!;
  assert.deepEqual(p.registry, h.input.gap.provenance); assert.equal(p.registry.binding.canonicalRecordId, h.pair.canonical.id);
  assert.deepEqual(p.gap.requirement, h.input.evidenceRequest.requirement); assert.deepEqual(p.gap.target, h.input.evidenceRequest.target);
  assert.equal(p.gap.resolutionSha256, h.input.gap.resolutionSha256); assert.equal(p.gap.mode, "durable");
  assert.deepEqual(p.gap.effectivePolicy, result.proposal.originalGap.targetEvidence.policy);
  assert.deepEqual(p.provider, m14Research().provenance); assert.equal(p.proposalSha256, result.proposal.proposalSha256);
  assert.deepEqual(p.findings[0]!.evidence, [{ evidenceRef: "research.evidence", sourceRef: "research.source", materialRef: "test.document", extractionRef: "test.extraction" }]);
  assert.equal("originalGap" in p, false); assert.equal("research" in p, false); assert.equal("prompt" in p, false);
});

test("M14 absent material/extraction/provider response refs remain absent through S3A", async () => {
  const h = await harness(), output = m14Research();
  delete output.provenance.responseRef; delete output.findings[0]!.evidence[0]!.materialRef; delete output.findings[0]!.evidence[0]!.extractionRef;
  h.provider(async () => output); const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const p = result.candidate.candidate.lineage.origin.researchProvenance!;
  assert.deepEqual(p.provider, { providerRef: "test.provider" });
  assert.deepEqual(p.findings[0]!.evidence, [{ evidenceRef: "research.evidence", sourceRef: "research.source" }]);
  assert.equal("options" in p.gap, false);
});

async function originFixture() {
  const h = await harness(), result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const candidate = result.candidate.candidate, parent = JSON.parse(h.pair.canonical.snapshotJson);
  const create = (origin: unknown) => createProfileReviewCandidateV2({ profile: JSON.parse(candidate.snapshotJson), proposedVersion: "2.0.0", parentCanonical: parent, origin });
  return { candidate, parent, create };
}
test("S3A historical origin has identical bytes/hashes, no provenance default", async () => {
  const { candidate, parent, create } = await originFixture();
  const { researchProvenance, ...origin } = candidate.lineage.origin, legacy = create(origin); assert.ok(researchProvenance); assert.ok(legacy.ok);
  assert.equal("researchProvenance" in legacy.candidate.lineage.origin, false);
  const oldEnvelope = JSON.stringify({ snapshotJson: legacy.candidate.snapshotJson, snapshot: legacy.candidate.snapshot, lineage: legacy.candidate.lineage });
  assert.equal(legacy.candidate.candidateSha256, createHash("sha256").update(oldEnvelope).digest("hex"));
  const read = validateProfileReviewCandidateV2(JSON.parse(JSON.stringify(legacy.candidate)), parent); assert.ok(read.ok);
  assert.deepEqual(read.candidate, legacy.candidate); assert.equal(read.candidate.snapshot.contentSha256, candidate.snapshot.contentSha256);
});
test("S3A optional M14 provenance participates only in candidate context SHA, deterministically", async () => {
  const { candidate, parent, create } = await originFixture(), first = create(candidate.lineage.origin), repeat = create(candidate.lineage.origin);
  assert.ok(first.ok && repeat.ok); assert.deepEqual(first, repeat);
  const changed = { ...candidate.lineage.origin, researchProvenance: { ...candidate.lineage.origin.researchProvenance!,
    provider: { ...candidate.lineage.origin.researchProvenance!.provider, responseRef: "test.other.response" } } };
  const second = create(changed); assert.ok(second.ok); assert.notEqual(first.candidate.candidateSha256, second.candidate.candidateSha256);
  assert.equal(first.candidate.snapshot.contentSha256, second.candidate.snapshot.contentSha256); assert.equal(first.candidate.snapshotJson, second.candidate.snapshotJson);
  assert.ok(validateProfileReviewCandidateV2(second.candidate, parent).ok);
  assert.equal(first.candidate.snapshot.contentSha256, createHash("sha256").update(first.candidate.snapshotJson).digest("hex"));
});
for (const corrupt of ["version", "shape", "parent", "finding", "hash"] as const) {
  test(`S3A rejects ${corrupt} corruption in M14 origin`, async () => {
    const { candidate, parent, create } = await originFixture(), copy = JSON.parse(JSON.stringify(candidate));
    const p = copy.lineage.origin.researchProvenance;
    if (corrupt === "version") p.version = "99.0.0";
    if (corrupt === "shape") p.findings[0].evidence[0].materialRef = 42;
    if (corrupt === "parent") p.registry.binding.canonicalSha256 = "0".repeat(64);
    if (corrupt === "finding") p.findings[0].claimRef = "missing.claim";
    if (corrupt === "hash") p.provider.responseRef = "tampered.response";
    assert.equal(validateProfileReviewCandidateV2(copy, parent).ok, false);
    if (corrupt !== "hash") assert.equal(create(copy.lineage.origin).ok, false);
  });
}
test("S3A explicit human ACCEPT preserves canonical semantics and keeps research process in candidate lineage", async () => {
  const { candidate, parent } = await originFixture();
  const accepted = reviewProfileCandidateV2(candidate, lifecycleDecision(candidate), parent); assert.ok(accepted.ok && accepted.outcome === "accepted");
  const canonical = JSON.parse(accepted.canonical.snapshotJson), review = JSON.parse(candidate.snapshotJson);
  assert.deepEqual(canonical, { ...review, status: "canonical" });
  assert.equal("researchProvenance" in canonical, false); assert.equal("lineage" in canonical, false);
  assert.ok(accepted.candidate.lineage.origin.researchProvenance);
});

async function deltaFixture() {
  const h = await harness(), output = m14Research();
  output.findings[0]!.knowledgeChanges = [{ changeId: "audit.new.value", path: ["values", 1], value: "new supported fact" }];
  h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  return { candidate: result.candidate.candidate, parent: languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson)) };
}

function rejectsEpistemicEnvelope(artifact: ReturnType<typeof m14SemanticEnvelope>, parent: ReturnType<typeof m14Profile>) {
  assert.ok(!artifact.construction.ok); assert.equal(artifact.construction.code, "lineage_mismatch");
  const c = artifact.candidate;
  assert.equal(c.candidateSha256, profileCandidateContextShaV2(c));
  assert.equal(c.snapshot.contentSha256, createHash("sha256").update(c.snapshotJson).digest("hex"));
  const checked = validateProfileReviewCandidateV2(c, parent);
  assert.ok(!checked.ok); assert.equal(checked.code, "lineage_mismatch");
  const decision = reviewProfileCandidateV2(c, lifecycleDecision(c), parent);
  assert.ok(!decision.ok); assert.equal(decision.code, "lineage_mismatch");
  assert.throws(() => decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, c)),
    (error) => error instanceof ProfileLifecycleStoreError && error.code === "storage_integrity");
}

const fakeHumanValidation = (validatorRef = "audit.fake.reviewer", validatedAt = "2026-09-21T00:00:00Z") =>
  ({ status: "human_validated" as const, validatorRef, validatedAt });

test("Fix 5 legitimate M14 claims remain pending and pass every lifecycle boundary", async () => {
  const { candidate, parent } = await deltaFixture();
  const profile = languageProfileV2Schema.parse(JSON.parse(candidate.snapshotJson));
  const claim = profile.evidenceRegistry.claims.at(-1)!;
  assert.equal(claim.reviewStatus, "needs_review");
  assert.deepEqual(claim.evidenceRefs.map((entry) => entry.relationshipValidation), [{ status: "unvalidated" }]);
  assert.ok(validateProfileReviewCandidateV2(candidate, parent).ok);
  assert.equal(decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, candidate)).length, 4);
});

for (const variant of ["new-claim-reviewed", "new-relation-validated", "fake-validator", "fake-timestamp", "combined"] as const) {
  test(`Fix 5 rejects ${variant} with correct official hashes`, async () => {
    const { candidate, parent } = await deltaFixture();
    const artifact = m14SemanticEnvelope(candidate, parent, ({ profile }) => {
      const claim = profile.evidenceRegistry.claims.at(-1)!;
      if (variant === "new-claim-reviewed" || variant === "combined") claim.reviewStatus = "human_reviewed";
      if (variant !== "new-claim-reviewed") {
        const validator = variant === "fake-validator" ? "audit.another.fake.reviewer" : "audit.fake.reviewer";
        const time = variant === "fake-timestamp" ? "2035-01-02T03:04:05Z" : "2026-09-21T00:00:00Z";
        claim.evidenceRefs[0]!.relationshipValidation = fakeHumanValidation(validator, time);
      }
    });
    rejectsEpistemicEnvelope(artifact, parent);
  });
}

test("Fix 5 blocks the original durable S2 effect before human ACCEPT", async () => {
  const { candidate, parent } = await deltaFixture();
  const artifact = m14SemanticEnvelope(candidate, parent, ({ profile }) => {
    const claim = profile.evidenceRegistry.claims.at(-1)!;
    claim.reviewStatus = "human_reviewed";
    claim.evidenceRefs[0]!.relationshipValidation = fakeHumanValidation();
  });
  const forged = languageProfileV2Schema.parse({ ...JSON.parse(artifact.candidate.snapshotJson), status: "canonical" });
  const provenance = artifact.candidate.lineage.origin.researchProvenance!;
  const dangerous = resolveRequirementEvidence(provenance.gap.requirement, forged, { ...provenance.gap.options, mode: "durable" });
  assert.equal(dangerous.groups.flatMap((group) => group.targets)
    .find((target) => target.targetId === provenance.gap.target.targetId)!.status, "covered");
  assert.equal(canConsumeRequirementEvidenceDurably(dangerous), true, "The forged state would be dangerous if canonical");
  rejectsEpistemicEnvelope(artifact, parent);
  const actual = resolveRequirementEvidence(provenance.gap.requirement, parent, { ...provenance.gap.options, mode: "durable" });
  assert.equal(canConsumeRequirementEvidenceDurably(actual), false);
});

for (const variant of ["claim-status", "relation-status"] as const) {
  test(`Fix 5 rejects historical ${variant} mutation while unchanged history passes`, async () => {
    const { candidate, parent } = await deltaFixture();
    assert.ok(validateProfileReviewCandidateV2(candidate, parent).ok, "Unchanged historical state is valid");
    const artifact = m14SemanticEnvelope(candidate, parent, ({ profile }) => {
      const historical = profile.evidenceRegistry.claims[0]!;
      if (variant === "claim-status") historical.reviewStatus = "human_reviewed";
      else historical.evidenceRefs[0]!.relationshipValidation = fakeHumanValidation();
    });
    rejectsEpistemicEnvelope(artifact, parent);
  });
}

for (const field of ["validatorRef", "validatedAt"] as const) {
  test(`Fix 5 rejects historical ${field} mutation`, async () => {
    const profile = m14Profile();
    profile.evidenceRegistry.claims[0]!.evidenceRefs[0]!.relationshipValidation =
      fakeHumanValidation("test.real.reviewer", "2026-09-20T00:00:00Z");
    const h = await harness(profile), result = await h.service.research(h.input);
    assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
    const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
    assert.ok(validateProfileReviewCandidateV2(result.candidate.candidate, parent).ok);
    const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile: candidateProfile }) => {
      const relation = candidateProfile.evidenceRegistry.claims[0]!.evidenceRefs[0]!.relationshipValidation;
      assert.equal(relation.status, "human_validated");
      if (relation.status === "human_validated") relation[field] = field === "validatorRef" ? "audit.fake.reviewer" : "2035-01-02T03:04:05Z";
    });
    rejectsEpistemicEnvelope(artifact, parent);
  });
}

test("Fix 5 rejects one falsified finding among two", async () => {
  const h = await harness(), output = m14Research(), second = structuredClone(output.findings[0]!);
  second.findingId = "finding.two"; second.claimId = "research.claim.two"; second.evidence[0]!.evidenceId = "research.evidence.two";
  output.findings.push(second); h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile }) => {
    profile.evidenceRegistry.claims.at(-1)!.reviewStatus = "human_reviewed";
  });
  rejectsEpistemicEnvelope(artifact, parent);
});

test("Fix 5 rejects fake validation combined with legitimate shared-slot effects", async () => {
  const { profile, output } = ageFixture(), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense"); h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  assert.ok(result.candidate.candidate.lineage.origin.researchProvenance!.sharedSlotEffects.length > 0);
  const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile: proposed }) => {
    proposed.evidenceRegistry.claims.at(-1)!.evidenceRefs[0]!.relationshipValidation = fakeHumanValidation();
  });
  rejectsEpistemicEnvelope(artifact, parent);
});

test("Fix 5 rejects fake validation combined with a legitimate conflict", async () => {
  const h = await harness(); h.provider(async () => m14ConflictResearch());
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile }) => {
    profile.evidenceRegistry.claims.at(-1)!.reviewStatus = "human_reviewed";
  });
  rejectsEpistemicEnvelope(artifact, parent);
});

for (const variant of ["empty-mapping", "absent-mapping", "old-value", "nonexistent-feature", "wrong-existing-feature", "unmapped-extra",
  "identical-to-parent", "reorder", "replace", "delete", "duplicate", "out-of-range", "invented-shared-effect"] as const) {
  test(`S3A semantic reconciliation rejects ${variant} even with correct official hashes`, async () => {
    const { candidate, parent } = await deltaFixture();
    const falseArtifact = m14SemanticEnvelope(candidate, parent, ({ profile, provenance }) => {
      const finding = provenance.findings[0]!, change = finding.knowledgeChanges[0]!;
      const slot = profile.knowledge.semanticSystems.possession; assert.ok(slot.state === "known");
      if (variant === "empty-mapping") finding.knowledgeChanges = [];
      if (variant === "absent-mapping") Reflect.deleteProperty(finding, "knowledgeChanges");
      if (variant === "old-value") change.path = ["values", 0];
      if (variant === "nonexistent-feature") change.subject = { kind: "feature", slot: "semanticSystems.possession", featureId: "audit.nonexistent.feature" };
      if (variant === "wrong-existing-feature") change.subject = { kind: "feature", slot: "semanticSystems.possession", featureId: "test.possessionPredication" };
      if (variant === "unmapped-extra") slot.value.values.push("unmapped second change");
      if (variant === "identical-to-parent") { slot.value.values.pop(); change.path = ["values", 0]; }
      if (variant === "reorder") slot.value.values.reverse();
      if (variant === "replace") slot.value.values[0] = "replacement";
      if (variant === "delete") slot.value.values.shift();
      if (variant === "duplicate") finding.knowledgeChanges.push(structuredClone(change));
      if (variant === "out-of-range") change.path = ["values", 99];
      if (variant === "invented-shared-effect") provenance.sharedSlotEffects.push({ domain: "action.basic_pattern", targetId: "action.basic_pattern.verbalSystem.tense", before: "missing", after: "covered" });
    });
    assert.equal(falseArtifact.construction.ok, false, variant);
    assert.equal(falseArtifact.candidate.candidateSha256, profileCandidateContextShaV2(falseArtifact.candidate));
    assert.equal(falseArtifact.candidate.snapshot.contentSha256, createHash("sha256").update(falseArtifact.candidate.snapshotJson).digest("hex"));
    const checked = validateProfileReviewCandidateV2(falseArtifact.candidate, parent);
    assert.ok(!checked.ok); assert.notEqual(checked.code, "snapshot_mismatch", "Rejection must be semantic/schema, not a stale hash");
    assert.equal(reviewProfileCandidateV2(falseArtifact.candidate, lifecycleDecision(falseArtifact.candidate), parent).ok, false);
  });
}

test("S3A semantic replay accepts a complete single finding and preserves exact hashes", async () => {
  const { candidate, parent } = await deltaFixture(), valid = m14SemanticEnvelope(candidate, parent, () => {});
  assert.ok(valid.construction.ok); assert.ok(validateProfileReviewCandidateV2(valid.candidate, parent).ok);
  assert.equal(valid.candidate.candidateSha256, candidate.candidateSha256);
  assert.equal(valid.candidate.snapshot.contentSha256, candidate.snapshot.contentSha256);
});

test("S3A rejects an unmapped change to another slot instead of treating shared effects as authority", async () => {
  const { candidate, parent } = await deltaFixture();
  const invalid = m14SemanticEnvelope(candidate, parent, ({ profile }) => { profile.knowledge.writingSystem.direction = { state: "known", value: "rtl" }; });
  assert.equal(invalid.construction.ok, false); assert.equal(validateProfileReviewCandidateV2(invalid.candidate, parent).ok, false);
});

test("S3A recomputes shared-slot effects; false status or unrelated target cannot be sealed", async () => {
  const { profile, output } = ageFixture(), h = await harness(profile);
  await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense"); h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  assert.ok(validateProfileReviewCandidateV2(result.candidate.candidate, parent).ok);
  for (const wrongTarget of [false, true]) {
    const invalid = m14SemanticEnvelope(result.candidate.candidate, parent, ({ provenance }) => {
      const effect = provenance.sharedSlotEffects[0]!;
      if (wrongTarget) { effect.domain = "writing.beginner_system"; effect.targetId = "writing.beginner_system.writingSystem.direction"; }
      else effect.after = "missing";
    });
    assert.equal(invalid.construction.ok, false); assert.equal(validateProfileReviewCandidateV2(invalid.candidate, parent).ok, false);
  }
});

test("S3A two disjoint mechanism findings cannot exchange their durable change mappings", async () => {
  const { profile, output, value } = ageFixture();
  // The feature already exists. Only additions to two distinct mechanisms are new.
  profile.knowledge.verbalSystem.tense = { state: "known", value: { ...value, mechanisms: [
    { ...value.mechanisms[0]!, conditions: [] }, { ...value.mechanisms[0]!, mechanismId: "audit.age.two", conditions: [] },
  ] } };
  const h = await harness(profile); await retarget(h, "age.basic_expression", "age.basic_expression.verbalSystem.tense");
  const first = output.findings[0]!, second = structuredClone(first);
  first.subjectRefs = [{ kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.age" }];
  first.knowledgeChanges = [{ changeId: "mechanism.one", path: ["mechanisms", 0, "conditions", 0], value: "condition one" }];
  second.findingId = "finding.two"; second.claimId = "research.claim.two"; second.evidence[0]!.evidenceId = "research.evidence.two";
  second.subjectRefs = [{ kind: "feature_mechanism", slot: "verbalSystem.tense", featureId: "audit.tense", mechanismId: "audit.age.two" }];
  second.knowledgeChanges = [{ changeId: "mechanism.two", path: ["mechanisms", 1, "conditions", 0], value: "condition two" }];
  output.findings = [first, second]; output.knowledgeAddition = null; h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  const reordered = m14SemanticEnvelope(result.candidate.candidate, parent, ({ provenance }) => { provenance.findings.reverse(); });
  assert.ok(reordered.construction.ok, "Mapping does not depend on finding array order");
  const switched = m14SemanticEnvelope(result.candidate.candidate, parent, ({ provenance }) => {
    const a = provenance.findings[0]!, b = provenance.findings[1]!;
    [a.knowledgeChanges, b.knowledgeChanges] = [b.knowledgeChanges, a.knowledgeChanges];
  });
  assert.equal(switched.construction.ok, false); assert.equal(validateProfileReviewCandidateV2(switched.candidate, parent).ok, false);
});

test("S3A semantic completeness includes evidence-only findings and preserves prior evidence", async () => {
  const h = await harness(), output = m14Research(), second = structuredClone(output.findings[0]!);
  second.findingId = "finding.two"; second.claimId = "claim.two"; second.evidence[0]!.evidenceId = "evidence.two";
  output.findings.push(second); h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  for (const omitFinding of [false, true]) {
    const invalid = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile, provenance }) => {
      if (omitFinding) provenance.findings.pop();
      else profile.evidenceRegistry.evidence[0]!.evidenceSummary = "Rewritten preexisting evidence";
    });
    assert.equal(invalid.construction.ok, false); assert.equal(validateProfileReviewCandidateV2(invalid.candidate, parent).ok, false);
  }
});

function rejectsConflictEnvelope(artifact: ReturnType<typeof m14SemanticEnvelope>, parent: ReturnType<typeof m14Profile>) {
  assert.ok(!artifact.construction.ok); assert.equal(artifact.construction.code, "lineage_mismatch");
  const c = artifact.candidate;
  assert.equal(c.candidateSha256, profileCandidateContextShaV2(c));
  assert.equal(c.snapshot.contentSha256, createHash("sha256").update(c.snapshotJson).digest("hex"));
  const checked = validateProfileReviewCandidateV2(c, parent);
  assert.ok(!checked.ok); assert.equal(checked.code, "lineage_mismatch");
  const decision = reviewProfileCandidateV2(c, lifecycleDecision(c), parent);
  assert.ok(!decision.ok); assert.equal(decision.code, "lineage_mismatch");
  assert.throws(() => decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, c)),
    (error) => error instanceof ProfileLifecycleStoreError && error.code === "storage_integrity");
}

test("Fix 4 original foreign conflict is rejected before ACCEPT can degrade a covered sibling", async () => {
  const { candidate, parent } = await deltaFixture(), before = structuredClone(parent), conflict = m14ForeignConflict(parent);
  const artifact = m14SemanticEnvelope(candidate, parent, ({ profile }) => { profile.evidenceRegistry.conflicts.push(conflict); });
  assert.deepEqual(artifact.candidate.lineage.origin.researchProvenance, candidate.lineage.origin.researchProvenance);
  const targetId = conflict.requirementEvidenceTargetRefs[0]!.targetId;
  const status = (profile: unknown) => resolveRequirementEvidence({ requirementRef: "test.requirement", domain: "possession.basic" }, profile,
    { mode: "preview" }).groups.flatMap((group) => group.targets).find((target) => target.targetId === targetId)!.status;
  assert.equal(status(parent), "covered");
  assert.equal(status(JSON.parse(artifact.candidate.snapshotJson)), "partial", "The forged conflict would affect S2 if admitted");
  rejectsConflictEnvelope(artifact, parent);
  assert.deepEqual(parent, before); assert.equal(status(parent), "covered");
  const h = await harness(), output = m14Research(); output.conflicts = [conflict];
  h.provider(async () => output); const rejected = await h.service.research(h.input);
  assert.ok(rejected.outcome === "error"); assert.match(rejected.issues!.join(" "), /exact-target/u);
});

test("Fix 4 valid two-finding conflict survives producer, lifecycle and durable decoder", async () => {
  const h = await harness(), output = m14ConflictResearch(); h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson)), c = result.candidate.candidate;
  assert.deepEqual(JSON.parse(c.snapshotJson).evidenceRegistry.conflicts, output.conflicts);
  assert.ok(validateProfileReviewCandidateV2(c, parent).ok);
  assert.equal(decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, c)).length, 4);
  assert.ok(reviewProfileCandidateV2(c, lifecycleDecision(c), parent).ok);
  const reordered = m14SemanticEnvelope(c, parent, ({ provenance }) => { provenance.findings.reverse(); });
  assert.ok(reordered.construction.ok, "Conflicts reference claim IDs, never finding array positions");
});

for (const variant of ["wrong-target", "foreign-claim", "no-finding", "resolved", "knowledge-and-conflict"] as const) {
  test(`Fix 4 producer and lifecycle reject ${variant} with valid hashes`, async () => {
    const h = await harness(), output = m14ConflictResearch(); h.provider(async () => output);
    const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
    const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
    const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile, provenance }) => {
      const conflict = profile.evidenceRegistry.conflicts[0]!;
      if (variant === "wrong-target" || variant === "foreign-claim") {
        conflict.claimRefs[1] = parent.evidenceRegistry.claims[0]!.claimId;
        if (variant === "wrong-target") conflict.requirementEvidenceTargetRefs = parent.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs;
      }
      if (variant === "no-finding") Object.assign(conflict, m14ForeignConflict(parent));
      if (variant === "resolved") conflict.resolutionStatus = "resolved_by_evidence";
      if (variant === "knowledge-and-conflict") {
        const slot = profile.knowledge.semanticSystems.possession; assert.ok(slot.state === "known"); slot.value.values.push("proposed fact");
        provenance.findings[0]!.knowledgeChanges = [{ changeId: "conflicted.addition", slot: "semanticSystems.possession", path: ["values", 1],
          subject: { kind: "feature", slot: "semanticSystems.possession", featureId: slot.value.featureId } }];
      }
      Reflect.set(output, "conflicts", profile.evidenceRegistry.conflicts);
    });
    if (variant === "knowledge-and-conflict") output.findings[0]!.knowledgeChanges = [{ changeId: "conflicted.addition", path: ["values", 1], value: "proposed fact" }];
    rejectsConflictEnvelope(artifact, parent);
    const rejected = await h.service.research(h.input);
    if (variant === "knowledge-and-conflict") { assert.ok(rejected.outcome === "gap_unresolved"); assert.equal(rejected.reason, "conflicting_knowledge"); }
    else assert.equal(rejected.outcome, "error");
    assert.equal(h.records.length, 1, "No second candidate from invalid proposal");
  });
}

test("Fix 4 exact-target conflict without any participating finding is rejected", async () => {
  const profile = m14Profile(), old = structuredClone(profile.evidenceRegistry.claims[0]!);
  old.claimId = "old.same.target.a"; old.subjectRefs = [m13Targets[0]!.subjectRef]; old.requirementEvidenceTargetRefs = [m13Input().target]; old.confidence = "low";
  profile.evidenceRegistry.claims.push(old, { ...structuredClone(old), claimId: "old.same.target.b" });
  const h = await harness(profile), output = m14Research(); h.provider(async () => output);
  const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
  const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
  const conflict = { conflictId: "old.only", claimRefs: [old.claimId, "old.same.target.b"], requirementEvidenceTargetRefs: [m13Input().target],
    conflictType: "contradiction" as const, resolutionStatus: "unresolved" as const, notes: "No new finding participates" };
  rejectsConflictEnvelope(m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile }) => { profile.evidenceRegistry.conflicts.push(conflict); }), parent);
  output.conflicts = [conflict]; assert.equal((await h.service.research(h.input)).outcome, "error");
});

for (const variant of ["unchanged", "target", "claims", "status", "meaning", "removed"] as const) {
  test(`Fix 4 historical conflict ${variant} preserves append-only semantics`, async () => {
    const profile = m14Profile(); profile.evidenceRegistry.conflicts.push(m14ForeignConflict(profile));
    const h = await harness(profile), output = m14Research();
    output.findings[0]!.knowledgeChanges = [{ changeId: "legitimate.addition", path: ["values", 1], value: "new supported fact" }];
    h.provider(async () => output); const result = await h.service.research(h.input); assert.ok(result.outcome === "proposal_created");
    const parent = languageProfileV2Schema.parse(JSON.parse(h.pair.canonical.snapshotJson));
    const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile }) => {
      const conflict = profile.evidenceRegistry.conflicts[0]!;
      if (variant === "target") conflict.requirementEvidenceTargetRefs = parent.evidenceRegistry.claims[1]!.requirementEvidenceTargetRefs;
      if (variant === "claims") conflict.claimRefs[1] = output.findings[0]!.claimId;
      if (variant === "status") conflict.resolutionStatus = "resolved_by_evidence";
      if (variant === "meaning") conflict.notes = "Reinterpreted historical conflict";
      if (variant === "removed") profile.evidenceRegistry.conflicts.pop();
    });
    if (variant === "unchanged") {
      assert.ok(artifact.construction.ok); assert.ok(validateProfileReviewCandidateV2(artifact.candidate, parent).ok);
      assert.equal(decodeProfileHistoryV2(parent.identity.profileId, m14HistoryRows(parent, artifact.candidate)).length, 4);
      assert.deepEqual(JSON.parse(artifact.candidate.snapshotJson).evidenceRegistry.conflicts, parent.evidenceRegistry.conflicts);
    } else rejectsConflictEnvelope(artifact, parent);
  });
}
