import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../src/db/schema.js";
import { closeDbConnection } from "../../src/db/client.js";
import { loadMigrationFiles, migratePending } from "../../src/db/migrations.js";
import { createPostgresMigrationDatabase } from "../../src/db/postgres-migration-database.js";
import { languageKnowledgeStore } from "../../src/languages/knowledge/repository.js";
import { RegistryGroundingStoreV2 } from "../../src/languages/knowledge/registry-grounding-v2.js";
import { ProfileLifecycleStoreV2, type ProfileCanonicalRecordV2 } from "../../src/languages/profile/profile-lifecycle-store-v2.js";
import { createProfileReviewCandidateV2 } from "../../src/languages/profile/profile-lifecycle-v2.js";
import { lifecycleDecision } from "../fixtures/profile-lifecycle-v2.js";
import { groundingProfile, groundingRegistry } from "../fixtures/registry-grounding-v2.js";
import { germanLanguageProfileFixture } from "../fixtures/language-profile/german.js";
import { germanDecisionRegistryFixture } from "../fixtures/language-decisions/german.js";
import { GroundedAdaptationCompiler } from "../../src/languages/adaptation/adaptation-plan.js";
import { a1U01CurriculumFixture } from "../fixtures/language-curriculum/a1-u01.js";
import { m4Registry } from "../fixtures/m4-grounded.js";
import { TargetEvidenceResolverV2 } from "../../src/languages/resolution/target-evidence-v2.js";
import { m13Input, m13Profile } from "../fixtures/m13-target-evidence-v2.js";

