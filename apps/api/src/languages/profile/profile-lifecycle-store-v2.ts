import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { dbTimestamp } from "../../db/timestamps.js";
import { domainIdSchema, semanticVersionSchema } from "../curriculum/primitives.js";
import {
  reviewProfileCandidateV2, validateProfileReviewCandidateV2,
  type ProfileReviewCandidateV2, type ProfileReviewDecisionV2,
  type ProfileSnapshotRefV2, type ProfileReviewOutcomeV2, type ProfileLifecycleErrorV2,
} from "./profile-lifecycle-v2.js";

export type ProfileLifecycleStoreErrorCode = ProfileLifecycleErrorV2 |
  "invalid_record_id" | "candidate_not_found" | "parent_not_found" |
  "decision_already_recorded" | "canonical_version_exists" | "stale_parent" | "storage_integrity";
export class ProfileLifecycleStoreError extends Error {
  constructor(readonly code: ProfileLifecycleStoreErrorCode) {
    super(code);
    this.name = "ProfileLifecycleStoreError";
  }
}
function problem(code: ProfileLifecycleStoreErrorCode): never { throw new ProfileLifecycleStoreError(code); }
const baseRow = z.object({
  id: z.string().uuid(), event_sequence: z.string().regex(/^[1-9]\d*$/u),
  profile_id: domainIdSchema,
  created_at: z.union([z.date(), z.string()]).transform(dbTimestamp),
});
const snapshotFields = {
  version: semanticVersionSchema, schema_version: z.literal("2.0.0"), contract_version: z.literal("1.0.0"),
  snapshot_json: z.string(), content_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  parent_canonical_record_id: z.string().uuid().nullable(),
};
const candidateRow = baseRow.extend({
  ...snapshotFields, status: z.literal("review"), candidate_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  lineage: z.unknown(),
}).strict();
const decisionRow = baseRow.extend({
  candidate_record_id: z.string().uuid(), action: z.enum(["ACCEPT", "REJECT"]),
  decision_json: z.unknown(), canonical_record_id: z.string().uuid().nullable(),
}).strict();
const canonicalRow = baseRow.extend({
  ...snapshotFields, status: z.literal("canonical"), candidate_record_id: z.string().uuid(), decision_record_id: z.string().uuid(),
}).strict();
type RecordMetadata = { id: string; eventSequence: string; profileId: string; createdAt: Date };
export type ProfileCandidateRecordV2 = RecordMetadata & {
  kind: "candidate"; parentCanonicalRecordId: string | null; candidate: ProfileReviewCandidateV2;
};
export type ProfileDecisionRecordV2 = RecordMetadata & {
  kind: "decision"; candidateRecordId: string; canonicalRecordId: string | null; decision: ProfileReviewDecisionV2;
};
export type ProfileCanonicalRecordV2 = RecordMetadata & {
  kind: "canonical"; candidateRecordId: string; decisionRecordId: string; parentCanonicalRecordId: string | null;
  snapshotJson: string; snapshot: ProfileSnapshotRefV2;
};
export type ProfileHistoryEventV2 = ProfileCandidateRecordV2 | ProfileDecisionRecordV2 | ProfileCanonicalRecordV2;
type SuccessfulReview = Extract<ProfileReviewOutcomeV2, { ok: true }>;

function metadata(row: z.infer<typeof baseRow>): RecordMetadata {
  return { id: row.id, eventSequence: row.event_sequence, profileId: row.profile_id, createdAt: row.created_at };
}
function ref(row: z.infer<typeof candidateRow> | z.infer<typeof canonicalRow>) {
  return { profileId: row.profile_id, version: row.version, schemaVersion: row.schema_version,
    contractVersion: row.contract_version, status: row.status, contentSha256: row.content_sha256 };
}

/** Reconstruct the complete profile history from untrusted DB rows. S3A checks
 * shapes, hashes, decisions and transformations; this layer checks durable links
 * and order. Exported separately for corruption tests, with no write capability.
 */
