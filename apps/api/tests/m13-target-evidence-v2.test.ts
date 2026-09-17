import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TargetEvidenceResolverV2, resolveTargetEvidenceV2 } from "../src/languages/resolution/target-evidence-v2.js";
import { RegistryGroundingErrorV2 } from "../src/languages/knowledge/registry-grounding-v2.js";
import { ProfileLifecycleStoreError } from "../src/languages/profile/profile-lifecycle-store-v2.js";
import { canConsumeRequirementEvidenceDurably, resolveRequirementEvidence } from "../src/languages/profile/requirement-evidence.js";
import { m13Context, m13Ids, m13Input, m13Profile, m13Targets } from "./fixtures/m13-target-evidence-v2.js";

// Trusted store port isolates M13/S2 behavior. PostgreSQL tests verify actual
// grounding, hashes, historical identity and ownership; no mocked S2 results.
function harness(profile: unknown = m13Profile()) {
  const pair = m13Context(); pair.canonical.snapshotJson = JSON.stringify(profile);
  const calls: string[][] = [];
  const service = new TargetEvidenceResolverV2({ getRegistryForCanonical: async (...args) => { calls.push(args); return pair; } });
  return { service, calls };
}

test("M13 durable exact target uses official S2 and its guard with exact provenance", async () => {
  const pair = m13Context();
  const service = new TargetEvidenceResolverV2({ getRegistryForCanonical: async () => pair });
  const result = await service.resolve(m13Input()); assert.equal(result.outcome, "authorized");
  assert.ok(result.outcome === "authorized"); assert.equal(result.durableAuthorized, true);
  assert.ok(canConsumeRequirementEvidenceDurably(result.evidence));
  assert.deepEqual(result.evidence, resolveRequirementEvidence(m13Input().requirement, JSON.parse(pair.canonical.snapshotJson)));
  assert.deepEqual(result.provenance.binding, pair.registry.profileBinding);
  assert.equal(result.targetEvidence.targetId, m13Input().target.targetId);
  assert.equal(result.targetEvidence.policy.policyVersion, "1.0.0");
});

test("M13 preview covered is inspectable and never durable authorized", async () => {
  const { service } = harness(); const result = await service.resolve(m13Input("preview"));
  assert.ok(result.outcome === "preview"); assert.equal(result.evidence.status, "covered");
  assert.equal(result.durableAuthorized, false); assert.equal(canConsumeRequirementEvidenceDurably(result.evidence), false);
});

test("M13 partial evidence is a normal gap with the S2 evaluations retained", async () => {
  const profile = m13Profile(); profile.evidenceRegistry.claims.forEach((claim) => { claim.evidenceRefs = claim.evidenceRefs.slice(0, 1); });
  const result = await harness(profile).service.resolve(m13Input());
  assert.ok(result.outcome === "gap"); assert.equal(result.evidence.status, "partial"); assert.equal(result.durableAuthorized, false);
});

test("M13 grounded Registry alone never authorizes missing evidence", async () => {
  const profile = m13Profile(); profile.evidenceRegistry.claims = [];
  const result = await harness(profile).service.resolve(m13Input());
  assert.ok(result.outcome === "gap"); assert.equal(result.reason, "evidence_missing"); assert.equal(result.evidence.status, "missing");
});

test("M13 high historical profileCoverage cannot authorize missing target evidence", async () => {
  const profile = { ...m13Profile(), profileCoverage: [{ section: "semanticSystems", coverageStatus: "complete" }] };
  profile.evidenceRegistry.claims = [];
  const result = await harness(profile).service.resolve(m13Input());
  assert.ok(result.outcome === "gap"); assert.equal(result.durableAuthorized, false);
});

test("M13 valid claim for another subject cannot cover the requested target", async () => {
  const profile = m13Profile(); profile.evidenceRegistry.claims[0]!.subjectRefs = [m13Targets[1]!.subjectRef];
  profile.evidenceRegistry.claims[0]!.requirementEvidenceTargetRefs = [{ catalogVersion: "1.0.0", targetId: m13Targets[1]!.targetId }];
  const result = await harness(profile).service.resolve(m13Input());
  assert.notEqual(result.outcome, "authorized"); assert.equal(result.durableAuthorized, false);
  assert.ok(result.outcome === "gap"); assert.equal(result.targetEvidence.status, "missing");
});

test("M13 uses S2 source independence rather than source counts", async () => {
  const profile = m13Profile(); profile.evidenceRegistry.sources[1]!.independenceKey = structuredClone(profile.evidenceRegistry.sources[0]!.independenceKey);
  const result = await harness(profile).service.resolve(m13Input());
  assert.ok(result.outcome === "gap"); assert.equal(result.durableAuthorized, false);
  assert.ok(result.evidence.gaps.some((gap) => gap.reason === "source_independence_insufficient"));
});

