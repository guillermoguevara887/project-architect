import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { dbTimestamp, type DbTimestamp } from "../../db/timestamps.js";
import {
  validateCurriculumUnitSpec,
  type CurriculumUnitSpec,
} from "../curriculum/curriculum-unit-spec.js";

export const curriculumUnitReviewInputSchema = z
  .object({
    action: z.enum(["accept", "reject"]),
    note: z.string().trim().min(1),
  })
  .strict();
export type CurriculumUnitReviewInput = z.infer<typeof curriculumUnitReviewInputSchema>;

export type CurriculumUnitReviewRecord = {
  id: string;
  userId: string;
  sourceUnitRecordId: string;
  action: "accepted" | "rejected";
  reviewNote: string;
  promotedSpec: CurriculumUnitSpec | null;
  promotedSpecSha256: string | null;
  reviewedAt: Date;
};

type OwnedReviewCandidate = {
  sourceUnitRecordId: string;
  spec: CurriculumUnitSpec;
};

export interface CurriculumUnitReviewStore {
  findOwnedCandidate(userId: string, unitRecordId: string): Promise<OwnedReviewCandidate | null>;
  createReview(input: {
    userId: string;
    sourceUnitRecordId: string;
    action: CurriculumUnitReviewRecord["action"];
    reviewNote: string;
    promotedSpec: CurriculumUnitSpec | null;
    promotedSpecSha256: string | null;
  }): Promise<CurriculumUnitReviewRecord | null>;
  findReview(userId: string, unitRecordId: string): Promise<CurriculumUnitReviewRecord | null>;
}

type DbReview = {
  id: string;
  user_id: string;
  source_unit_record_id: string;
  action: "accepted" | "rejected";
  review_note: string;
  promoted_spec: CurriculumUnitSpec | null;
  promoted_spec_sha256: string | null;
  reviewed_at: DbTimestamp;
};

function rows<T>(value: unknown) {
  return value as T[];
}

function mapReview(row: DbReview): CurriculumUnitReviewRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceUnitRecordId: row.source_unit_record_id,
    action: row.action,
    reviewNote: row.review_note,
    promotedSpec: row.promoted_spec,
    promotedSpecSha256: row.promoted_spec_sha256,
    reviewedAt: dbTimestamp(row.reviewed_at),
  };
}

export const curriculumUnitReviewStore: CurriculumUnitReviewStore = {
  async findOwnedCandidate(userId, unitRecordId) {
    const result = rows<{ source_unit_record_id: string; spec: CurriculumUnitSpec }>(
      await getDb().execute(sql`
        SELECT unit.id AS source_unit_record_id, unit.spec
        FROM language_curriculum_units unit
        JOIN language_curriculum_compilation_runs compilation
          ON compilation.id = unit.compilation_run_id
        JOIN language_curriculum_document_versions version
          ON version.id = compilation.document_version_id
        JOIN language_curriculum_documents document
          ON document.id = version.document_record_id
        WHERE unit.id = ${unitRecordId}
          AND document.user_id = ${userId}
        LIMIT 1
      `),
    );
    const record = result[0];
    return record
      ? { sourceUnitRecordId: record.source_unit_record_id, spec: record.spec }
      : null;
  },

  async createReview(input) {
    const result = rows<DbReview>(await getDb().execute(sql`
      INSERT INTO language_curriculum_unit_reviews (
        user_id,
        source_unit_record_id,
        action,
        review_note,
        promoted_spec,
        promoted_spec_sha256
      )
      SELECT
        ${input.userId},
        unit.id,
        ${input.action},
        ${input.reviewNote},
        ${input.promotedSpec ? JSON.stringify(input.promotedSpec) : null}::jsonb,
        ${input.promotedSpecSha256}
      FROM language_curriculum_units unit
      JOIN language_curriculum_compilation_runs compilation
        ON compilation.id = unit.compilation_run_id
      JOIN language_curriculum_document_versions version
        ON version.id = compilation.document_version_id
      JOIN language_curriculum_documents document
        ON document.id = version.document_record_id
      WHERE unit.id = ${input.sourceUnitRecordId}
        AND document.user_id = ${input.userId}
      ON CONFLICT (source_unit_record_id) DO NOTHING
      RETURNING *
    `));
    return result[0] ? mapReview(result[0]) : null;
  },

  async findReview(userId, unitRecordId) {
    const result = rows<DbReview>(await getDb().execute(sql`
      SELECT *
      FROM language_curriculum_unit_reviews
      WHERE user_id = ${userId}
        AND source_unit_record_id = ${unitRecordId}
      LIMIT 1
    `));
    return result[0] ? mapReview(result[0]) : null;
  },
};