const adminUrl = new URL(process.env.MIGRATION_TEST_DATABASE_URL ?? "postgres://invalid/invalid");
if (process.env.MIGRATION_TEST_ALLOW_LOCAL !== "1" || !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) || adminUrl.pathname !== "/memoos_migration_admin") {
  throw new Error("Registry grounding tests require the explicit disposable local PostgreSQL runner");
}
const admin = postgres(adminUrl.toString(), { max: 1 });
const dbName = `memoos_it_grounding_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const localUrl = new URL(adminUrl); localUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = localUrl.toString();
const connection = postgres(localUrl.toString(), { max: 10 });
const database = drizzle(connection, { schema });
const store = new RegistryGroundingStoreV2(() => database);
const lifecycle = new ProfileLifecycleStoreV2(() => database);
const userId = randomUUID(), otherUserId = randomUUID(), legacyProfileId = randomUUID(), legacyRegistryId = randomUUID();
const migrationId = "0027_ground_language_decision_registries_v2.sql";
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let serial = 0;
const nextProfile = () => `test.grounding.${++serial}`;
const code = (expected: string) => (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === expected;
const sqlCode = (expected: string) => (e: unknown) => code(expected)(e) || (e instanceof Error && code(expected)(e.cause));

before(async () => {
  assert.match(dbName, /^memoos_it_grounding_[0-9]+_[a-f0-9]+$/u);
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../drizzle", import.meta.url)));
  const migrationDb = createPostgresMigrationDatabase(localUrl.toString());
  try {
    await migratePending(migrationDb, migrations.filter((m) => m.id < migrationId));
    await connection`INSERT INTO users (id,username,password_hash) VALUES (${userId},'grounding.test','isolated'),(${otherUserId},'grounding.other','isolated')`;
    await connection`INSERT INTO language_knowledge_profiles (id,user_id,profile_id,language_id,variety_id,version,status,profile,content_sha256)
      VALUES (${legacyProfileId},${userId},${germanLanguageProfileFixture.identity.profileId},'de','de.standard',${germanLanguageProfileFixture.version},${germanLanguageProfileFixture.status},${JSON.stringify(germanLanguageProfileFixture)}::jsonb,${sha(germanLanguageProfileFixture)})`;
    const r = germanDecisionRegistryFixture;
    await connection`INSERT INTO language_decision_registry_versions (id,user_id,profile_record_id,registry_id,language_id,variety_id,curriculum_id,version,status,registry,content_sha256)
      VALUES (${legacyRegistryId},${userId},${legacyProfileId},${r.identity.registryId},${r.identity.languageId},${r.identity.varietyId},${r.identity.curriculumId},${r.version},${r.status},${JSON.stringify(r)}::jsonb,${sha(r)})`;
    assert.deepEqual(await migratePending(migrationDb, migrations), [migrationId]);
    assert.deepEqual(await migratePending(migrationDb, migrations), []);
  } finally { await migrationDb.close(); }
});
after(async () => { await closeDbConnection(); await connection.end({ timeout: 5 }); await admin.end({ timeout: 5 }); });

async function candidate(profileId = nextProfile(), version = "1.0.0", parent: ProfileCanonicalRecordV2 | null = null) {
  const input = createProfileReviewCandidateV2({ profile: parent ? JSON.parse(parent.snapshotJson) : groundingProfile(profileId),
    proposedVersion: version, parentCanonical: parent ? JSON.parse(parent.snapshotJson) : null, origin: { kind: "manual", originRef: "test.grounding" } });
  assert.ok(input.ok);
  return lifecycle.persistReviewCandidate({ candidate: input.candidate, parentCanonicalRecordId: parent?.id ?? null });
}
async function canonical(profileId = nextProfile(), version = "1.0.0", parent: ProfileCanonicalRecordV2 | null = null) {
  const c = await candidate(profileId, version, parent);
  const o = await lifecycle.recordReviewDecision(c.id, lifecycleDecision(c.candidate));
  assert.ok(o.canonical); return o.canonical;
}
async function registry(c: ProfileCanonicalRecordV2, version = "1.0.0", registryId = `registry.${c.profileId}`, owner = userId) {
  return store.createRegistry({ userId: owner, canonicalRecordId: c.id, registry: groundingRegistry(version, registryId) });
}
const lookup = (profileId: string, id: string, version = "1.0.0") => ({ userId, profileId, registryRef: { id, version } });
const m4Input = (canonicalRecordId: string, registryRecordId: string, owner = userId) => ({
  userId: owner, canonicalRecordId, registryRecordId, curriculum: a1U01CurriculumFixture,
});
const m4 = new GroundedAdaptationCompiler(store);
const m13 = new TargetEvidenceResolverV2(store);
const m13Request = (canonicalRecordId: string, registryRecordId: string, owner = userId) => ({
  ...m13Input(), userId: owner, canonicalRecordId, registryRecordId,
});
async function evidenceCanonical() {
  const profile = m13Profile(nextProfile()); profile.status = "draft";
  const input = createProfileReviewCandidateV2({ profile, proposedVersion: "1.0.0", parentCanonical: null, origin: { kind: "manual", originRef: "test.m13" } });
  assert.ok(input.ok);
  const c = await lifecycle.persistReviewCandidate({ candidate: input.candidate, parentCanonicalRecordId: null });
  const result = await lifecycle.recordReviewDecision(c.id, lifecycleDecision(c.candidate));
  assert.ok(result.canonical); return result.canonical;
}

test("grounding migration upgrades existing Registry rows without fabricating v2 bindings", async () => {
  const [r] = await connection`SELECT * FROM language_decision_registry_versions WHERE id=${legacyRegistryId}`;
  assert.equal(r!.profile_record_id, legacyProfileId); assert.equal(r!.canonical_record_id, null); assert.equal(r!.profile_binding_v2, null);
  assert.deepEqual(r!.registry, germanDecisionRegistryFixture);
  assert.equal(r!.content_sha256, sha(germanDecisionRegistryFixture));
});
test("grounding bootstraps from a durable validated canonical with exact identity", async () => {
  const c = await canonical(), artifact = groundingRegistry("7.0.0", `registry.${c.profileId}`), before = structuredClone(artifact);
  const r = await store.createRegistry({ userId, canonicalRecordId: c.id, registry: artifact });
  assert.deepEqual(r.profileBinding, { bindingVersion: "1.0.0", canonicalRecordId: c.id, profileId: c.profileId,
    profileVersion: c.snapshot.version, schemaVersion: "2.0.0", contractVersion: "1.0.0", canonicalSha256: c.snapshot.contentSha256 });
  assert.equal(r.registry.version, "7.0.0"); assert.equal(r.registry.status, artifact.status);
  const review = await lifecycle.getReviewCandidate(c.candidateRecordId); assert.ok(review);
  assert.notEqual(r.profileBinding.canonicalSha256, review.candidate.snapshot.contentSha256);
  assert.deepEqual(artifact, before); assert.deepEqual(await store.getRegistry(userId, r.id), r);
  assert.deepEqual(await store.checkRegistryGrounding(userId, r.id, c.id), { ok: true });
  assert.equal((await store.getRegistryForCurrentCanonical(lookup(c.profileId, r.registry.identity.registryId, "7.0.0"))).registry.id, r.id);
});
test("grounding revision preserves A historically, rejects A for B and requires explicit new Registry version", async () => {
  const a = await canonical(), ra = await registry(a), before = structuredClone(ra), b = await canonical(a.profileId, "2.0.0", a);
  assert.equal((await store.checkRegistryGrounding(userId, ra.id, a.id)).ok, true);
  const mismatch = await store.checkRegistryGrounding(userId, ra.id, b.id); assert.ok(!mismatch.ok);
  assert.equal(mismatch.code, "registry_profile_mismatch"); assert.ok(mismatch.fields.includes("canonicalRecordId"));
  await assert.rejects(store.getRegistryForCurrentCanonical(lookup(a.profileId, ra.registry.identity.registryId)), code("registry_not_found_for_canonical"));
  await assert.rejects(registry(b), code("registry_version_exists"));
  const rb = await registry(b, "2.0.0");
  assert.equal((await store.checkRegistryGrounding(userId, rb.id, b.id)).ok, true);
  assert.equal((await store.checkRegistryGrounding(userId, rb.id, a.id)).ok, false);
  assert.equal((await store.getRegistryForCurrentCanonical(lookup(a.profileId, rb.registry.identity.registryId, "2.0.0"))).registry.id, rb.id);
  assert.deepEqual(await store.getRegistry(userId, ra.id), before);
});
test("grounding explicit pinned A remains A when B was promoted before creation", async () => {
  const a = await canonical(), b = await canonical(a.profileId, "2.0.0", a), ra = await registry(a);
  assert.equal(ra.profileBinding.canonicalRecordId, a.id);
  assert.equal((await store.checkRegistryGrounding(userId, ra.id, b.id)).ok, false);
  await assert.rejects(store.getRegistryForCurrentCanonical(lookup(a.profileId, ra.registry.identity.registryId)), code("registry_not_found_for_canonical"));
});
test("grounding current lookup stays internally consistent across a concurrent promotion", async () => {
  const a = await canonical(), ra = await registry(a), bc = await candidate(a.profileId, "2.0.0", a);
  let promoted = false;
  const concurrentStore = new RegistryGroundingStoreV2(() => ({ transaction: (operation, config) => database.transaction(async (tx) => {
    const proxy = new Proxy(tx, { get(target, key) {
      if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
        const result = await target.execute(query);
        const queryText = new PgDialect().sqlToQuery(typeof query === "string" ? sql.raw(query) : query.getSQL()).sql;
        if (!promoted && queryText.includes("SELECT * FROM language_profile_v2_canonicals")) {
          promoted = true; await lifecycle.recordReviewDecision(bc.id, lifecycleDecision(bc.candidate));
        }
        return result;
      };
      return Reflect.get(target, key, target);
    } });
    return operation(proxy);
  }, config) }));
  const result = await concurrentStore.getRegistryForCurrentCanonical(lookup(a.profileId, ra.registry.identity.registryId));
  assert.ok(promoted); assert.equal(result.canonical.id, a.id); assert.equal(result.registry.profileBinding.canonicalRecordId, a.id);
  assert.notEqual((await lifecycle.getCurrentCanonical(a.profileId))!.id, a.id);
  await assert.rejects(store.getRegistryForCurrentCanonical(lookup(a.profileId, ra.registry.identity.registryId)), code("registry_not_found_for_canonical"));
});
test("grounding cannot use a Registry for a different profile with the same version and language", async () => {
  const a = await canonical(), ra = await registry(a), b = await canonical();
  assert.equal(a.snapshot.version, b.snapshot.version);
  const result = await store.checkRegistryGrounding(userId, ra.id, b.id); assert.ok(!result.ok); assert.ok(result.fields.includes("profileId"));
});
test("grounding rejects durable candidate UUIDs and nonexistent canonical UUIDs", async () => {
  const c = await candidate();
  for (const id of [c.id, randomUUID()]) await assert.rejects(store.createRegistry({ userId, canonicalRecordId: id, registry: groundingRegistry() }), code("canonical_not_found"));
});
test("grounding validates Registry references against the exact v2 snapshot even when strict flag is false", async () => {
  const a = await canonical(), r = groundingRegistry(); r.validation.strictProfileGrounding = false;
  r.decisions[0]!.languageBasis.featureRefs = ["absent.feature"];
  await assert.rejects(store.createRegistry({ userId, canonicalRecordId: a.id, registry: r }), code("invalid_registry"));
});
test("grounding rejects wrong language or variety and does not infer compatibility from language alone", async () => {
  const a = await canonical();
  for (const field of ["languageId", "varietyId"] as const) {
    const r = groundingRegistry(); r.identity[field] = "wrong.identity";
    await assert.rejects(store.createRegistry({ userId, canonicalRecordId: a.id, registry: r }), code("invalid_registry"));
  }
});
test("grounding retries and concurrent creates cannot overwrite artifact or binding", async () => {
  const a = await canonical(), input = { userId, canonicalRecordId: a.id, registry: groundingRegistry("1.0.0", `registry.${a.profileId}`) };
  const results = await Promise.allSettled([store.createRegistry(input), store.createRegistry(input)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const loser = results.find((r) => r.status === "rejected"); assert.ok(loser?.status === "rejected"); assert.ok(code("registry_version_exists")(loser.reason), String(loser.reason));
  await assert.rejects(store.createRegistry(input), code("registry_version_exists"));
});
test("grounding user scoping is preserved for records and current lookup", async () => {
  const a = await canonical(), ra = await registry(a);
  await assert.rejects(store.getRegistry(otherUserId, ra.id), code("registry_not_found"));
  await assert.rejects(store.checkRegistryGrounding(otherUserId, ra.id, a.id), code("registry_not_found"));
  await assert.rejects(store.getRegistryForCurrentCanonical({ ...lookup(a.profileId, ra.registry.identity.registryId), userId: otherUserId }), code("registry_not_found_for_canonical"));
  const other = await registry(a, "1.0.0", ra.registry.identity.registryId, otherUserId); assert.notEqual(other.id, ra.id);
});
test("grounding legacy rows fail v2 guard and v2 rows stay out of legacy readers", async () => {
  const a = await canonical(), ra = await registry(a);
  assert.deepEqual(await store.checkRegistryGrounding(userId, legacyRegistryId, a.id), { ok: false, code: "registry_unbound", fields: [] });
  await assert.rejects(store.getRegistry(userId, legacyRegistryId), code("registry_unbound"));
  assert.equal((await languageKnowledgeStore.findRegistry(userId, legacyRegistryId))!.id, legacyRegistryId);
  assert.equal(await languageKnowledgeStore.findRegistry(userId, ra.id), null);
  assert.ok((await languageKnowledgeStore.listRegistries(userId)).every((r) => r.profileRecordId !== null && r.id !== ra.id));
  const [row] = await connection`SELECT profile_binding_v2 FROM language_decision_registry_versions WHERE id=${legacyRegistryId}`;
  assert.equal(row!.profile_binding_v2, null);
});
test("grounding same row stores artifact and binding atomically, rollback leaves neither", async () => {
  const a = await canonical(), marker = new Error("isolated rollback");
  await assert.rejects(database.transaction(async (tx) => {
    const inTransaction = new RegistryGroundingStoreV2(() => ({ transaction: (operation) => operation(tx) }));
    await inTransaction.createRegistry({ userId, canonicalRecordId: a.id, registry: groundingRegistry("1.0.0", `registry.${a.profileId}`) });
    throw marker;
  }), (e) => e === marker);
  const [row] = await connection`SELECT count(*)::int AS count FROM language_decision_registry_versions WHERE canonical_record_id=${a.id}`;
  assert.equal(row!.count, 0);
});
test("grounding DB forbids ambiguous dual parent and missing binding", async () => {
  const a = await canonical(), ra = await registry(a);
  await assert.rejects(connection`UPDATE language_decision_registry_versions SET profile_record_id=${legacyProfileId} WHERE id=${ra.id}`, sqlCode("23514"));
  await assert.rejects(connection`UPDATE language_decision_registry_versions SET profile_binding_v2=NULL WHERE id=${ra.id}`, sqlCode("23514"));
  await assert.rejects(connection`UPDATE language_decision_registry_versions SET canonical_record_id=NULL WHERE id=${ra.id}`, sqlCode("23514"));
});
test("grounding DB checks binding format, contract versions and canonical reference consistency", async () => {
  const a = await canonical(), ra = await registry(a);
  for (const changed of [{ ...ra.profileBinding, canonicalSha256: "invalid" }, { ...ra.profileBinding, contractVersion: "2.0.0" },
    { ...ra.profileBinding, schemaVersion: "3.0.0" }, { ...ra.profileBinding, canonicalRecordId: randomUUID() }, {}, { ...ra.profileBinding, extra: true }]) {
    await assert.rejects(connection`UPDATE language_decision_registry_versions SET profile_binding_v2=${JSON.stringify(changed)}::jsonb WHERE id=${ra.id}`, sqlCode("23514"));
  }
});
test("grounding DB FK rejects nonexistent canonicals", async () => {
  const a = await canonical(), ra = await registry(a), id = randomUUID();
  await assert.rejects(connection`UPDATE language_decision_registry_versions SET canonical_record_id=${id},profile_binding_v2=${JSON.stringify({ ...ra.profileBinding, canonicalRecordId: id })}::jsonb WHERE id=${ra.id}`, sqlCode("23503"));
});
for (const corruption of ["sha", "profile", "version", "canonical_reference", "artifact", "malformed_binding", "missing_canonical"] as const) {
  test(`grounding reader rejects isolated ${corruption} corruption`, async () => {
    const a = await canonical(), ra = await registry(a), b = await canonical(a.profileId, "2.0.0", a), marker = new Error("restore isolated corruption");
    await assert.rejects(database.transaction(async (tx) => {
      if (corruption === "malformed_binding") {
        await tx.execute(sql`ALTER TABLE language_decision_registry_versions DROP CONSTRAINT ld_registry_profile_binding_shape`);
        await tx.execute(sql`UPDATE language_decision_registry_versions SET profile_binding_v2='{}'::jsonb WHERE id=${ra.id}`);
      } else if (corruption === "artifact") {
        await tx.execute(sql`UPDATE language_decision_registry_versions SET registry='{}'::jsonb WHERE id=${ra.id}`);
      } else {
        const changed = { ...ra.profileBinding };
        if (corruption === "sha") changed.canonicalSha256 = "0".repeat(64);
        if (corruption === "profile") changed.profileId = "wrong.profile";
        if (corruption === "version") changed.profileVersion = "9.0.0";
        if (corruption === "canonical_reference") changed.canonicalRecordId = b.id;
        if (corruption === "missing_canonical") {
          await tx.execute(sql`ALTER TABLE language_decision_registry_versions DROP CONSTRAINT ld_registry_canonical_fk`);
          changed.canonicalRecordId = randomUUID();
        }
        await tx.execute(sql`UPDATE language_decision_registry_versions SET canonical_record_id=${changed.canonicalRecordId},profile_binding_v2=${JSON.stringify(changed)}::jsonb WHERE id=${ra.id}`);
      }
      const inTransaction = new RegistryGroundingStoreV2(() => ({ transaction: (operation) => operation(tx) }));
      await assert.rejects(inTransaction.getRegistry(userId, ra.id), code("storage_integrity"));
      await assert.rejects(inTransaction.checkRegistryGrounding(userId, ra.id, a.id), code("storage_integrity"));
      throw marker;
    }), (e) => e === marker);
    assert.deepEqual(await store.getRegistry(userId, ra.id), ra);
  });
}

test("M4 PostgreSQL exact pair compiles approved strategies and pins output provenance", async () => {
  const a = await canonical();
  const r = await store.createRegistry({ userId, canonicalRecordId: a.id, registry: m4Registry("1.0.0", `registry.${a.profileId}`) });
  const result = await m4.compile(m4Input(a.id, r.id)); assert.ok(result.ok);
  assert.deepEqual(result.grounding, { registryRecordId: r.id, binding: r.profileBinding });
  assert.deepEqual(result.plan.decisionChanges.reusedDecisionRefs.map(d => d.id), ["social.register.initial", "participant.actor_affected"]);
  assert.equal(result.plan.gapAnalysis.length, 8);
  assert.deepEqual(await m4.compile(m4Input(a.id, r.id)), result);
});
test("M4 PostgreSQL legacy/unbound plus reviewed profileCoverage cannot authorize planning", async () => {
  const a = await canonical();
  const result = await m4.compile(m4Input(a.id, legacyRegistryId)); assert.ok(!result.ok);
  assert.equal(result.code, "registry_unbound"); assert.equal(result.plan, null);
  const override = await m4.compile({ ...m4Input(a.id, legacyRegistryId), profileCoverage: germanLanguageProfileFixture.profileCoverage });
  assert.ok(!override.ok); assert.equal(override.code, "invalid_input"); assert.equal(override.plan, null);
});
test("M4 PostgreSQL missing canonical/Registry and wrong owner fail without a plan", async () => {
  const a = await canonical(), ra = await registry(a);
  for (const [input, expected] of [
    [m4Input(randomUUID(), ra.id), "canonical_not_found"],
    [m4Input(a.id, randomUUID()), "registry_not_found"],
    [m4Input(a.id, ra.id, otherUserId), "registry_not_found"],
    [m4Input(a.candidateRecordId, ra.id), "canonical_not_found"],
  ] as const) {
    const result = await m4.compile(input); assert.ok(!result.ok); assert.equal(result.code, expected); assert.equal(result.plan, null);
  }
});
test("M4 PostgreSQL wrong profile with matching version/language is a grounding mismatch", async () => {
  const a = await canonical(), ra = await registry(a), other = await canonical();
  const result = await m4.compile(m4Input(other.id, ra.id)); assert.ok(!result.ok);
  assert.equal(result.code, "registry_profile_mismatch"); assert.equal(result.plan, null);
});
test("M4 PostgreSQL promotion rejects B with Registry A, allows B/B and explicit historical A/A", async () => {
  const a = await canonical(), ra = await registry(a);
  const before = await m4.compile(m4Input(a.id, ra.id)); assert.ok(before.ok);
  const b = await canonical(a.profileId, "2.0.0", a);
  const unavailable = await m4.compile(m4Input(b.id, ra.id)); assert.ok(!unavailable.ok);
  assert.equal(unavailable.code, "registry_profile_mismatch"); assert.equal(unavailable.plan, null);
  const rb = await registry(b, "2.0.0");
  assert.ok((await m4.compile(m4Input(b.id, rb.id))).ok);
  const reverse = await m4.compile(m4Input(a.id, rb.id)); assert.ok(!reverse.ok); assert.equal(reverse.code, "registry_profile_mismatch");
  assert.deepEqual(await m4.compile(m4Input(a.id, ra.id)), before);
});
for (const [field, value] of Object.entries({ profileId: "wrong.profile", profileVersion: "9.0.0", schemaVersion: "9.0.0",
  contractVersion: "9.0.0", canonicalRecordId: "00000000-0000-4000-8000-000000000099", canonicalSha256: "0".repeat(64) })) {
  test(`M4 PostgreSQL rejects corrupt binding ${field} through central grounding`, async () => {
    const a = await canonical(), ra = await registry(a), marker = new Error("restore isolated M4 corruption");
    await assert.rejects(database.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE language_decision_registry_versions DROP CONSTRAINT ld_registry_profile_binding_shape`);
      await tx.execute(sql`UPDATE language_decision_registry_versions SET profile_binding_v2=${JSON.stringify({ ...ra.profileBinding, [field]: value })}::jsonb WHERE id=${ra.id}`);
      const reader = new RegistryGroundingStoreV2(() => ({ transaction: (operation) => operation(tx) }));
      const result = await new GroundedAdaptationCompiler(reader).compile(m4Input(a.id, ra.id));
      assert.ok(!result.ok); assert.equal(result.code, "storage_integrity"); assert.equal(result.plan, null);
      throw marker;
    }), e => e === marker);
    assert.ok((await m4.compile(m4Input(a.id, ra.id))).ok);
  });
}
for (const source of ["canonical", "registry"] as const) {
  test(`M4 PostgreSQL propagates ${source} content corruption without fallback`, async () => {
    const a = await canonical(), ra = await registry(a), marker = new Error("restore corruption");
    await assert.rejects(database.transaction(async tx => {
      await tx.execute(source === "canonical"
        ? sql`UPDATE language_profile_v2_canonicals SET content_sha256=${"0".repeat(64)} WHERE id=${a.id}`
        : sql`UPDATE language_decision_registry_versions SET registry='{}'::jsonb WHERE id=${ra.id}`);
      const reader = new RegistryGroundingStoreV2(() => ({ transaction: operation => operation(tx) }));
      const result = await new GroundedAdaptationCompiler(reader).compile(m4Input(a.id, ra.id));
      assert.ok(!result.ok); assert.equal(result.code, "storage_integrity"); assert.equal(result.plan, null);
      throw marker;
    }), e => e === marker);
  });
}
test("M4 PostgreSQL pinned resolution stays on A across a controlled concurrent promotion to B", async () => {
  const a = await canonical(), ra = await registry(a), bc = await candidate(a.profileId, "2.0.0", a);
  let promoted = false;
  const reader = new RegistryGroundingStoreV2(() => ({ transaction: (operation, config) => database.transaction(async tx => {
    assert.equal(config?.isolationLevel, "repeatable read"); assert.equal(config?.accessMode, "read only");
    return operation(new Proxy(tx, { get(target, key) {
      if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
        const result = await target.execute(query);
        const queryText = new PgDialect().sqlToQuery(typeof query === "string" ? sql.raw(query) : query.getSQL()).sql;
        if (!promoted && queryText.includes("SELECT * FROM language_profile_v2_candidates")) {
          promoted = true; await lifecycle.recordReviewDecision(bc.id, lifecycleDecision(bc.candidate));
        }
        return result;
      };
      return Reflect.get(target, key, target);
    } }));
  }, config) }));
  const result = await new GroundedAdaptationCompiler(reader).compile(m4Input(a.id, ra.id)); assert.ok(result.ok); assert.ok(promoted);
  assert.equal(result.grounding.binding.canonicalRecordId, a.id);
  assert.equal(result.plan.inputs.languageProfileRef.version, a.snapshot.version);
  const b = await lifecycle.getCurrentCanonical(a.profileId); assert.ok(b); assert.notEqual(b.id, a.id);
  const stale = await m4.compile(m4Input(b.id, ra.id)); assert.ok(!stale.ok); assert.equal(stale.code, "registry_profile_mismatch");
});