export function decodeProfileHistoryV2(profileId: string, rows: {
  candidates: unknown; decisions: unknown; canonicals: unknown;
}): ProfileHistoryEventV2[] {
  try {
    const candidates = z.array(candidateRow).parse(rows.candidates);
    const decisions = z.array(decisionRow).parse(rows.decisions);
    const canonicals = z.array(canonicalRow).parse(rows.canonicals);
    const events = [
      ...candidates.map((row) => ({ kind: "candidate" as const, row })),
      ...decisions.map((row) => ({ kind: "decision" as const, row })),
      ...canonicals.map((row) => ({ kind: "canonical" as const, row })),
    ].sort((a, b) => BigInt(a.row.event_sequence) < BigInt(b.row.event_sequence) ? -1 : 1);
    const result: ProfileHistoryEventV2[] = [];
    const candidateRecords = new Map<string, ProfileCandidateRecordV2>();
    const canonicalRecords = new Map<string, ProfileCanonicalRecordV2>();
    const reviewed = new Map<string, { record: ProfileDecisionRecordV2; outcome: SuccessfulReview }>();
    const ids = new Set<string>(), sequences = new Set<string>(), contexts = new Set<string>(), versions = new Set<string>();
    let current: ProfileCanonicalRecordV2 | null = null;
    for (const event of events) {
      const { row } = event;
      if (row.profile_id !== profileId || ids.has(row.id) || sequences.has(row.event_sequence)) problem("storage_integrity");
      ids.add(row.id); sequences.add(row.event_sequence);
      if (event.kind === "candidate") {
        const row = event.row;
        const parent = row.parent_canonical_record_id === null ? null : canonicalRecords.get(row.parent_canonical_record_id);
        if (parent === undefined) problem("storage_integrity");
        const checked = validateProfileReviewCandidateV2({
          candidateSha256: row.candidate_sha256, snapshotJson: row.snapshot_json,
          snapshot: ref(row), lineage: row.lineage,
        }, parent === null ? null : JSON.parse(parent.snapshotJson));
        if (!checked.ok || contexts.has(row.candidate_sha256)) problem("storage_integrity");
        contexts.add(row.candidate_sha256);
        const record: ProfileCandidateRecordV2 = { ...metadata(row), kind: "candidate",
          parentCanonicalRecordId: row.parent_canonical_record_id, candidate: checked.candidate };
        candidateRecords.set(row.id, record); result.push(record);
      } else if (event.kind === "decision") {
        const row = event.row, candidate = candidateRecords.get(row.candidate_record_id);
        if (!candidate || reviewed.has(row.candidate_record_id) || candidate.parentCanonicalRecordId !== (current?.id ?? null)) problem("storage_integrity");
        const outcome = reviewProfileCandidateV2(candidate.candidate, row.decision_json, current === null ? null : JSON.parse(current.snapshotJson));
        if (!outcome.ok || outcome.decision.decision !== row.action || (row.action === "ACCEPT") !== (row.canonical_record_id !== null)) problem("storage_integrity");
        const record: ProfileDecisionRecordV2 = { ...metadata(row), kind: "decision", candidateRecordId: row.candidate_record_id,
          canonicalRecordId: row.canonical_record_id, decision: outcome.decision };
        reviewed.set(row.candidate_record_id, { record, outcome }); result.push(record);
      } else {
        const row = event.row, candidate = candidateRecords.get(row.candidate_record_id), review = reviewed.get(row.candidate_record_id);
        if (!candidate || !review || review.outcome.outcome !== "accepted" ||
          review.record.id !== row.decision_record_id || review.record.canonicalRecordId !== row.id ||
          row.parent_canonical_record_id !== candidate.parentCanonicalRecordId || row.parent_canonical_record_id !== (current?.id ?? null) ||
          versions.has(row.version)) problem("storage_integrity");
        const expected = review.outcome.canonical;
        if (row.snapshot_json !== expected.snapshotJson || JSON.stringify(ref(row)) !== JSON.stringify(expected.snapshot)) problem("storage_integrity");
        versions.add(row.version);
        const record: ProfileCanonicalRecordV2 = { ...metadata(row), kind: "canonical", candidateRecordId: row.candidate_record_id,
          decisionRecordId: row.decision_record_id, parentCanonicalRecordId: row.parent_canonical_record_id,
          snapshotJson: expected.snapshotJson, snapshot: expected.snapshot };
        current = record; canonicalRecords.set(row.id, record); result.push(record);
      }
    }
    for (const { record } of reviewed.values()) {
      if (record.canonicalRecordId !== null && !canonicalRecords.has(record.canonicalRecordId)) problem("storage_integrity");
    }
    return result;
  } catch {
    return problem("storage_integrity");
  }
}

