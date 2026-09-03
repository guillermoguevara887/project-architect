import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import type { CandidateValidationAttempt } from "../ai/structured-candidate-boundary.js";
import type { LanguageProfileResearchCandidate } from "./contracts.js";

export type ProfileResearchRunStage = "completed" | "needs_review" | "failed";

export type ProfileResearchRunRecord = {
  id: string;
  userId: string;
  adaptationResolutionRunId: string;
  resumedResolutionRunId: string | null;
  baseProfileRecordId: string;
  enrichedProfileRecordId: string | null;
  stage: ProfileResearchRunStage;
  researchTaskRefs: string[];
  candidate: LanguageProfileResearchCandidate | null;
  observedUrls: string[];
  providerModel: string | null;
  validationHistory: CandidateValidationAttempt[];
  detail: string | null;
  contentSha256: string;
  createdAt: Date;
};

export interface ProfileResearchStore {
  createRun(input: Omit<ProfileResearchRunRecord, "id" | "createdAt">): Promise<ProfileResearchRunRecord | null>;
  findRunForUser(userId: string, runId: string): Promise<ProfileResearchRunRecord | null>;
}

type DbRun = {
  id: string;
  user_id: string;
  adaptation_resolution_run_id: string;
  resumed_resolution_run_id: string | null;
  base_profile_record_id: string;
  enriched_profile_record_id: string | null;
  stage: ProfileResearchRunStage;
  research_task_refs: string[];
  candidate: LanguageProfileResearchCandidate | null;
  observed_urls: string[];
  provider_model: string | null;
  validation_history: CandidateValidationAttempt[];
  detail: string | null;
  content_sha256: string;
  created_at: Date;
};

function rows<T>(value: unknown) {
  return value as T[];
}

function mapRun(row: DbRun): ProfileResearchRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    adaptationResolutionRunId: row.adaptation_resolution_run_id,
    resumedResolutionRunId: row.resumed_resolution_run_id,
    baseProfileRecordId: row.base_profile_record_id,
    enrichedProfileRecordId: row.enriched_profile_record_id,
    stage: row.stage,
    researchTaskRefs: row.research_task_refs,
    candidate: row.candidate,
    observedUrls: row.observed_urls,
    providerModel: row.provider_model,
    validationHistory: row.validation_history,
    detail: row.detail,
    contentSha256: row.content_sha256,
    createdAt: row.created_at,
  };
}

export const profileResearchStore: ProfileResearchStore = {
  async createRun(input) {
    const result = rows<DbRun>(await getDb().execute(sql`
      INSERT INTO language_profile_research_runs (
        user_id,
        adaptation_resolution_run_id,
        resumed_resolution_run_id,
        base_profile_record_id,
        enriched_profile_record_id,
        stage,
        research_task_refs,
        candidate,
        observed_urls,
        provider_model,
        validation_history,
        detail,
        content_sha256
      )
      SELECT
        ${input.userId},
        resolution.id,
        resumed.id,
        base_profile.id,
        enriched_profile.id,
        ${input.stage},
        ${JSON.stringify(input.researchTaskRefs)}::jsonb,
        ${input.candidate ? JSON.stringify(input.candidate) : null}::jsonb,
        ${JSON.stringify(input.observedUrls)}::jsonb,
        ${input.providerModel},
        ${JSON.stringify(input.validationHistory)}::jsonb,
        ${input.detail},
        ${input.contentSha256}
      FROM language_adaptation_resolution_runs resolution
      JOIN language_knowledge_profiles base_profile
        ON base_profile.id = ${input.baseProfileRecordId}
        AND base_profile.user_id = ${input.userId}
      LEFT JOIN language_knowledge_profiles enriched_profile
        ON enriched_profile.id = ${input.enrichedProfileRecordId}
        AND enriched_profile.user_id = ${input.userId}
      LEFT JOIN language_adaptation_resolution_runs resumed
        ON resumed.id = ${input.resumedResolutionRunId}
        AND resumed.user_id = ${input.userId}
        AND resumed.curriculum_unit_record_id = resolution.curriculum_unit_record_id
      WHERE resolution.id = ${input.adaptationResolutionRunId}
        AND resolution.user_id = ${input.userId}
        AND resolution.profile_record_id = base_profile.id
        AND (
          ${input.enrichedProfileRecordId}::uuid IS NULL
          OR enriched_profile.id IS NOT NULL
        )
        AND (
          ${input.resumedResolutionRunId}::uuid IS NULL
          OR resumed.id IS NOT NULL
        )
      RETURNING *
    `));
    return result[0] ? mapRun(result[0]) : null;
  },

  async findRunForUser(userId, runId) {
    const result = rows<DbRun>(await getDb().execute(sql`
      SELECT *
      FROM language_profile_research_runs
      WHERE id = ${runId} AND user_id = ${userId}
      LIMIT 1
    `));
    return result[0] ? mapRun(result[0]) : null;
  },
};