test("M13 PostgreSQL exact evidence authorizes durable only; preview and no-evidence stay non-durable", async () => {
  const a = await evidenceCanonical(), ra = await registry(a);
  const input = m13Request(a.id, ra.id), result = await m13.resolve(input);
  assert.ok(result.outcome === "authorized"); assert.equal(result.durableAuthorized, true);
  assert.equal(result.provenance.binding.canonicalRecordId, a.id);
  assert.equal(result.provenance.registryRecordId, ra.id);
  const preview = await m13.resolve({ ...input, mode: "preview" });
  assert.ok(preview.outcome === "preview"); assert.equal(preview.evidence.status, "covered"); assert.equal(preview.durableAuthorized, false);
  const empty = await canonical(), re = await registry(empty);
  const gap = await m13.resolve(m13Request(empty.id, re.id));
  assert.ok(gap.outcome === "gap"); assert.equal(gap.reason, "evidence_missing");
});

test("M13 PostgreSQL historical A/A stays exact after B promotion; cross-pairs never fallback", async () => {
  const a = await evidenceCanonical(), ra = await registry(a);
  const before = await m13.resolve(m13Request(a.id, ra.id)); assert.equal(before.outcome, "authorized");
  const b = await canonical(a.profileId, "2.0.0", a);
  const stale = await m13.resolve(m13Request(b.id, ra.id));
  assert.ok(stale.outcome === "error"); assert.equal(stale.reason, "registry_profile_mismatch"); assert.equal(stale.resolution, null);
  const rb = await registry(b, "2.0.0");
  const current = await m13.resolve(m13Request(b.id, rb.id)); assert.ok(current.outcome === "authorized");
  assert.equal(current.evidence.profileVersion, "2.0.0"); assert.equal(current.provenance.binding.canonicalRecordId, b.id);
  assert.deepEqual(await m13.resolve(m13Request(a.id, ra.id)), before);
});