type Database = ReturnType<typeof getDb>;
type Executor = Pick<Database, "execute">;
async function history(db: Executor, profileId: string) {
  const candidates = await db.execute(sql`SELECT * FROM language_profile_v2_candidates WHERE profile_id=${profileId}`);
  const decisions = await db.execute(sql`SELECT * FROM language_profile_v2_decisions WHERE profile_id=${profileId}`);
  const canonicals = await db.execute(sql`SELECT * FROM language_profile_v2_canonicals WHERE profile_id=${profileId}`);
  return decodeProfileHistoryV2(profileId, { candidates, decisions, canonicals });
}
const currentOf = (events: ProfileHistoryEventV2[]) => events.filter((e): e is ProfileCanonicalRecordV2 => e.kind === "canonical").at(-1) ?? null;
function recordId(input: string) {
  if (!z.string().uuid().safeParse(input).success) problem("invalid_record_id");
  return input.toLowerCase();
}
async function lockProfile(db: Executor, profileId: string) {
  // READ COMMITTED is explicit on writes: after waiting, the next statement sees
  // the winning commit. Hash collisions only serialize unrelated profiles.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'language-profile-v2:' + profileId}, 0))`);
}
async function lookupProfile(db: Executor, kind: "candidate" | "canonical", id: string): Promise<string | null> {
  const result = kind === "candidate"
    ? await db.execute(sql`SELECT profile_id FROM language_profile_v2_candidates WHERE id=${recordId(id)}`)
    : await db.execute(sql`SELECT profile_id FROM language_profile_v2_canonicals WHERE id=${recordId(id)}`);
  const parsed = z.array(z.object({ profile_id: domainIdSchema }).strict()).safeParse(result);
  if (!parsed.success) return problem("storage_integrity");
  return parsed.data[0]?.profile_id ?? null;
}

/** Internal transactional repository/service boundary. No caller can assemble
 * ACCEPT from independent writes. No auth or production connection is inferred
 * until a method is explicitly invoked; tests inject an isolated Drizzle DB.
 */
export class ProfileLifecycleStoreV2 {
  constructor(private readonly database: () => Pick<Database, "transaction"> = getDb) {}

  async persistReviewCandidate(input: { candidate: unknown; parentCanonicalRecordId: string | null }): Promise<ProfileCandidateRecordV2> {
    // Read only enough shape to choose the lock; the full S3A validator is still
    // authoritative after loading the durable parent.
    const identity = z.object({ snapshot: z.object({ profileId: domainIdSchema }) }).safeParse(input.candidate);
    if (!identity.success) return problem("candidate_invalid");
    const profileId = identity.data.snapshot.profileId;
    return this.database().transaction(async (tx) => {
      await lockProfile(tx, profileId);
      const events = await history(tx, profileId), current = currentOf(events);
      const parentId = input.parentCanonicalRecordId === null ? null : recordId(input.parentCanonicalRecordId);
      const parent = parentId === null ? null : events.find((e): e is ProfileCanonicalRecordV2 => e.kind === "canonical" && e.id === parentId);
      if (parent === undefined) return problem("parent_not_found");
      const checked = validateProfileReviewCandidateV2(input.candidate, parent === null ? null : JSON.parse(parent.snapshotJson));
      if (!checked.ok) return problem(checked.code);
      const candidate = checked.candidate;
      const existing = events.find((e): e is ProfileCandidateRecordV2 => e.kind === "candidate" && e.candidate.candidateSha256 === candidate.candidateSha256);
      if (existing) {
        if (existing.parentCanonicalRecordId !== parentId) return problem("lineage_mismatch");
        return existing;
      }
      if (parentId !== (current?.id ?? null)) return problem("stale_parent");
      const r = candidate.snapshot;
      const inserted = await tx.execute(sql`INSERT INTO language_profile_v2_candidates
        (profile_id, version, schema_version, contract_version, status, snapshot_json, content_sha256, candidate_sha256, lineage, parent_canonical_record_id)
        VALUES (${r.profileId},${r.version},${r.schemaVersion},${r.contractVersion},${r.status},${candidate.snapshotJson},${r.contentSha256},
          ${candidate.candidateSha256},${JSON.stringify(candidate.lineage)}::jsonb,${parentId}) RETURNING *`);
      const row = candidateRow.parse(inserted[0]);
      return { ...metadata(row), kind: "candidate" as const, parentCanonicalRecordId: parentId, candidate };
    }, { isolationLevel: "read committed" });
  }