test("M13 retains S2 limit_exceeded despite useful evidence", async () => {
  const result = await harness(m13Profile("test.limit", 13)).service.resolve(m13Input());
  assert.ok(result.outcome === "gap"); assert.equal(result.reason, "limit_exceeded");
  assert.equal(result.targetEvidence.usefulEvidence, true); assert.equal(result.durableAuthorized, false);
});

test("M13 passes policy restrictions through S2 and records the effective policy", async () => {
  const result = await harness().service.resolve({ ...m13Input(), options: { targetPolicies: [
    { targetRef: m13Input().target, policy: { crossCheckedMinimumIndependentSources: 3 } },
  ] } });
  assert.ok(result.outcome === "gap"); assert.equal(result.targetEvidence.policy.crossCheckedMinimumIndependentSources, 3);
  assert.equal(result.targetEvidence.status, "partial");
});

test("M13 never upgrades a covered target when the official requirement guard denies", async () => {
  const profile = m13Profile(); profile.evidenceRegistry.claims.splice(1, 1);
  const result = await harness(profile).service.resolve(m13Input());
  assert.ok(result.outcome === "gap"); assert.equal(result.targetEvidence.status, "covered");
  assert.equal(result.evidence.status, "partial"); assert.equal(result.durableAuthorized, false);
});

test("M13 covered any-group alternative cannot authorize a different missing target", async () => {
  const profile = m13Profile();
  const segmental = profile.knowledge.phonology.segmentalSystem;
  assert.ok(segmental.state === "known"); segmental.value.relevance = ["initial_intelligibility"];
  profile.evidenceRegistry.claims = [{ ...profile.evidenceRegistry.claims[0]!,
    subjectRefs: [{ kind: "feature", slot: "phonology.segmentalSystem", featureId: segmental.value.featureId }],
    requirementEvidenceTargetRefs: [{ catalogVersion: "1.0.0", targetId: "phonology.initial_intelligibility.phonology.segmentalSystem" }],
  }];
  const result = await harness(profile).service.resolve({ ...m13Input(),
    requirement: { requirementRef: "test.phonology", domain: "phonology.initial_intelligibility" },
    target: { catalogVersion: "1.0.0", targetId: "phonology.initial_intelligibility.phonology.stressSystem" },
  });
  assert.ok(result.outcome === "gap"); assert.equal(result.targetEvidence.status, "missing");
  assert.equal(canConsumeRequirementEvidenceDurably(result.evidence), true);
  assert.equal(result.durableAuthorized, false);
});

for (const [label, mutate] of [
  ["missing ancestor", (p: ReturnType<typeof m13Profile>) => { Reflect.deleteProperty(p.knowledge, "semanticSystems"); }],
  ["null ancestor", (p: ReturnType<typeof m13Profile>) => { Reflect.set(p.knowledge, "semanticSystems", null); }],
  ["invalid claim", (p: ReturnType<typeof m13Profile>) => { Reflect.deleteProperty(p.evidenceRegistry.claims[0]!, "subjectRefs"); }],
] as const) {
  test(`M13 ${label} is an error, never a research gap or authorization`, async () => {
    const profile = m13Profile(); mutate(profile);
    const result = await harness(profile).service.resolve(m13Input());
    assert.ok(result.outcome === "error"); assert.equal(result.reason, "evidence_invalid"); assert.equal(result.durableAuthorized, false);
    assert.ok(result.resolution); assert.notEqual(result.resolution.targetEvidence.status, "covered");
  });
}

test("M13 preserves healthy target evaluations when an unrelated sibling breaks global validity", async () => {
  const profile = m13Profile(); Reflect.set(profile.knowledge.predicationSystem, "identityPredication", null);
  const result = await harness(profile).service.resolve(m13Input());
  assert.ok(result.outcome === "error"); assert.ok(result.resolution);
  assert.equal(result.resolution.targetEvidence.status, "covered"); assert.equal(result.durableAuthorized, false);
  assert.ok(result.resolution.targetEvidence.claimEvaluations.every((evaluation) => evaluation.accepted && evaluation.contractGaps.length === 0));
});