test("M13 PostgreSQL ownership, missing records and legacy/unbound block before evidence", async () => {
  const a = await evidenceCanonical(), ra = await registry(a);
  for (const [input, expected] of [
    [m13Request(a.id, ra.id, otherUserId), "registry_not_found"],
    [m13Request(a.id, legacyRegistryId), "registry_unbound"],
    [m13Request(a.id, randomUUID()), "registry_not_found"],
    [m13Request(randomUUID(), ra.id), "canonical_not_found"],
  ] as const) {
    const result = await m13.resolve(input); assert.ok(result.outcome === "error");
    assert.equal(result.reason, expected); assert.equal(result.resolution, null); assert.equal(result.durableAuthorized, false);
  }
});

for (const source of ["canonical", "registry", "binding"] as const) {
  test(`M13 PostgreSQL ${source} corruption fails closed without a gap`, async () => {
    const a = await evidenceCanonical(), ra = await registry(a), marker = new Error("restore isolated M13 corruption");
    await assert.rejects(database.transaction(async tx => {
      if (source === "canonical") await tx.execute(sql`UPDATE language_profile_v2_canonicals SET content_sha256=${"0".repeat(64)} WHERE id=${a.id}`);
      if (source === "registry") await tx.execute(sql`UPDATE language_decision_registry_versions SET registry='{}'::jsonb WHERE id=${ra.id}`);
      if (source === "binding") await tx.execute(sql`UPDATE language_decision_registry_versions SET profile_binding_v2=${JSON.stringify({ ...ra.profileBinding, canonicalSha256: "0".repeat(64) })}::jsonb WHERE id=${ra.id}`);
      const reader = new RegistryGroundingStoreV2(() => ({ transaction: operation => operation(tx) }));
      const result = await new TargetEvidenceResolverV2(reader).resolve(m13Request(a.id, ra.id));
      assert.ok(result.outcome === "error"); assert.equal(result.reason, "storage_integrity"); assert.equal(result.resolution, null);
      throw marker;
    }), error => error === marker);
  });
}

