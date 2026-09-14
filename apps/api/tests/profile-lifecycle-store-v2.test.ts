import assert from "node:assert/strict";
import test from "node:test";
import { decodeProfileHistoryV2, ProfileLifecycleStoreError, ProfileLifecycleStoreV2 } from "../src/languages/profile/profile-lifecycle-store-v2.js";
import { reviewProfileCandidateV2, validateProfileReviewCandidateV2 } from "../src/languages/profile/profile-lifecycle-v2.js";
import { lifecycleCandidate, lifecycleDecision } from "./fixtures/profile-lifecycle-v2.js";

const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"] as const;
function storedBootstrap() {
  const candidate = lifecycleCandidate(), decision = lifecycleDecision(candidate);
  const outcome = reviewProfileCandidateV2(candidate, decision, null);
  assert.ok(outcome.ok && outcome.outcome === "accepted");
  const meta = { profile_id: "test.persistence", created_at: "2026-09-13T00:00:00Z" };
  const row = { ...meta, version: "1.0.0", schema_version: "2.0.0", contract_version: "1.0.0", parent_canonical_record_id: null };
  return {
    candidates: [{ ...row, id: ids[0], event_sequence: "1", status: "review", snapshot_json: candidate.snapshotJson,
      content_sha256: candidate.snapshot.contentSha256, candidate_sha256: candidate.candidateSha256, lineage: structuredClone(candidate.lineage) }],
    decisions: [{ ...meta, id: String(ids[1]), event_sequence: "2", candidate_record_id: ids[0], action: "ACCEPT", decision_json: decision, canonical_record_id: ids[2] }],
    canonicals: [{ ...row, id: ids[2], event_sequence: "3", status: "canonical", snapshot_json: outcome.canonical.snapshotJson,
      content_sha256: outcome.canonical.snapshot.contentSha256, candidate_record_id: ids[0], decision_record_id: ids[1] }],
  };
}
function corrupt(rows: unknown) {
  assert.throws(() => decodeProfileHistoryV2("test.persistence", rows as ReturnType<typeof storedBootstrap>),
    (error) => error instanceof ProfileLifecycleStoreError && error.code === "storage_integrity");
}

test("S3B reads exact S3A snapshots after JSONB metadata property reordering", () => {
  const rows = storedBootstrap();
  const d = rows.decisions[0]!;
  d.decision_json = Object.fromEntries(Object.entries(d.decision_json).reverse()) as typeof d.decision_json;
  const before = structuredClone(rows), result = decodeProfileHistoryV2("test.persistence", rows);
  assert.deepEqual(result.map((e) => e.kind), ["candidate", "decision", "canonical"]);
  const first = result[0]!;
  assert.ok(first.kind === "candidate");
  assert.equal(first.candidate.snapshotJson, rows.candidates[0]!.snapshot_json);
  assert.deepEqual(rows, before);
});
test("S3B reads durable bigint order without rounding or caller timestamp ordering", () => {
  const rows = storedBootstrap();
  rows.candidates[0]!.event_sequence = "9007199254740993";
  rows.decisions[0]!.event_sequence = "9007199254740994";
  rows.canonicals[0]!.event_sequence = "9007199254740995";
  rows.decisions[0]!.decision_json.decidedAt = "1990-01-01T00:00:00Z";
  assert.deepEqual(decodeProfileHistoryV2("test.persistence", rows).map((e) => e.eventSequence),
    ["9007199254740993", "9007199254740994", "9007199254740995"]);
});
for (const field of ["content_sha256", "candidate_sha256", "snapshot_json", "version", "status"] as const) {
  test(`S3B corrupt candidate ${field} fails closed`, () => {
    const rows = storedBootstrap(); rows.candidates[0]![field] = "corrupted"; corrupt(rows);
  });
}
test("S3B malformed JSONB lineage fails closed", () => {
  const rows = storedBootstrap(); Reflect.set(rows.candidates[0]!, "lineage", { origin: null }); corrupt(rows);
});
test("S3B decision mismatched hashes fail closed", () => {
  const rows = storedBootstrap(); rows.decisions[0]!.decision_json.contentSha256 = "0".repeat(64); corrupt(rows);
});
test("S3B decision action cannot differ from S3A payload", () => {
  const rows = storedBootstrap(); rows.decisions[0]!.action = "REJECT"; corrupt(rows);
});
test("S3B canonical content cannot differ from accepted transformation", () => {
  const rows = storedBootstrap(); rows.canonicals[0]!.snapshot_json = rows.canonicals[0]!.snapshot_json.replace("Synthetic language", "Tampered language"); corrupt(rows);
});
test("S3B ACCEPT with missing canonical fails closed", () => {
  const rows = storedBootstrap(); rows.canonicals = []; corrupt(rows);
});
test("S3B canonical without decision fails closed", () => {
  const rows = storedBootstrap(); rows.decisions = []; corrupt(rows);
});
test("S3B duplicate terminal rows fail closed", () => {
  const rows = storedBootstrap(); rows.decisions.push({ ...rows.decisions[0]!, id: "00000000-0000-4000-8000-000000000004", event_sequence: "4" }); corrupt(rows);
});
test("S3B duplicate event ordering fails closed", () => {
  const rows = storedBootstrap(); rows.decisions[0]!.event_sequence = "1"; corrupt(rows);
});
test("S3B foreign profile rows fail closed", () => {
  const rows = storedBootstrap(); rows.canonicals[0]!.profile_id = "test.foreign"; corrupt(rows);
});
test("S3B missing or incorrect parent references fail closed", () => {
  const rows = storedBootstrap(); Reflect.set(rows.candidates[0]!, "parent_canonical_record_id", ids[2]); corrupt(rows);
});
test("S3B invalid candidate identity does not open a DB connection", async () => {
  const store = new ProfileLifecycleStoreV2(() => { throw new Error("must not connect"); });
  await assert.rejects(store.persistReviewCandidate({ candidate: {}, parentCanonicalRecordId: null }),
    (e) => e instanceof ProfileLifecycleStoreError && e.code === "candidate_invalid");
});
test("S3A reusable candidate validator needs no synthetic decision and preserves inputs", () => {
  const candidate = lifecycleCandidate(), before = structuredClone(candidate);
  const checked = validateProfileReviewCandidateV2(candidate, null);
  assert.ok(checked.ok); assert.deepEqual(checked.candidate, before); assert.deepEqual(candidate, before);
  assert.ok(Object.isFrozen(checked.candidate.lineage.origin));
  assert.equal("decision" in checked, false); assert.equal("canonical" in checked, false);
});
test("S3A reusable validation rejects the same snapshot corruption as review", () => {
  const candidate = lifecycleCandidate(), changed = { ...candidate, snapshotJson: "{}" };
  const checked = validateProfileReviewCandidateV2(changed, null);
  assert.ok(!checked.ok); assert.equal(checked.code, "snapshot_mismatch");
});
