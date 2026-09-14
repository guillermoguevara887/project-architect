import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as dbSchema from "../../src/db/schema.js";
import { checksumMigrationSql, migratePending } from "../../src/db/migrations.js";
import { createPostgresMigrationDatabase } from "../../src/db/postgres-migration-database.js";
import { ProfileLifecycleStoreV2, ProfileLifecycleStoreError, type ProfileCanonicalRecordV2 } from "../../src/languages/profile/profile-lifecycle-store-v2.js";
import { reviewProfileCandidateV2 } from "../../src/languages/profile/profile-lifecycle-v2.js";
import { lifecycleCandidate, lifecycleDecision } from "../fixtures/profile-lifecycle-v2.js";

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!databaseUrl || process.env.MIGRATION_TEST_ALLOW_LOCAL !== "1") throw new Error("Explicit isolated local PostgreSQL environment required.");
const adminUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(adminUrl.hostname) || adminUrl.pathname !== "/memoos_migration_admin") {
  throw new Error("Refusing S3B tests outside the disposable local test server.");
}
const admin = postgres(databaseUrl, { max: 1 });
const databaseName = `memoos_it_s3b_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const isolatedUrl = new URL(databaseUrl); isolatedUrl.pathname = `/${databaseName}`;
const connection = postgres(isolatedUrl.toString(), { max: 10 });
const database = drizzle(connection, { schema: dbSchema });
const store = new ProfileLifecycleStoreV2(() => database);
let counter = 0;
const profileId = () => `test.s3b.${++counter}`;

before(async () => {
  assert.match(databaseName, /^memoos_it_s3b_[0-9]+_[a-f0-9]+$/u);
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const sql = await readFile(new URL("../../drizzle/0026_create_language_profile_v2_lifecycle.sql", import.meta.url), "utf8");
  const migrationDb = createPostgresMigrationDatabase(isolatedUrl.toString());
  try {
    const file = { id: "0026_create_language_profile_v2_lifecycle.sql", sql, checksum: checksumMigrationSql(sql) };
    assert.deepEqual(await migratePending(migrationDb, [file]), [file.id]);
    assert.deepEqual(await migratePending(migrationDb, [file]), []);
  } finally { await migrationDb.close(); }
});
after(async () => { await connection.end({ timeout: 5 }); await admin.end({ timeout: 5 }); });

async function persist(id: string, version = "1.0.0", parent: ProfileCanonicalRecordV2 | null = null, context = "test.origin") {
  const candidate = lifecycleCandidate(id, version, parent === null ? null : JSON.parse(parent.snapshotJson), context);
  return store.persistReviewCandidate({ candidate, parentCanonicalRecordId: parent?.id ?? null });
}
async function bootstrap(id = profileId()) {
  const c = await persist(id), result = await store.recordReviewDecision(c.id, lifecycleDecision(c.candidate));
  assert.ok(result.canonical); return result.canonical;
}
const code = (expected: string) => (e: unknown) => e instanceof ProfileLifecycleStoreError && e.code === expected;
function sqlCode(expected: string, constraint?: string) {
  return (error: unknown) => {
    const e = error as { code?: string; constraint_name?: string };
    return e.code === expected && (!constraint || e.constraint_name === constraint);
  };
}
async function counts(id: string) {
  const [r] = await connection`SELECT
    (SELECT count(*)::int FROM language_profile_v2_candidates WHERE profile_id=${id}) AS candidates,
    (SELECT count(*)::int FROM language_profile_v2_decisions WHERE profile_id=${id}) AS decisions,
    (SELECT count(*)::int FROM language_profile_v2_canonicals WHERE profile_id=${id}) AS canonicals`;
  return { candidates: r!.candidates, decisions: r!.decisions, canonicals: r!.canonicals };
}

// A third connection holds the exact profile lock until both transactions are
// visibly waiting in pg_locks. This exercises PostgreSQL contention, not timing
// or a mocked application mutex.
async function race(id: string, first: () => Promise<unknown>, second: () => Promise<unknown>) {
  let release!: () => void, locked!: () => void;
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const blocker = connection.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'language-profile-v2:' + id},0))`;
    locked(); await hold;
  });
  await ready;
  const attempts = Promise.allSettled([first(), second()]);
  try {
    let waiting = false;
    for (let i = 0; i < 200; i++) {
      const [row] = await connection`SELECT count(*)::int AS count FROM pg_locks
        WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
      if (row!.count >= 2) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "Both real transactions must contend for the held profile lock");
  } finally { release(); await blocker; }
  return attempts;
}
function oneWinner(results: PromiseSettledResult<unknown>[], loserCode: string) {
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const loser = results.find((r) => r.status === "rejected");
  assert.ok(loser?.status === "rejected"); assert.ok(code(loserCode)(loser.reason), String(loser.reason));
}

test("S3B PostgreSQL persists and reads exact candidates without mutating inputs", async () => {
  const id = profileId(), candidate = lifecycleCandidate(id), before = structuredClone(candidate);
  const stored = await store.persistReviewCandidate({ candidate, parentCanonicalRecordId: null });
  assert.deepEqual((await store.getReviewCandidate(stored.id))?.candidate, candidate);
  assert.deepEqual(candidate, before);
  const [raw] = await connection`SELECT snapshot_json, content_sha256, candidate_sha256 FROM language_profile_v2_candidates WHERE id=${stored.id}`;
  assert.equal(raw!.snapshot_json, candidate.snapshotJson);
  assert.equal(raw!.content_sha256, candidate.snapshot.contentSha256);
  assert.equal(raw!.candidate_sha256, candidate.candidateSha256);
  assert.equal((await store.persistReviewCandidate({ candidate, parentCanonicalRecordId: null })).id, stored.id);
  assert.deepEqual(await counts(id), { candidates: 1, decisions: 0, canonicals: 0 });
});
test("S3B PostgreSQL invalid candidate creates no record", async () => {
  const id = profileId(), c = lifecycleCandidate(id);
  await assert.rejects(store.persistReviewCandidate({ candidate: { ...c, snapshotJson: "{}" }, parentCanonicalRecordId: null }), code("snapshot_mismatch"));
  assert.deepEqual(await counts(id), { candidates: 0, decisions: 0, canonicals: 0 });
});
test("S3B PostgreSQL ACCEPT creates both linked records and current canonical", async () => {
  const id = profileId(), c = await persist(id), decision = lifecycleDecision(c.candidate);
  const before = structuredClone(decision), r = await store.recordReviewDecision(c.id, decision);
  assert.ok(r.canonical);
  assert.equal(r.canonical.candidateRecordId, c.id); assert.equal(r.canonical.decisionRecordId, r.decision.id);
  assert.equal(r.decision.canonicalRecordId, r.canonical.id);
  assert.deepEqual(await store.getCanonical(r.canonical.id), r.canonical);
  assert.deepEqual(await store.getReviewDecision(c.id), r.decision);
  assert.deepEqual(await store.getCurrentCanonical(id), r.canonical);
  assert.deepEqual(decision, before);
  assert.deepEqual(await counts(id), { candidates: 1, decisions: 1, canonicals: 1 });
});
test("S3B PostgreSQL revision preserves canonical parent and all prior bytes", async () => {
  const p = await bootstrap(), before = structuredClone(p), c = await persist(p.profileId, "2.0.0", p);
  const r = await store.recordReviewDecision(c.id, lifecycleDecision(c.candidate));
  assert.ok(r.canonical); assert.equal(r.canonical.parentCanonicalRecordId, p.id);
  assert.deepEqual(await store.getCanonical(p.id), before);
  assert.equal((await store.getCurrentCanonical(p.profileId))?.id, r.canonical.id);
});
test("S3B PostgreSQL REJECT leaves candidate and current canonical unchanged", async () => {
  const p = await bootstrap(), c = await persist(p.profileId, "2.0.0", p);
  const r = await store.recordReviewDecision(c.id, lifecycleDecision(c.candidate, "REJECT"));
  assert.equal(r.canonical, null); assert.equal(r.decision.decision.decision, "REJECT");
  assert.deepEqual(await store.getReviewCandidate(c.id), c); assert.deepEqual(await store.getCurrentCanonical(p.profileId), p);
  assert.deepEqual(await counts(p.profileId), { candidates: 2, decisions: 2, canonicals: 1 });
});
for (const first of ["ACCEPT", "REJECT"] as const) for (const second of ["ACCEPT", "REJECT"] as const) {
  test(`S3B PostgreSQL terminal ${first} then ${second} is immutable (retry policy B)`, async () => {
    const id = profileId(), c = await persist(id);
    await store.recordReviewDecision(c.id, lifecycleDecision(c.candidate, first));
    await assert.rejects(store.recordReviewDecision(c.id, lifecycleDecision(c.candidate, second)), code("decision_already_recorded"));
    assert.equal((await store.getReviewDecision(c.id))?.decision.decision, first);
    assert.deepEqual(await counts(id), { candidates: 1, decisions: 1, canonicals: first === "ACCEPT" ? 1 : 0 });
  });
}
test("S3B PostgreSQL concurrent ACCEPT/REJECT on one candidate has one terminal winner", async () => {
  const id = profileId(), c = await persist(id);
  const results = await race(id, () => store.recordReviewDecision(c.id, lifecycleDecision(c.candidate)),
    () => store.recordReviewDecision(c.id, lifecycleDecision(c.candidate, "REJECT")));
  oneWinner(results, "decision_already_recorded");
  const r = await store.getReviewDecision(c.id); assert.ok(r);
  assert.deepEqual(await counts(id), { candidates: 1, decisions: 1, canonicals: r.decision.decision === "ACCEPT" ? 1 : 0 });
});
test("S3B PostgreSQL concurrent siblings cannot create two canonical heads", async () => {
  const p = await bootstrap(), a = await persist(p.profileId, "2.0.0", p, "test.a"), b = await persist(p.profileId, "3.0.0", p, "test.b");
  const results = await race(p.profileId, () => store.recordReviewDecision(a.id, lifecycleDecision(a.candidate)),
    () => store.recordReviewDecision(b.id, lifecycleDecision(b.candidate)));
  oneWinner(results, "stale_parent");
  const events = await store.listProfileHistory(p.profileId);
  assert.equal(events.filter((e) => e.kind === "canonical" && e.parentCanonicalRecordId === p.id).length, 1);
  assert.deepEqual(await counts(p.profileId), { candidates: 3, decisions: 2, canonicals: 2 });
  assert.equal((await store.getCurrentCanonical(p.profileId))?.parentCanonicalRecordId, p.id);
});
test("S3B PostgreSQL concurrent bootstrap creates exactly one root canonical", async () => {
  const id = profileId(), a = await persist(id, "1.0.0", null, "test.a"), b = await persist(id, "2.0.0", null, "test.b");
  oneWinner(await race(id, () => store.recordReviewDecision(a.id, lifecycleDecision(a.candidate)),
    () => store.recordReviewDecision(b.id, lifecycleDecision(b.candidate))), "stale_parent");
  assert.deepEqual(await counts(id), { candidates: 2, decisions: 1, canonicals: 1 });
  assert.equal((await store.getCurrentCanonical(id))?.parentCanonicalRecordId, null);
});
test("S3B PostgreSQL stale parent fails without partial terminal writes", async () => {
  const p = await bootstrap(), a = await persist(p.profileId, "2.0.0", p, "test.a"), b = await persist(p.profileId, "3.0.0", p, "test.b");
  await store.recordReviewDecision(b.id, lifecycleDecision(b.candidate));
  await assert.rejects(store.recordReviewDecision(a.id, lifecycleDecision(a.candidate)), code("stale_parent"));
  assert.equal(await store.getReviewDecision(a.id), null);
  assert.deepEqual(await counts(p.profileId), { candidates: 3, decisions: 2, canonicals: 2 });
});
test("S3B PostgreSQL history is complete and ordered by DB sequence, not supplied time", async () => {
  const a = await bootstrap(), bCandidate = await persist(a.profileId, "2.0.0", a);
  const b = (await store.recordReviewDecision(bCandidate.id, lifecycleDecision(bCandidate.candidate, "ACCEPT", "1990-01-01T00:00:00Z"))).canonical!;
  const c = await persist(a.profileId, "3.0.0", b, "test.rejected");
  await store.recordReviewDecision(c.id, lifecycleDecision(c.candidate, "REJECT"));
  const dCandidate = await persist(a.profileId, "3.0.0", b, "test.new.review");
  const d = (await store.recordReviewDecision(dCandidate.id, lifecycleDecision(dCandidate.candidate))).canonical!;
  const history = await store.listProfileHistory(a.profileId);
  assert.deepEqual(history.map((e) => e.kind), ["candidate", "decision", "canonical", "candidate", "decision", "canonical", "candidate", "decision", "candidate", "decision", "canonical"]);
  assert.deepEqual(await store.getCanonical(a.id), a); assert.deepEqual(await store.getCanonical(b.id), b);
  assert.equal((await store.getCurrentCanonical(a.profileId))?.id, d.id); assert.equal(d.parentCanonicalRecordId, b.id);
  assert.equal((await store.getReviewDecision(c.id))?.decision.decision, "REJECT");
});
for (const field of ["contentSha256", "candidateSha256"] as const) {
  test(`S3B PostgreSQL wrong decision ${field} creates no writes`, async () => {
    const id = profileId(), c = await persist(id);
    await assert.rejects(store.recordReviewDecision(c.id, { ...lifecycleDecision(c.candidate), [field]: "0".repeat(64) }),
      code(field === "contentSha256" ? "snapshot_mismatch" : "stale_decision"));
    assert.deepEqual(await counts(id), { candidates: 1, decisions: 0, canonicals: 0 });
  });
}
test("S3B PostgreSQL wrong candidate record cannot borrow another candidate's ACCEPT", async () => {
  const a = await persist(profileId()), b = await persist(profileId());
  await assert.rejects(store.recordReviewDecision(b.id, lifecycleDecision(a.candidate)), code("snapshot_mismatch"));
  await assert.rejects(store.recordReviewDecision(randomUUID(), lifecycleDecision(a.candidate)), code("candidate_not_found"));
  assert.equal(await store.getReviewDecision(a.id), null); assert.equal(await store.getReviewDecision(b.id), null);
});
test("S3B PostgreSQL forged caller candidate cannot replace persisted content", async () => {
  const c = await persist(profileId()), forged = { ...c.candidate, snapshotJson: "{}" };
  await assert.rejects(store.recordReviewDecision(c.id, { ...lifecycleDecision(c.candidate), candidate: forged }), code("decision_invalid"));
  assert.equal(await store.getReviewDecision(c.id), null);
});
test("S3B PostgreSQL foreign durable parent is rejected by service and FK", async () => {
  const parent = await bootstrap(), id = profileId(), c = lifecycleCandidate(id);
  await assert.rejects(store.persistReviewCandidate({ candidate: c, parentCanonicalRecordId: parent.id }), code("parent_not_found"));
  const r = c.snapshot;
  await assert.rejects(connection`INSERT INTO language_profile_v2_candidates
    (profile_id,version,schema_version,contract_version,status,snapshot_json,content_sha256,candidate_sha256,lineage,parent_canonical_record_id)
    VALUES (${id},${r.version},${r.schemaVersion},${r.contractVersion},'review',${c.snapshotJson},${r.contentSha256},${c.candidateSha256},${JSON.stringify(c.lineage)}::jsonb,${parent.id})`, sqlCode("23503", "lpv2_candidates_parent_fk"));
});
test("S3B PostgreSQL mismatched parent SHA binding is rejected", async () => {
  const parent = await bootstrap(), changed = JSON.parse(parent.snapshotJson); changed.identity.languageName = "Different parent";
  const c = lifecycleCandidate(parent.profileId, "2.0.0", changed);
  await assert.rejects(store.persistReviewCandidate({ candidate: c, parentCanonicalRecordId: parent.id }), code("lineage_mismatch"));
});
test("S3B PostgreSQL terminal uniqueness is enforced directly by DB", async () => {
  const c = await persist(profileId()); await store.recordReviewDecision(c.id, lifecycleDecision(c.candidate, "REJECT"));
  await assert.rejects(connection`INSERT INTO language_profile_v2_decisions (profile_id,candidate_record_id,action,decision_json)
    VALUES (${c.profileId},${c.id},'REJECT',${JSON.stringify(lifecycleDecision(c.candidate, "REJECT"))}::jsonb)`, sqlCode("23505", "lpv2_decisions_terminal_unique"));
});
test("S3B PostgreSQL ACCEPT without canonical cannot commit", async () => {
  const c = await persist(profileId());
  await assert.rejects(connection.begin(async (tx) => {
    await tx`INSERT INTO language_profile_v2_decisions (profile_id,candidate_record_id,action,decision_json,canonical_record_id)
      VALUES (${c.profileId},${c.id},'ACCEPT',${JSON.stringify(lifecycleDecision(c.candidate))}::jsonb,${randomUUID()})`;
  }), sqlCode("23503", "lpv2_decisions_canonical_fk"));
  assert.equal(await store.getReviewDecision(c.id), null);
});
test("S3B PostgreSQL canonical without ACCEPT cannot be inserted", async () => {
  const c = await persist(profileId()), r = c.candidate.snapshot;
  await assert.rejects(connection`INSERT INTO language_profile_v2_canonicals
    (profile_id,version,schema_version,contract_version,status,snapshot_json,content_sha256,candidate_record_id,decision_record_id)
    VALUES (${c.profileId},${r.version},${r.schemaVersion},${r.contractVersion},'canonical',${c.candidate.snapshotJson},${r.contentSha256},${c.id},${randomUUID()})`, sqlCode("23503"));
});
test("S3B PostgreSQL canonical version uniqueness rejects historical reuse at service and DB", async () => {
  const a = await bootstrap(), bCandidate = await persist(a.profileId, "2.0.0", a);
  const b = (await store.recordReviewDecision(bCandidate.id, lifecycleDecision(bCandidate.candidate))).canonical!;
  const c = await persist(a.profileId, "1.0.0", b);
  await assert.rejects(store.recordReviewDecision(c.id, lifecycleDecision(c.candidate)), code("canonical_version_exists"));
  const outcome = reviewProfileCandidateV2(c.candidate, lifecycleDecision(c.candidate), JSON.parse(b.snapshotJson));
  assert.ok(outcome.ok && outcome.outcome === "accepted");
  const r = outcome.canonical.snapshot, canonicalId = randomUUID();
  await assert.rejects(connection.begin(async (tx) => {
    const [d] = await tx`INSERT INTO language_profile_v2_decisions (profile_id,candidate_record_id,action,decision_json,canonical_record_id)
      VALUES (${a.profileId},${c.id},'ACCEPT',${JSON.stringify(outcome.decision)}::jsonb,${canonicalId}) RETURNING id`;
    await tx`INSERT INTO language_profile_v2_canonicals
      (id,profile_id,version,schema_version,contract_version,status,snapshot_json,content_sha256,candidate_record_id,decision_record_id,parent_canonical_record_id)
      VALUES (${canonicalId},${a.profileId},${r.version},${r.schemaVersion},${r.contractVersion},'canonical',${outcome.canonical.snapshotJson},${r.contentSha256},${c.id},${d!.id},${b.id})`;
  }), sqlCode("23505", "lpv2_canonicals_version_unique"));
  assert.equal(await store.getReviewDecision(c.id), null);
  const other = await bootstrap(); assert.equal(other.snapshot.version, a.snapshot.version);
});
test("S3B PostgreSQL failure during second ACCEPT write rolls back the decision", async () => {
  const id = "test.s3b.rollback", c = await persist(id);
  // Fault injection only in this isolated database; no trigger or production change.
  await connection.unsafe("ALTER TABLE language_profile_v2_canonicals ADD CONSTRAINT lpv2_test_second_write_failure CHECK (profile_id <> 'test.s3b.rollback')");
  await assert.rejects(store.recordReviewDecision(c.id, lifecycleDecision(c.candidate)));
  assert.deepEqual(await counts(id), { candidates: 1, decisions: 0, canonicals: 0 });
});
for (const field of ["content_sha256", "snapshot_json", "lineage"] as const) {
  test(`S3B PostgreSQL reader rejects corrupted ${field}`, async () => {
    const c = await persist(profileId());
    if (field === "content_sha256") await connection`UPDATE language_profile_v2_candidates SET content_sha256=${'0'.repeat(64)} WHERE id=${c.id}`;
    else if (field === "snapshot_json") await connection`UPDATE language_profile_v2_candidates SET snapshot_json='{}' WHERE id=${c.id}`;
    else await connection`UPDATE language_profile_v2_candidates SET lineage='{}'::jsonb WHERE id=${c.id}`;
    await assert.rejects(store.getReviewCandidate(c.id), code("storage_integrity"));
    await assert.rejects(store.recordReviewDecision(c.id, lifecycleDecision(c.candidate)), code("storage_integrity"));
    assert.equal((await counts(c.profileId)).decisions, 0);
  });
}
test("S3B PostgreSQL invalid lifecycle is blocked by DB CHECK", async () => {
  const c = await persist(profileId());
  await assert.rejects(connection`UPDATE language_profile_v2_candidates SET status='canonical' WHERE id=${c.id}`, sqlCode("23514"));
  assert.deepEqual(await store.getReviewCandidate(c.id), c);
});