  async recordReviewDecision(candidateRecordId: string, decision: unknown): Promise<{
    decision: ProfileDecisionRecordV2; canonical: ProfileCanonicalRecordV2 | null;
  }> {
    candidateRecordId = recordId(candidateRecordId);
    return this.database().transaction(async (tx) => {
      const profileId = await lookupProfile(tx, "candidate", candidateRecordId);
      if (profileId === null) return problem("candidate_not_found");
      await lockProfile(tx, profileId);
      const events = await history(tx, profileId);
      const candidate = events.find((e): e is ProfileCandidateRecordV2 => e.kind === "candidate" && e.id === candidateRecordId);
      if (!candidate) return problem("candidate_not_found");
      if (events.some((e) => e.kind === "decision" && e.candidateRecordId === candidateRecordId)) return problem("decision_already_recorded");
      const current = currentOf(events);
      if (candidate.parentCanonicalRecordId !== (current?.id ?? null)) return problem("stale_parent");
      const outcome = reviewProfileCandidateV2(candidate.candidate, decision, current === null ? null : JSON.parse(current.snapshotJson));
      if (!outcome.ok) return problem(outcome.code);
      if (outcome.outcome === "accepted" && events.some((e) => e.kind === "canonical" && e.snapshot.version === outcome.canonical.snapshot.version)) {
        return problem("canonical_version_exists");
      }
      const canonicalId = outcome.outcome === "accepted" ? randomUUID() : null;
      const inserted = await tx.execute(sql`INSERT INTO language_profile_v2_decisions
        (profile_id, candidate_record_id, action, decision_json, canonical_record_id)
        VALUES (${profileId},${candidateRecordId},${outcome.decision.decision},${JSON.stringify(outcome.decision)}::jsonb,${canonicalId}) RETURNING *`);
      const decisionRowData = decisionRow.parse(inserted[0]);
      const decisionRecord: ProfileDecisionRecordV2 = { ...metadata(decisionRowData), kind: "decision",
        candidateRecordId, canonicalRecordId: canonicalId, decision: outcome.decision };
      let canonical: ProfileCanonicalRecordV2 | null = null;
      if (outcome.outcome === "accepted") {
        const r = outcome.canonical.snapshot;
        const insertedCanonical = await tx.execute(sql`INSERT INTO language_profile_v2_canonicals
          (id, profile_id, version, schema_version, contract_version, status, snapshot_json, content_sha256,
            candidate_record_id, decision_record_id, parent_canonical_record_id)
          VALUES (${canonicalId},${profileId},${r.version},${r.schemaVersion},${r.contractVersion},${r.status},${outcome.canonical.snapshotJson},
            ${r.contentSha256},${candidateRecordId},${decisionRecord.id},${candidate.parentCanonicalRecordId}) RETURNING *`);
        const row = canonicalRow.parse(insertedCanonical[0]);
        canonical = { ...metadata(row), kind: "canonical", candidateRecordId, decisionRecordId: decisionRecord.id,
          parentCanonicalRecordId: candidate.parentCanonicalRecordId, ...outcome.canonical };
      }
      return { decision: decisionRecord, canonical };
    }, { isolationLevel: "read committed" });
  }

  async listProfileHistory(profileId: string): Promise<ProfileHistoryEventV2[]> {
    const parsed = domainIdSchema.safeParse(profileId);
    if (!parsed.success) return problem("lineage_mismatch");
    return this.database().transaction((tx) => history(tx, parsed.data), { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  async getCurrentCanonical(profileId: string) { return currentOf(await this.listProfileHistory(profileId)); }
  private async readRecord(kind: "candidate" | "canonical", id: string): Promise<ProfileHistoryEventV2[]> {
    return this.database().transaction(async (tx) => {
      const profileId = await lookupProfile(tx, kind, id);
      return profileId === null ? [] : history(tx, profileId);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  async getReviewCandidate(id: string) {
    id = recordId(id);
    return (await this.readRecord("candidate", id)).find((e): e is ProfileCandidateRecordV2 => e.kind === "candidate" && e.id === id) ?? null;
  }
  async getReviewDecision(candidateRecordId: string) {
    candidateRecordId = recordId(candidateRecordId);
    return (await this.readRecord("candidate", candidateRecordId)).find((e): e is ProfileDecisionRecordV2 => e.kind === "decision" && e.candidateRecordId === candidateRecordId) ?? null;
  }
  async getCanonical(id: string) {
    id = recordId(id);
    return (await this.readRecord("canonical", id)).find((e): e is ProfileCanonicalRecordV2 => e.kind === "canonical" && e.id === id) ?? null;
  }
}
