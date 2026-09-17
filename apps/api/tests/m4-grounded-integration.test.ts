import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { compileInitialAdaptationPlan, compileLegacyInitialAdaptationPlan, GroundedAdaptationCompiler } from "../src/languages/adaptation/adaptation-plan.js";
import { RegistryGroundingErrorV2, type RegistryGroundingStoreV2 } from "../src/languages/knowledge/registry-grounding-v2.js";
import { ProfileLifecycleStoreError } from "../src/languages/profile/profile-lifecycle-store-v2.js";
import { createProfileReviewCandidateV2, reviewProfileCandidateV2 } from "../src/languages/profile/profile-lifecycle-v2.js";
import { registryProfileBindingV2Schema } from "../src/languages/decisions/registry-profile-binding-v2.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { groundingProfile } from "./fixtures/registry-grounding-v2.js";
import { lifecycleDecision } from "./fixtures/profile-lifecycle-v2.js";
import { m4Registry } from "./fixtures/m4-grounded.js";

const userId = "00000000-0000-4000-8000-000000000001";
const canonicalRecordId = "00000000-0000-4000-8000-000000000002";
const registryRecordId = "00000000-0000-4000-8000-000000000003";
const input = () => ({ userId, canonicalRecordId, registryRecordId, curriculum: structuredClone(a1U01CurriculumFixture) });
type Context = Awaited<ReturnType<RegistryGroundingStoreV2["getRegistryForCanonical"]>>;
function context(registry = m4Registry()): Context {
  const candidate = createProfileReviewCandidateV2({ profile: groundingProfile(), proposedVersion: "1.0.0", parentCanonical: null, origin: { kind: "manual", originRef: "test.m4" } });
  assert.ok(candidate.ok);
  const outcome = reviewProfileCandidateV2(candidate.candidate, lifecycleDecision(candidate.candidate), null);
  assert.ok(outcome.ok && outcome.outcome === "accepted");
  const snapshot = outcome.canonical.snapshot;
  return {
    canonical: { id: canonicalRecordId, profileId: snapshot.profileId, eventSequence: "3", createdAt: new Date("2026-09-15T00:00:00Z"),
      kind: "canonical", parentCanonicalRecordId: null, candidateRecordId: userId, decisionRecordId: registryRecordId,
      snapshotJson: outcome.canonical.snapshotJson, snapshot },
    registry: { id: registryRecordId, userId, registry, createdAt: new Date("2026-09-15T00:00:00Z"),
      contentSha256: createHash("sha256").update(JSON.stringify(registry)).digest("hex"),
      profileBinding: registryProfileBindingV2Schema.parse({ bindingVersion: "1.0.0", profileId: snapshot.profileId, profileVersion: snapshot.version,
        schemaVersion: snapshot.schemaVersion, contractVersion: snapshot.contractVersion, canonicalRecordId, canonicalSha256: snapshot.contentSha256 }) },
  };
}
function compiler(pair = context()) {
  const calls: string[][] = [];
  const service = new GroundedAdaptationCompiler({ getRegistryForCanonical: async (...args) => { calls.push(args); return pair; } });
  return { service, calls };
}