export type CurriculumUnitReviewServiceErrorCode =
  | "candidate_not_found"
  | "candidate_not_review"
  | "candidate_invalid"
  | "already_reviewed"
  | "promotion_invalid";

export class CurriculumUnitReviewServiceError extends Error {
  constructor(readonly code: CurriculumUnitReviewServiceErrorCode, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "CurriculumUnitReviewServiceError";
  }
}

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function bumpPatch(version: string) {
  const base = version.split(/[+-]/u, 1)[0] ?? version;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(base);
  if (!match) throw new CurriculumUnitReviewServiceError("promotion_invalid", "invalid_source_semver");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function issueSummary(result: ReturnType<typeof validateCurriculumUnitSpec>) {
  return result.issues
    .slice(0, 8)
    .map((issue) => `${issue.code}@${issue.path}: ${issue.message}`)
    .join(" | ");
}

export class CurriculumUnitReviewService {
  constructor(private readonly store: CurriculumUnitReviewStore = curriculumUnitReviewStore) {}

  async review(userId: string, unitRecordId: string, rawInput: CurriculumUnitReviewInput) {
    const input = curriculumUnitReviewInputSchema.parse(rawInput);
    const candidate = await this.store.findOwnedCandidate(userId, unitRecordId);
    if (!candidate) throw new CurriculumUnitReviewServiceError("candidate_not_found");

    const existing = await this.store.findReview(userId, unitRecordId);
    if (existing) throw new CurriculumUnitReviewServiceError("already_reviewed", existing.action);

    const sourceValidation = validateCurriculumUnitSpec(candidate.spec);
    if (!sourceValidation.valid) {
      throw new CurriculumUnitReviewServiceError("candidate_invalid", issueSummary(sourceValidation));
    }
    if (candidate.spec.status !== "review") {
      throw new CurriculumUnitReviewServiceError("candidate_not_review", candidate.spec.status);
    }

    if (input.action === "reject") {
      const rejected = await this.store.createReview({
        userId,
        sourceUnitRecordId: unitRecordId,
        action: "rejected",
        reviewNote: input.note,
        promotedSpec: null,
        promotedSpecSha256: null,
      });
      if (!rejected) throw new CurriculumUnitReviewServiceError("already_reviewed");
      return rejected;
    }

    const promoted = structuredClone(candidate.spec);
    promoted.specVersion = bumpPatch(candidate.spec.specVersion);
    promoted.status = "canonical";
    const promotedValidation = validateCurriculumUnitSpec(promoted);
    if (!promotedValidation.valid) {
      throw new CurriculumUnitReviewServiceError("promotion_invalid", issueSummary(promotedValidation));
    }

    const accepted = await this.store.createReview({
      userId,
      sourceUnitRecordId: unitRecordId,
      action: "accepted",
      reviewNote: input.note,
      promotedSpec: promoted,
      promotedSpecSha256: sha(promoted),
    });
    if (!accepted) throw new CurriculumUnitReviewServiceError("already_reviewed");
    return accepted;
  }

  async getReview(userId: string, unitRecordId: string) {
    return this.store.findReview(userId, unitRecordId);
  }
}

export const curriculumUnitReviewService = new CurriculumUnitReviewService();