test("M13 lets S2 local evaluations decide partially_accepted claim summaries", async () => {
  const profile = m13Profile(); const claims = profile.evidenceRegistry.claims;
  const combined = claims[0]!;
  combined.subjectRefs = claims.flatMap((claim) => claim.subjectRefs);
  combined.requirementEvidenceTargetRefs = claims.flatMap((claim) => claim.requirementEvidenceTargetRefs);
  profile.evidenceRegistry.claims = [combined];
  const result = await harness(profile).service.resolve({ ...m13Input(), options: { targetPolicies: [
    { targetRef: { catalogVersion: "1.0.0", targetId: m13Targets[1]!.targetId }, policy: { crossCheckedMinimumIndependentSources: 3 } },
  ] } });
  assert.ok(result.outcome === "gap"); assert.equal(result.evidence.acceptedClaims[0]!.status, "partially_accepted");
  assert.equal(result.targetEvidence.status, "covered"); assert.equal(result.durableAuthorized, false);
});

for (const reason of ["registry_unbound", "registry_profile_mismatch", "registry_not_found", "canonical_not_found", "storage_integrity"] as const) {
  test(`M13 blocks ${reason} before S2 with no fabricated evidence or provenance`, async () => {
    const service = new TargetEvidenceResolverV2({ getRegistryForCanonical: async () => { throw new RegistryGroundingErrorV2(reason); } });
    const result = await service.resolve(m13Input()); assert.ok(result.outcome === "error");
    assert.equal(result.reason, reason); assert.equal(result.resolution, null); assert.equal(result.durableAuthorized, false);
  });
}

test("M13 canonical reader corruption propagates as structured storage error", async () => {
  const service = new TargetEvidenceResolverV2({ getRegistryForCanonical: async () => { throw new ProfileLifecycleStoreError("storage_integrity"); } });
  const result = await service.resolve(m13Input()); assert.ok(result.outcome === "error"); assert.equal(result.reason, "storage_integrity");
});

test("M13 infrastructure exceptions never become research gaps", async () => {
  const failure = new Error("connection unavailable");
  const service = new TargetEvidenceResolverV2({ getRegistryForCanonical: async () => { throw failure; } });
  await assert.rejects(service.resolve(m13Input()), (error) => error === failure);
});

test("M13 rejects spoofed inputs and wrong targets before any store read", async () => {
  const { service, calls } = harness();
  for (const input of [
    ...["profileCoverage", "languageProfile", "registry", "claims", "evidence", "languageId"].map((key) => ({ ...m13Input(), [key]: {} })),
    { ...m13Input(), target: { catalogVersion: "1.0.0", targetId: "unknown.target" } },
    { ...m13Input(), requirement: { requirementRef: "test.requirement", domain: "writing.beginner_system" } },
    { ...m13Input(), options: { mode: "preview" } },
  ]) {
    const result = await service.resolve(input); assert.ok(result.outcome === "error"); assert.equal(result.reason, "invalid_input");
  }
  assert.equal(calls.length, 0);
  assert.equal((await resolveTargetEvidenceV2({})).outcome, "error");
});

test("M13 forwards ownership and pinned IDs and is deterministic without input mutation", async () => {
  const { service, calls } = harness(); const input = m13Input(), before = structuredClone(input);
  const first = await service.resolve(input), second = await service.resolve(input);
  assert.deepEqual(first, second); assert.deepEqual(input, before);
  assert.deepEqual(calls, Array.from({ length: 2 }, () => [m13Ids.userId, m13Ids.registryRecordId, m13Ids.canonicalRecordId]));
});

test("M13 clones request/policy before awaiting grounding", async () => {
  const input = { ...m13Input(), options: { targetPolicies: [{ targetRef: m13Input().target, policy: { crossCheckedMinimumIndependentSources: 3 } }] } };
  const pair = m13Context();
  const service = new TargetEvidenceResolverV2({ getRegistryForCanonical: async () => {
    input.options.targetPolicies[0]!.policy.crossCheckedMinimumIndependentSources = 2;
    input.target.targetId = m13Targets[1]!.targetId; return pair;
  } });
  const result = await service.resolve(input); assert.ok(result.outcome === "gap");
  assert.equal(result.target.targetId, m13Targets[0]!.targetId); assert.equal(result.targetEvidence.policy.crossCheckedMinimumIndependentSources, 3);
});

test("M13 v2 has no persistence, lifecycle write, research or legacy service dependency", async () => {
  const source = await readFile(new URL("../src/languages/resolution/target-evidence-v2.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createRun|persistReviewCandidate|recordReviewDecision|createRegistry|\.propose\(|getDb|drizzle|profile-research|\.\/service\.js|\.\/repository\.js/u);
  assert.match(source, /Pick<RegistryGroundingStoreV2, "getRegistryForCanonical">/u);
});