test("M13 PostgreSQL read-only resolution emits no writes and promotion cannot swap its snapshot", async () => {
  const a = await evidenceCanonical(), ra = await registry(a), bc = await candidate(a.profileId, "2.0.0", a);
  const before = await m13.resolve(m13Request(a.id, ra.id));
  let promoted = false; const queries: string[] = [];
  const reader = new RegistryGroundingStoreV2(() => ({ transaction: (operation, config) => database.transaction(async tx => {
    assert.equal(config?.isolationLevel, "repeatable read"); assert.equal(config?.accessMode, "read only");
    return operation(new Proxy(tx, { get(target, key) {
      if (key === "execute") return async (query: Parameters<typeof tx.execute>[0]) => {
        const result = await target.execute(query);
        const queryText = new PgDialect().sqlToQuery(typeof query === "string" ? sql.raw(query) : query.getSQL()).sql;
        queries.push(queryText); assert.match(queryText.trim(), /^SELECT\b/iu);
        if (!promoted && queryText.includes("SELECT * FROM language_profile_v2_candidates")) {
          promoted = true; await lifecycle.recordReviewDecision(bc.id, lifecycleDecision(bc.candidate));
        }
        return result;
      };
      return Reflect.get(target, key, target);
    } }));
  }, config) }));
  const result = await new TargetEvidenceResolverV2(reader).resolve(m13Request(a.id, ra.id));
  assert.ok(promoted); assert.ok(queries.length > 0); assert.deepEqual(result, before);
  assert.ok(result.outcome === "authorized"); assert.equal(result.evidence.profileVersion, "1.0.0");
  const b = await lifecycle.getCurrentCanonical(a.profileId); assert.ok(b); assert.notEqual(b.id, a.id);
});
