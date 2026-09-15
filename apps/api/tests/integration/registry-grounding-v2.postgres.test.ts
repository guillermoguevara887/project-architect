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