test("M4 pins exact durable IDs via its only grounding port before compiling", async () => {
  const { service, calls } = compiler(), result = await service.compile(input());
  assert.ok(result.ok); assert.deepEqual(calls, [[userId, registryRecordId, canonicalRecordId]]);
  assert.equal(result.grounding.registryRecordId, registryRecordId);
  assert.equal(result.grounding.binding.canonicalRecordId, canonicalRecordId);
  assert.equal(result.plan.outputs.routeReady, false);
  assert.equal(result.plan.readiness.state, "needs_review");
});
for (const code of ["registry_not_found", "registry_unbound", "registry_profile_mismatch", "canonical_not_found", "storage_integrity"] as const) {
  test(`M4 fails closed without a plan when grounding returns ${code}`, async () => {
    const service = new GroundedAdaptationCompiler({ getRegistryForCanonical: async () => { throw new RegistryGroundingErrorV2(code); } });
    const result = await service.compile(input()); assert.ok(!result.ok);
    assert.equal(result.code, code); assert.equal(result.plan, null); assert.equal(result.validation.valid, false);
    assert.equal("grounding" in result, false);
  });
}
test("M4 preserves S3B storage-integrity failure and propagates infrastructure errors", async () => {
  const corrupt = new GroundedAdaptationCompiler({ getRegistryForCanonical: async () => { throw new ProfileLifecycleStoreError("storage_integrity"); } });
  const result = await corrupt.compile(input()); assert.ok(!result.ok); assert.equal(result.code, "storage_integrity");
  const unavailable = new Error("connection unavailable");
  const service = new GroundedAdaptationCompiler({ getRegistryForCanonical: async () => { throw unavailable; } });
  await assert.rejects(service.compile(input()), (e) => e === unavailable);
});
for (const override of ["languageProfile", "registry", "profileCoverage", "profileId", "languageId", "profileVersion", "profileBinding"]) {
  test(`M4 rejects caller ${override} as an alternative authority`, async () => {
    const { service, calls } = compiler();
    const result = await service.compile({ ...input(), [override]: override === "profileCoverage" ? germanLanguageProfileFixture.profileCoverage : "fabricated" });
    assert.ok(!result.ok); assert.equal(result.code, "invalid_input"); assert.deepEqual(calls, []);
  });
}
test("authoritative M4 entry never accepts the old raw profile/Registry signature", async () => {
  const result = await compileInitialAdaptationPlan({ curriculum: a1U01CurriculumFixture, languageProfile: germanLanguageProfileFixture, registry: germanDecisionRegistryFixture });
  assert.ok(!result.ok); assert.equal(result.code, "invalid_input"); assert.equal(result.plan, null);
});
test("M4 validates curriculum before accessing storage and rejects cross-curriculum Registry", async () => {
  const { service, calls } = compiler();
  const result = await service.compile({ ...input(), curriculum: {} }); assert.ok(!result.ok); assert.deepEqual(calls, []);
  const pair = context(); pair.registry.registry.identity.curriculumId = "foreign.curriculum";
  const mismatch = await compiler(pair).service.compile(input()); assert.ok(!mismatch.ok); assert.equal(mismatch.code, "invalid_input");
});
test("M4 grounded reuse, ordering, impacts and research grouping preserve compiler mechanics", async () => {
  const result = await compiler().service.compile(input()); assert.ok(result.ok);
  const legacy = compileLegacyInitialAdaptationPlan({ curriculum: a1U01CurriculumFixture, languageProfile: germanLanguageProfileFixture, registry: germanDecisionRegistryFixture }); assert.ok(legacy.plan);
  assert.deepEqual(result.plan.requirementResolution, legacy.plan.requirementResolution);
  assert.deepEqual(result.plan.decisionChanges, legacy.plan.decisionChanges);
  assert.deepEqual(result.plan.pedagogicalImpactAnalysis, legacy.plan.pedagogicalImpactAnalysis);
  assert.deepEqual(result.plan.readiness, legacy.plan.readiness);
  assert.deepEqual(result.plan.researchPlan.map(t => [t.researchTaskId, t.gapRefs]), legacy.plan.researchPlan.map(t => [t.researchTaskId, t.gapRefs]));
  assert.ok(result.plan.gapAnalysis.every(g => g.gapType === "profile_gap" && g.researchNecessity === "profile_only"));
});
test("M4 grounded empty Registry preserves ten gaps and five deterministic groups", async () => {
  const registry = m4Registry(); registry.decisions = []; registry.dependencyGraph = { nodes: [], edges: [] };
  const result = await compiler(context(registry)).service.compile(input()); assert.ok(result.ok);
  assert.equal(result.plan.gapAnalysis.length, 10); assert.equal(result.plan.researchPlan.length, 5);
  assert.equal(result.plan.decisionChanges.reusedDecisionRefs.length, 0);
});
test("M4 keeps extend distinct from resolve for an approved decision outside scope", async () => {
  const registry = m4Registry(); registry.decisions[0]!.scope = { scopeType: "unit_contextual", unitScope: "A1-U99" };
  const result = await compiler(context(registry)).service.compile(input()); assert.ok(result.ok);
  assert.equal(result.plan.requirementResolution.find(r => r.requirementRef === "AR04")?.resolutionMode, "extend");
  const gap = result.plan.gapAnalysis.find(g => g.requirementRef === "AR04");
  assert.equal(gap?.gapType, "insufficient_scope"); assert.equal(gap?.researchNecessity, "registry_reasoning");
});
test("M4 does not promote provisional decisions merely because Registry is grounded", async () => {
  const registry = m4Registry(); registry.decisions.forEach(d => { d.identity.status = "provisional"; });
  const result = await compiler(context(registry)).service.compile(input()); assert.ok(result.ok);
  assert.equal(result.plan.decisionChanges.reusedDecisionRefs.length, 0); assert.equal(result.plan.gapAnalysis.length, 10);
  assert.equal(result.plan.coverageAudit.status, "not_run");
});
test("M4 output is deterministic, with no S2 authorization inferred from grounded strategies", async () => {
  const pair = context(), before = structuredClone(pair), { service } = compiler(pair);
  assert.deepEqual(await service.compile(input()), await service.compile(input())); assert.deepEqual(pair, before);
  // A successful plan is not a Requirement Evidence result/authorization.
  assert.equal("requirementEvidenceAuthorization" in (await service.compile(input())), false);
  assert.equal(JSON.parse(pair.canonical.snapshotJson).evidenceRegistry.claims.length, 0);
});
test("M4 clones curriculum before the grounding await", async () => {
  const args = input(), pair = context();
  const service = new GroundedAdaptationCompiler({ getRegistryForCanonical: async () => { args.curriculum.adaptationRequirements = []; return pair; } });
  const result = await service.compile(args); assert.ok(result.ok); assert.equal(result.plan.requirementResolution.length, 10);
});
