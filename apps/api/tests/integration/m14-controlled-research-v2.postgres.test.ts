import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../src/db/schema.js";
import { loadMigrationFiles, migratePending } from "../../src/db/migrations.js";
import { createPostgresMigrationDatabase } from "../../src/db/postgres-migration-database.js";
import { RegistryGroundingStoreV2 } from "../../src/languages/knowledge/registry-grounding-v2.js";
import { ProfileLifecycleStoreV2, type ProfileCanonicalRecordV2 } from "../../src/languages/profile/profile-lifecycle-store-v2.js";
import { createProfileReviewCandidateV2 } from "../../src/languages/profile/profile-lifecycle-v2.js";
import { ControlledProfileResearchV2, type ProfileResearchProviderV2 } from "../../src/languages/profile-research/controlled-research-v2.js";
import { m14GapReferenceV2 } from "../../src/languages/profile-research/contracts-v2.js";
import { TargetEvidenceResolverV2 } from "../../src/languages/resolution/target-evidence-v2.js";
import { groundingRegistry } from "../fixtures/registry-grounding-v2.js";
import { lifecycleDecision } from "../fixtures/profile-lifecycle-v2.js";
import { m13Input, m13Profile } from "../fixtures/m13-target-evidence-v2.js";
import { m14AgeApplicabilityFixture, m14Input, m14Profile, m14Research, m14SemanticEnvelope, m14ForeignConflict,
  m14ConflictResearch, m14MoveAgeFindingToForeignMechanism, m14MixedSubjectForeignMechanism } from "../fixtures/m14-controlled-research-v2.js";
import { languageProfileV2Schema } from "../../src/languages/profile/language-profile-v2.js";
import { profileCandidateContextShaV2 } from "../../src/languages/profile/profile-candidate-context-sha-v2.js";

const adminUrl = new URL(process.env.MIGRATION_TEST_DATABASE_URL ?? "postgres://invalid/invalid");
if (process.env.MIGRATION_TEST_ALLOW_LOCAL !== "1" || !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) || adminUrl.pathname !== "/memoos_migration_admin") {
  throw new Error("M14 tests require the disposable local PostgreSQL runner");
}
const admin = postgres(adminUrl.toString(), { max: 1 });
const dbName = `memoos_it_m14_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const localUrl = new URL(adminUrl); localUrl.pathname = `/${dbName}`;
const connection = postgres(localUrl.toString(), { max: 10 });
const queries: string[] = [];
const database = drizzle(connection, { schema, logger: { logQuery: (query) => { queries.push(query); } } });
const grounding = new RegistryGroundingStoreV2(() => database);
const lifecycle = new ProfileLifecycleStoreV2(() => database);
const m13 = new TargetEvidenceResolverV2(grounding);
const userId = randomUUID(), otherUserId = randomUUID();
let serial = 0;
const code = (expected: string) => (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === expected;

before(async () => {
  assert.match(dbName, /^memoos_it_m14_[0-9]+_[a-f0-9]+$/u);
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../drizzle", import.meta.url)));
  const migrationDb = createPostgresMigrationDatabase(localUrl.toString());
  try { await migratePending(migrationDb, migrations); } finally { await migrationDb.close(); }
  await connection`INSERT INTO users (id,username,password_hash) VALUES (${userId},'m14.test','isolated'),(${otherUserId},'m14.other','isolated')`;
});
after(async () => { await connection.end({ timeout: 5 }); await admin.end({ timeout: 5 }); });

async function baseContext(withHistoricalConflict = false, suppliedProfile?: ReturnType<typeof m14Profile>) {
  const profile = suppliedProfile ?? m14Profile(`test.m14.pg.${++serial}`);
  if (withHistoricalConflict) profile.evidenceRegistry.conflicts.push(m14ForeignConflict(profile));
  const created = createProfileReviewCandidateV2({ profile: { ...profile, status: "draft" }, parentCanonical: null, proposedVersion: "1.0.0",
    origin: { kind: "manual", originRef: "test.bootstrap" } });
  assert.ok(created.ok);
  const record = await lifecycle.persistReviewCandidate({ candidate: created.candidate, parentCanonicalRecordId: null });
  const reviewed = await lifecycle.recordReviewDecision(record.id, lifecycleDecision(record.candidate));
  assert.ok(reviewed.canonical);
  const canonical = reviewed.canonical;
  const registry = await grounding.createRegistry({ userId, canonicalRecordId: canonical.id, registry: groundingRegistry("1.0.0", `registry.${profile.identity.profileId}`) });
  const input = await m14Input({ canonical, registry });
  return { canonical, registry, input };
}
async function ageBaseContext(fixture = m14AgeApplicabilityFixture(`test.m14.pg.applicability.${++serial}`)) {
  const context = await baseContext(false, fixture.profile);
  context.input.evidenceRequest.requirement.domain = "age.basic_expression";
  context.input.evidenceRequest.target.targetId = "age.basic_expression.verbalSystem.tense";
  const gap = await m13.resolve(context.input.evidenceRequest); assert.ok(gap.outcome === "gap");
  context.input.gap = m14GapReferenceV2(gap);
  return { ...context, output: fixture.output };
}
async function competingCandidate(parent: ProfileCanonicalRecordV2) {
  const profile = { ...m13Profile(parent.profileId), status: "review" };
  const created = createProfileReviewCandidateV2({ profile, parentCanonical: JSON.parse(parent.snapshotJson), proposedVersion: "3.0.0",
    origin: { kind: "manual", originRef: "test.concurrent.human.revision" } });
  assert.ok(created.ok);
  return lifecycle.persistReviewCandidate({ candidate: created.candidate, parentCanonicalRecordId: parent.id });
}
const service = (provider: ProfileResearchProviderV2 = { research: async () => m14Research() }) => new ControlledProfileResearchV2(provider, grounding, lifecycle);

test("M14 PostgreSQL persists only a review candidate with exact parent, canonical unchanged", async () => {
  const { canonical, input } = await baseContext();
  const beforeHistory = await lifecycle.listProfileHistory(canonical.profileId); queries.length = 0;
  const result = await service().research(input); assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const writes = queries.filter((query) => /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/iu.test(query));
  assert.equal(writes.length, 1); assert.match(writes[0]!, /^INSERT INTO language_profile_v2_candidates/u);
  const candidate = await lifecycle.getReviewCandidate(result.candidate.id); assert.ok(candidate);
  assert.equal(candidate.parentCanonicalRecordId, canonical.id);
  assert.deepEqual(candidate.candidate.lineage.parentCanonical, canonical.snapshot);
  assert.equal(candidate.candidate.snapshot.status, "review"); assert.equal(result.humanReviewRequired, true);
  const proposed = languageProfileV2Schema.parse(JSON.parse(candidate.candidate.snapshotJson));
  const researchClaim = proposed.evidenceRegistry.claims.at(-1)!;
  assert.equal(researchClaim.reviewStatus, "needs_review");
  assert.deepEqual(researchClaim.evidenceRefs.map((entry) => entry.relationshipValidation), [{ status: "unvalidated" }]);
  assert.deepEqual(await lifecycle.getCanonical(canonical.id), canonical);
  assert.deepEqual(await lifecycle.getCurrentCanonical(canonical.profileId), canonical);
  assert.equal(await lifecycle.getReviewDecision(candidate.id), null);
  const history = await lifecycle.listProfileHistory(canonical.profileId);
  assert.deepEqual(history.slice(0, beforeHistory.length), beforeHistory); assert.equal(history.length, beforeHistory.length + 1);
});

test("M14 PostgreSQL ownership and Registry/canonical cross-pairs block before provider", async () => {
  const a = await baseContext(), b = await baseContext(); let calls = 0;
  const subject = service({ research: async () => { calls++; return m14Research(); } });
  for (const patch of [{ userId: otherUserId }, { registryRecordId: b.registry.id }, { canonicalRecordId: b.canonical.id }]) {
    const result = await subject.research({ ...a.input, evidenceRequest: { ...a.input.evidenceRequest, ...patch } });
    assert.ok(result.outcome === "error"); assert.ok(["registry_not_found", "registry_profile_mismatch"].includes(result.reason));
  }
  assert.equal(calls, 0); assert.equal((await lifecycle.listProfileHistory(a.canonical.profileId)).length, 3);
});

test("M14 PostgreSQL identical and concurrent retries reuse the S3B candidate hash", async () => {
  const { canonical, input } = await baseContext();
  const [first, second] = await Promise.all([service().research(input), service().research(input)]);
  assert.ok(first.outcome === "proposal_created" && second.outcome === "proposal_created");
  assert.equal(first.candidate.id, second.candidate.id); assert.equal(first.candidate.candidate.candidateSha256, second.candidate.candidate.candidateSha256);
  const third = await service().research(input); assert.ok(third.outcome === "proposal_created"); assert.equal(third.candidate.id, first.candidate.id);
  assert.equal((await lifecycle.listProfileHistory(canonical.profileId)).filter((entry) => entry.kind === "candidate").length, 2);
  // Human rejection is test setup, never an M14 capability. A retry cannot label
  // this already-reviewed candidate as awaiting its first human decision.
  await lifecycle.recordReviewDecision(first.candidate.id, lifecycleDecision(first.candidate.candidate, "REJECT"));
  const retry = await service().research(input); assert.ok(retry.outcome === "not_researchable"); assert.equal(retry.reason, "candidate_already_reviewed");
  assert.deepEqual(await lifecycle.getCurrentCanonical(canonical.profileId), canonical);
});

test("M14 PostgreSQL promotion during external research aborts; B authorized; historical A stays pinned", async () => {
  const { canonical: a, input } = await baseContext(), competing = await competingCandidate(a);
  let started!: () => void, resume!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const running = service({ research: async () => { started(); await released; return m14Research(); } }).research(input);
  await entered;
  const promoted = await lifecycle.recordReviewDecision(competing.id, lifecycleDecision(competing.candidate)); assert.ok(promoted.canonical);
  resume(); const result = await running; assert.ok(result.outcome === "error"); assert.equal(result.reason, "stale_parent");
  const b = promoted.canonical;
  const rb = await grounding.createRegistry({ userId, canonicalRecordId: b.id, registry: groundingRegistry("2.0.0", `registry.${b.profileId}`) });
  const requestB = { ...m13Input(), userId, canonicalRecordId: b.id, registryRecordId: rb.id };
  assert.equal((await m13.resolve(requestB)).outcome, "authorized");
  const blocked = service({ research: async () => { assert.fail("No research for B or historical A"); } });
  assert.deepEqual(await blocked.research({ ...input, evidenceRequest: requestB }), { outcome: "not_researchable", reason: "no_gap" });
  const historical = await m13.resolve(input.evidenceRequest); assert.ok(historical.outcome === "gap");
  assert.deepEqual(m14GapReferenceV2(historical), input.gap);
  const old = await blocked.research(input); assert.ok(old.outcome === "error"); assert.equal(old.reason, "stale_parent");
  assert.deepEqual(await lifecycle.getCanonical(a.id), a);
  assert.equal((await lifecycle.listProfileHistory(a.profileId)).filter((entry) => entry.kind === "candidate").length, 2);
});

test("M14 PostgreSQL S3B closes the race after M14 current-parent precheck", async () => {
  const { canonical, input } = await baseContext(), competing = await competingCandidate(canonical);
  const candidates = {
    getCurrentCanonical: lifecycle.getCurrentCanonical.bind(lifecycle), getReviewDecision: lifecycle.getReviewDecision.bind(lifecycle),
    persistReviewCandidate: async (request: Parameters<ProfileLifecycleStoreV2["persistReviewCandidate"]>[0]) => {
      await lifecycle.recordReviewDecision(competing.id, lifecycleDecision(competing.candidate));
      return lifecycle.persistReviewCandidate(request);
    },
  };
  const result = await new ControlledProfileResearchV2({ research: async () => m14Research() }, grounding, candidates).research(input);
  assert.ok(result.outcome === "error"); assert.equal(result.reason, "stale_parent"); assert.equal(result.stage, "persistence");
  assert.equal((await lifecycle.listProfileHistory(canonical.profileId)).filter((entry) => entry.kind === "candidate").length, 2);
});

test("M14 PostgreSQL candidate preceding promotion stays historical A and cannot promote on B", async () => {
  const { canonical: a, input } = await baseContext(), competing = await competingCandidate(a);
  const result = await service().research(input); assert.ok(result.outcome === "proposal_created");
  const promotion = await lifecycle.recordReviewDecision(competing.id, lifecycleDecision(competing.candidate)); assert.ok(promotion.canonical);
  const historical = await lifecycle.getReviewCandidate(result.candidate.id); assert.ok(historical);
  assert.equal(historical.parentCanonicalRecordId, a.id); assert.deepEqual(historical.candidate.lineage.parentCanonical, a.snapshot);
  await assert.rejects(lifecycle.recordReviewDecision(historical.id, lifecycleDecision(historical.candidate)), code("stale_parent"));
  assert.deepEqual(await lifecycle.getCurrentCanonical(a.profileId), promotion.canonical);
  assert.equal(await lifecycle.getReviewDecision(historical.id), null);
});

test("M14 PostgreSQL reports candidate ID if promotion wins just after persistence", async () => {
  const { canonical, input } = await baseContext(), competing = await competingCandidate(canonical);
  const candidates = {
    getCurrentCanonical: lifecycle.getCurrentCanonical.bind(lifecycle), getReviewDecision: lifecycle.getReviewDecision.bind(lifecycle),
    persistReviewCandidate: async (request: Parameters<ProfileLifecycleStoreV2["persistReviewCandidate"]>[0]) => {
      const record = await lifecycle.persistReviewCandidate(request);
      await lifecycle.recordReviewDecision(competing.id, lifecycleDecision(competing.candidate)); return record;
    },
  };
  const result = await new ControlledProfileResearchV2({ research: async () => m14Research() }, grounding, candidates).research(input);
  assert.ok(result.outcome === "error"); assert.equal(result.reason, "stale_parent"); assert.ok(result.persistedCandidateRecordId);
  const stored = await lifecycle.getReviewCandidate(result.persistedCandidateRecordId); assert.ok(stored);
  assert.equal(stored.parentCanonicalRecordId, canonical.id); assert.equal(stored.candidate.snapshot.status, "review");
});

test("M14 PostgreSQL invalid or empty research has no persistence", async () => {
  const { canonical, input } = await baseContext();
  const bad = await service({ research: async () => ({ profile: "fabricated" }) }).research(input);
  assert.ok(bad.outcome === "error"); assert.equal(bad.reason, "invalid_proposal");
  const empty = await service({ research: async () => ({ ...m14Research(), findings: [], sources: [] }) }).research(input);
  assert.equal(empty.outcome, "gap_unresolved"); assert.equal((await lifecycle.listProfileHistory(canonical.profileId)).length, 3);
});

test("S3B/M14 PostgreSQL candidate alone recovers research lineage after transient objects leave scope", async () => {
  const { canonical, input } = await baseContext();
  input.evidenceRequest.options = { mode: "durable", targetPolicies: [{ targetRef: input.evidenceRequest.target,
    policy: { crossCheckedMinimumIndependentSources: 3 } }] };
  const gap = await m13.resolve(input.evidenceRequest); assert.ok(gap.outcome === "gap"); input.gap = m14GapReferenceV2(gap);
  // Only the durable ID escapes; provider result and M14 proposal are discarded.
  const id = await (async () => {
    const research = m14Research();
    research.findings[0]!.knowledgeChanges = [{ changeId: "test.append", path: ["values", 1], value: "Supported addition" }];
    const result = await service({ research: async () => research }).research(input);
    assert.ok(result.outcome === "proposal_created", JSON.stringify(result)); return result.candidate.id;
  })();
  const freshStore = new ProfileLifecycleStoreV2(() => database);
  const read = await freshStore.getReviewCandidate(id); assert.ok(read);
  const candidate = read.candidate, p = candidate.lineage.origin.researchProvenance!;
  assert.deepEqual(p.registry, input.gap.provenance);
  assert.equal(p.registry.binding.canonicalRecordId, canonical.id); assert.equal(p.registry.binding.canonicalSha256, canonical.snapshot.contentSha256);
  assert.deepEqual(p.gap.requirement, input.evidenceRequest.requirement); assert.deepEqual(p.gap.target, input.evidenceRequest.target);
  assert.equal(p.gap.mode, "durable"); assert.equal(p.gap.reason, gap.reason); assert.equal(p.gap.resolutionSha256, input.gap.resolutionSha256);
  assert.deepEqual(p.gap.options, input.evidenceRequest.options); assert.deepEqual(p.gap.effectivePolicy, gap.targetEvidence.policy);
  assert.deepEqual(p.provider, { providerRef: "test.provider", responseRef: "test.response" });
  assert.equal(candidate.lineage.origin.originRef, `m14.${p.proposalSha256}`);
  const finding = p.findings[0]!;
  assert.equal(finding.findingRef, "finding.one"); assert.equal(finding.claimRef, "research.claim");
  assert.deepEqual(finding.evidence, [{ evidenceRef: "research.evidence", sourceRef: "research.source", materialRef: "test.document", extractionRef: "test.extraction" }]);
  assert.deepEqual(finding.knowledgeChanges, [{ changeId: "test.append", path: ["values", 1], slot: "semanticSystems.possession",
    subject: { kind: "feature", slot: "semanticSystems.possession", featureId: "test.possession" } }]);
  const snapshot = JSON.parse(candidate.snapshotJson);
  assert.equal(snapshot.knowledge.semanticSystems.possession.value.values[1], "Supported addition");
  assert.ok(snapshot.evidenceRegistry.claims.some((claim: { claimId: string }) => claim.claimId === finding.claimRef));
  assert.ok(snapshot.evidenceRegistry.sources.some((source: { sourceId: string }) => source.sourceId === finding.evidence[0]!.sourceRef));
  assert.deepEqual((await freshStore.getReviewCandidate(id))!.candidate, candidate);
  assert.equal(candidate.snapshot.status, "review"); assert.equal(await freshStore.getReviewDecision(id), null);
  assert.deepEqual(await freshStore.getCurrentCanonical(canonical.profileId), canonical);
});

test("S3B PostgreSQL legacy candidate origin remains byte/hash-identical after read-back", async () => {
  const { canonical } = await baseContext();
  const history = await lifecycle.listProfileHistory(canonical.profileId), bootstrap = history.find((entry) => entry.kind === "candidate");
  assert.ok(bootstrap?.kind === "candidate");
  const read = await new ProfileLifecycleStoreV2(() => database).getReviewCandidate(bootstrap.id); assert.ok(read);
  assert.deepEqual(read.candidate, bootstrap.candidate);
  assert.equal(Object.hasOwn(read.candidate.lineage.origin, "researchProvenance"), false);
});

test("S3B/M14 PostgreSQL missing optional provenance refs remain absent", async () => {
  const { input } = await baseContext();
  const id = await (async () => {
    const output = m14Research(); delete output.provenance.responseRef;
    delete output.findings[0]!.evidence[0]!.materialRef; delete output.findings[0]!.evidence[0]!.extractionRef;
    const result = await service({ research: async () => output }).research(input); assert.ok(result.outcome === "proposal_created"); return result.candidate.id;
  })();
  const p = (await lifecycle.getReviewCandidate(id))!.candidate.lineage.origin.researchProvenance!;
  assert.deepEqual(p.provider, { providerRef: "test.provider" });
  assert.deepEqual(p.findings[0]!.evidence, [{ evidenceRef: "research.evidence", sourceRef: "research.source" }]);
  assert.equal(Object.hasOwn(p.gap, "options"), false);
});

for (const corruption of ["malformed-version", "changed-context", "wrong-parent-id"] as const) {
  test(`S3B PostgreSQL reader rejects ${corruption} research provenance`, async () => {
    const { input } = await baseContext(), result = await service().research(input); assert.ok(result.outcome === "proposal_created");
    const lineage = JSON.parse(JSON.stringify(result.candidate.candidate.lineage));
    if (corruption === "malformed-version") lineage.origin.researchProvenance.version = "99.0.0";
    if (corruption === "changed-context") lineage.origin.researchProvenance.provider.responseRef = "test.tampered";
    if (corruption === "wrong-parent-id") lineage.origin.researchProvenance.registry.binding.canonicalRecordId = randomUUID();
    // Fault injection exclusively into the runner's disposable local database.
    await connection`UPDATE language_profile_v2_candidates SET lineage=${JSON.stringify(lineage)}::jsonb WHERE id=${result.candidate.id}`;
    await assert.rejects(lifecycle.getReviewCandidate(result.candidate.id), code("storage_integrity"));
  });
}

for (const variant of ["empty-mapping", "old-value", "wrong-feature", "unmapped-extra", "false-shared-effect", "foreign-conflict"] as const) {
  test(`S3B PostgreSQL rejects hash-valid ${variant} on write AND durable read`, async () => {
    const { input, canonical } = await baseContext(), research = m14Research();
    research.findings[0]!.knowledgeChanges = [{ changeId: "audit.new.value", path: ["values", 1], value: "new supported fact" }];
    const result = await service({ research: async () => research }).research(input); assert.ok(result.outcome === "proposal_created");
    const falseArtifact = m14SemanticEnvelope(result.candidate.candidate, languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson)), ({ profile, provenance }) => {
      const finding = provenance.findings[0]!, change = finding.knowledgeChanges[0]!;
      if (variant === "empty-mapping") finding.knowledgeChanges = [];
      if (variant === "old-value") change.path = ["values", 0];
      if (variant === "wrong-feature") change.subject = { kind: "feature", slot: "semanticSystems.possession", featureId: "audit.nonexistent.feature" };
      if (variant === "unmapped-extra") { const slot = profile.knowledge.semanticSystems.possession; assert.ok(slot.state === "known"); slot.value.values.push("unmapped"); }
      if (variant === "false-shared-effect") provenance.sharedSlotEffects.push({ domain: "action.basic_pattern", targetId: "action.basic_pattern.verbalSystem.tense", before: "missing", after: "covered" });
      if (variant === "foreign-conflict") profile.evidenceRegistry.conflicts.push(m14ForeignConflict(languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson))));
    });
    assert.equal(falseArtifact.construction.ok, false);
    const c = falseArtifact.candidate;
    assert.equal(c.candidateSha256, profileCandidateContextShaV2(c));
    await assert.rejects(lifecycle.persistReviewCandidate({ candidate: c, parentCanonicalRecordId: canonical.id }), code("lineage_mismatch"));
    assert.equal((await lifecycle.listProfileHistory(canonical.profileId)).length, 4, "Rejected write has no partial rows");
    // Simulate a pre-fix artifact in the disposable DB. All hashes are correct;
    // decoder rejection must come from semantic reconciliation with its parent.
    await connection`UPDATE language_profile_v2_candidates SET snapshot_json=${c.snapshotJson}, content_sha256=${c.snapshot.contentSha256},
      candidate_sha256=${c.candidateSha256}, lineage=${JSON.stringify(c.lineage)}::jsonb WHERE id=${result.candidate.id}`;
    await assert.rejects(new ProfileLifecycleStoreV2(() => database).getReviewCandidate(result.candidate.id), code("storage_integrity"));
    if (variant === "foreign-conflict") {
      await assert.rejects(lifecycle.recordReviewDecision(result.candidate.id, lifecycleDecision(c)), code("storage_integrity"));
      const rows = await connection`SELECT snapshot_json FROM language_profile_v2_canonicals WHERE profile_id=${canonical.profileId}`;
      assert.equal(rows.length, 1); assert.equal(rows[0]!.snapshot_json, canonical.snapshotJson);
      const decisions = await connection`SELECT id FROM language_profile_v2_decisions WHERE candidate_record_id=${result.candidate.id}`;
      assert.equal(decisions.length, 0, "No promotion or decision for the false artifact");
    }
  });
}

const fakeHumanValidation = (validatorRef = "audit.fake.reviewer", validatedAt = "2026-09-21T00:00:00Z") =>
  ({ status: "human_validated" as const, validatorRef, validatedAt });

for (const variant of ["new-claim-reviewed", "new-relation-validated", "combined"] as const) {
  test(`Fix 5 PostgreSQL rejects hash-valid ${variant} on write`, async () => {
    const { input, canonical } = await baseContext(), result = await service().research(input);
    assert.ok(result.outcome === "proposal_created");
    const parent = languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson));
    const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile }) => {
      const claim = profile.evidenceRegistry.claims.at(-1)!;
      if (variant !== "new-relation-validated") claim.reviewStatus = "human_reviewed";
      if (variant !== "new-claim-reviewed") claim.evidenceRefs[0]!.relationshipValidation = fakeHumanValidation();
    });
    assert.equal(artifact.construction.ok, false);
    assert.equal(artifact.candidate.candidateSha256, profileCandidateContextShaV2(artifact.candidate));
    await assert.rejects(lifecycle.persistReviewCandidate({ candidate: artifact.candidate, parentCanonicalRecordId: canonical.id }), code("lineage_mismatch"));
    assert.deepEqual(await lifecycle.getCurrentCanonical(canonical.profileId), canonical);
  });
}

test("Fix 5 PostgreSQL combined attack is rejected on durable read and before ACCEPT", async () => {
  const { input, canonical } = await baseContext(), result = await service().research(input);
  assert.ok(result.outcome === "proposal_created");
  const parent = languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson));
  const artifact = m14SemanticEnvelope(result.candidate.candidate, parent, ({ profile }) => {
    const claim = profile.evidenceRegistry.claims.at(-1)!;
    claim.reviewStatus = "human_reviewed";
    claim.evidenceRefs[0]!.relationshipValidation = fakeHumanValidation();
  });
  const c = artifact.candidate;
  await connection`UPDATE language_profile_v2_candidates SET snapshot_json=${c.snapshotJson}, content_sha256=${c.snapshot.contentSha256},
    candidate_sha256=${c.candidateSha256}, lineage=${JSON.stringify(c.lineage)}::jsonb WHERE id=${result.candidate.id}`;
  await assert.rejects(new ProfileLifecycleStoreV2(() => database).getReviewCandidate(result.candidate.id), code("storage_integrity"));
  await assert.rejects(lifecycle.recordReviewDecision(result.candidate.id, lifecycleDecision(c)), code("storage_integrity"));
  const decisions = await connection`SELECT id FROM language_profile_v2_decisions WHERE candidate_record_id=${result.candidate.id}`;
  assert.equal(decisions.length, 0);
  const canonicals = await connection`SELECT snapshot_json FROM language_profile_v2_canonicals WHERE profile_id=${canonical.profileId}`;
  assert.deepEqual(canonicals.map((row) => row.snapshot_json), [canonical.snapshotJson]);
});

test("Fix 6 PostgreSQL rejects hash-valid same-slot inapplicable subject on write, read and review", async () => {
  const { input, canonical, output } = await ageBaseContext();
  const result = await service({ research: async () => output }).research(input);
  assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const parent = languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson));
  const stored = await lifecycle.getReviewCandidate(result.candidate.id); assert.ok(stored);
  assert.deepEqual(stored.candidate, result.candidate.candidate, "Applicable mechanism round-trip remains valid");
  const artifact = m14MoveAgeFindingToForeignMechanism(stored.candidate, parent);
  assert.equal(artifact.construction.ok, false);
  assert.equal(artifact.candidate.candidateSha256, profileCandidateContextShaV2(artifact.candidate));
  await assert.rejects(lifecycle.persistReviewCandidate({ candidate: artifact.candidate, parentCanonicalRecordId: canonical.id }), code("lineage_mismatch"));
  const c = artifact.candidate;
  await connection`UPDATE language_profile_v2_candidates SET snapshot_json=${c.snapshotJson}, content_sha256=${c.snapshot.contentSha256},
    candidate_sha256=${c.candidateSha256}, lineage=${JSON.stringify(c.lineage)}::jsonb WHERE id=${result.candidate.id}`;
  await assert.rejects(new ProfileLifecycleStoreV2(() => database).getReviewCandidate(result.candidate.id), code("storage_integrity"));
  await assert.rejects(lifecycle.recordReviewDecision(result.candidate.id, lifecycleDecision(c)), code("storage_integrity"));
  const decisions = await connection`SELECT id FROM language_profile_v2_decisions WHERE candidate_record_id=${result.candidate.id}`;
  assert.equal(decisions.length, 0);
  const canonicals = await connection`SELECT snapshot_json FROM language_profile_v2_canonicals WHERE profile_id=${canonical.profileId}`;
  assert.deepEqual(canonicals.map((row) => row.snapshot_json), [canonical.snapshotJson]);
});

for (const subjects of ["both", "reversed", "broad"] as const) {
  test(`Fix 7 PostgreSQL rejects hash-valid ${subjects} subject laundering on write, read and review`, async () => {
    const { input, canonical, output } = await ageBaseContext();
    const result = await service({ research: async () => output }).research(input);
    assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
    const parent = languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson));
    const artifact = m14MixedSubjectForeignMechanism(result.candidate.candidate, parent, subjects);
    assert.ok(!artifact.construction.ok); assert.equal(artifact.construction.code, "lineage_mismatch");
    const c = artifact.candidate;
    assert.equal(c.snapshot.contentSha256, createHash("sha256").update(c.snapshotJson).digest("hex"));
    assert.equal(c.candidateSha256, profileCandidateContextShaV2(c));
    await assert.rejects(lifecycle.persistReviewCandidate({ candidate: c, parentCanonicalRecordId: canonical.id }), code("lineage_mismatch"));
    await connection`UPDATE language_profile_v2_candidates SET snapshot_json=${c.snapshotJson}, content_sha256=${c.snapshot.contentSha256},
      candidate_sha256=${c.candidateSha256}, lineage=${JSON.stringify(c.lineage)}::jsonb WHERE id=${result.candidate.id}`;
    await assert.rejects(new ProfileLifecycleStoreV2(() => database).getReviewCandidate(result.candidate.id), code("storage_integrity"));
    await assert.rejects(lifecycle.recordReviewDecision(result.candidate.id, lifecycleDecision(c)), code("storage_integrity"));
    assert.equal((await connection`SELECT id FROM language_profile_v2_decisions WHERE candidate_record_id=${result.candidate.id}`).length, 0);
    // A corrupt candidate deliberately makes the whole S3B history unreadable.
    // Inspect the canonical row directly to prove no write or promotion occurred.
    const canonicals = await connection`SELECT snapshot_json FROM language_profile_v2_canonicals WHERE profile_id=${canonical.profileId}`;
    assert.deepEqual(canonicals.map((row) => row.snapshot_json), [canonical.snapshotJson]);
  });
}

test("Fix 7 PostgreSQL accepts a valid multi-subject finding and preserves its parent", async () => {
  const fixture = m14AgeApplicabilityFixture(`test.m14.pg.fix7.multi.${++serial}`);
  const tense = fixture.profile.knowledge.verbalSystem.tense; assert.ok(tense.state === "known");
  tense.value.mechanisms.push({ ...structuredClone(tense.value.mechanisms[0]!), mechanismId: "audit.age.two", conditions: [] });
  const finding = fixture.output.findings[0]!;
  finding.subjectRefs.push({ kind: "feature_mechanism", slot: "verbalSystem.tense",
    featureId: "audit.tense", mechanismId: "audit.age.two" });
  finding.knowledgeChanges![0]!.path[1] = 2;
  const { input, canonical, output } = await ageBaseContext(fixture);
  const result = await service({ research: async () => output }).research(input);
  assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const read = await new ProfileLifecycleStoreV2(() => database).getReviewCandidate(result.candidate.id); assert.ok(read);
  assert.deepEqual(read.candidate, result.candidate.candidate);
  assert.deepEqual(await lifecycle.getCurrentCanonical(canonical.profileId), canonical);
});

test("Fix 7 PostgreSQL accepts the foreign mechanism on its applicable action target", async () => {
  const { input, canonical, output } = await ageBaseContext();
  input.evidenceRequest.requirement.domain = "action.basic_pattern";
  input.evidenceRequest.target.targetId = "action.basic_pattern.verbalSystem.tense";
  const gap = await m13.resolve(input.evidenceRequest); assert.ok(gap.outcome === "gap");
  input.gap = m14GapReferenceV2(gap);
  const finding = output.findings[0]!;
  finding.target = input.evidenceRequest.target;
  finding.subjectRefs = [{ kind: "feature", slot: "verbalSystem.tense", featureId: "audit.tense" }];
  finding.knowledgeChanges = [{ changeId: "audit.foreign.action", path: ["mechanisms", 1, "conditions", 0], value: "valid action" }];
  const result = await service({ research: async () => output }).research(input);
  assert.ok(result.outcome === "proposal_created", JSON.stringify(result));
  const read = await new ProfileLifecycleStoreV2(() => database).getReviewCandidate(result.candidate.id); assert.ok(read);
  assert.deepEqual(read.candidate, result.candidate.candidate);
  assert.deepEqual(await lifecycle.getCurrentCanonical(canonical.profileId), canonical);
});

for (const variant of ["historical-claim-status", "historical-relation-status"] as const) {
  test(`Fix 5 PostgreSQL preserves history and rejects ${variant}`, async () => {
    const { input, canonical } = await baseContext(), result = await service().research(input);
    assert.ok(result.outcome === "proposal_created");
    const stored = await lifecycle.getReviewCandidate(result.candidate.id); assert.ok(stored);
    const parent = languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson));
    const proposed = languageProfileV2Schema.parse(JSON.parse(stored.candidate.snapshotJson));
    assert.deepEqual(proposed.evidenceRegistry.claims.slice(0, parent.evidenceRegistry.claims.length), parent.evidenceRegistry.claims);
    const artifact = m14SemanticEnvelope(stored.candidate, parent, ({ profile }) => {
      const claim = profile.evidenceRegistry.claims[0]!;
      if (variant === "historical-claim-status") claim.reviewStatus = "human_reviewed";
      else claim.evidenceRefs[0]!.relationshipValidation = fakeHumanValidation();
    });
    await assert.rejects(lifecycle.persistReviewCandidate({ candidate: artifact.candidate, parentCanonicalRecordId: canonical.id }), code("lineage_mismatch"));
    assert.deepEqual(await lifecycle.getCurrentCanonical(canonical.profileId), canonical);
  });
}

for (const historical of [false, true]) {
  test(`Fix 4 PostgreSQL round-trip ${historical ? "unchanged historical conflict plus knowledge" : "valid new research conflict"}`, async () => {
    const { input, canonical } = await baseContext(historical), output = historical ? m14Research() : m14ConflictResearch();
    if (historical) output.findings[0]!.knowledgeChanges = [{ changeId: "valid.addition", path: ["values", 1], value: "new supported fact" }];
    const result = await service({ research: async () => output }).research(input); assert.ok(result.outcome === "proposal_created");
    const stored = await new ProfileLifecycleStoreV2(() => database).getReviewCandidate(result.candidate.id); assert.ok(stored);
    assert.deepEqual(stored.candidate, result.candidate.candidate);
    const expected = historical ? JSON.parse(canonical.snapshotJson).evidenceRegistry.conflicts : output.conflicts;
    assert.deepEqual(JSON.parse(stored.candidate.snapshotJson).evidenceRegistry.conflicts, expected);
    assert.deepEqual(await lifecycle.getCurrentCanonical(canonical.profileId), canonical);
  });
}
