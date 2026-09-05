import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { dbTimestamp, type DbTimestamp } from "../../db/timestamps.js";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import type { LanguageDecisionRegistry } from "../decisions/language-decision-registry.js";
import type { LanguageProfile } from "../profile/language-profile.js";
import type { AdaptationResolutionStage } from "./adaptation-resolution-runtime.js";

export type AdaptationResolutionContext = {
  curriculumUnitRecordId: string;
  curriculum: CurriculumUnitSpec;
  profileRecordId: string;
  languageProfile: LanguageProfile;
  registryRecordId: string;
  registry: LanguageDecisionRegistry;
};

export type AdaptationResolutionRunRecord = {
  id: string;
  userId: string;
  curriculumUnitRecordId: string;
  profileRecordId: string;
  registryRecordId: string;
  previousRunId: string | null;
  stage: AdaptationResolutionStage | "failed";
  adaptationPlan: AdaptationPlan;
  activeResearchTaskRef: string | null;
  blockedResearchTaskRefs: string[];
  proposalIds: string[];
  detail: string | null;
  contentSha256: string;
  createdAt: Date;
};

export interface AdaptationResolutionStore {
  loadContext(input: {
    userId: string;
    curriculumUnitRecordId: string;
    profileRecordId: string;
    registryRecordId: string;
  }): Promise<AdaptationResolutionContext | null>;
  createRun(input: {
    userId: string;
    context: AdaptationResolutionContext;
    previousRunId?: string | null;
    stage: AdaptationResolutionRunRecord["stage"];
    adaptationPlan: AdaptationPlan;
    activeResearchTaskRef?: string | null;
    blockedResearchTaskRefs?: string[];
    proposalIds?: string[];
    detail?: string | null;
    contentSha256: string;
  }): Promise<AdaptationResolutionRunRecord | null>;
  findRunForUser(
    userId: string,
    runId: string,
  ): Promise<AdaptationResolutionRunRecord | null>;
}

type DbContext = {
  curriculum_unit_record_id: string;
  curriculum: CurriculumUnitSpec;
  profile_record_id: string;
  language_profile: LanguageProfile;
  registry_record_id: string;
  registry: LanguageDecisionRegistry;
};

type DbRun = {
  id: string;
  user_id: string;
  curriculum_unit_record_id: string;
  profile_record_id: string;
  registry_record_id: string;
  previous_run_id: string | null;
  stage: AdaptationResolutionRunRecord["stage"];
  adaptation_plan: AdaptationPlan;
  active_research_task_ref: string | null;
  blocked_research_task_refs: string[];
  proposal_ids: string[];
  detail: string | null;
  content_sha256: string;
  created_at: DbTimestamp;
};

function rows<T>(value: unknown) {
  return value as T[];
}

function mapContext(row: DbContext): AdaptationResolutionContext {
  return {
    curriculumUnitRecordId: row.curriculum_unit_record_id,
    curriculum: row.curriculum,
    profileRecordId: row.profile_record_id,
    languageProfile: row.language_profile,
    registryRecordId: row.registry_record_id,
    registry: row.registry,
  };
}

function mapRun(row: DbRun): AdaptationResolutionRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    curriculumUnitRecordId: row.curriculum_unit_record_id,
    profileRecordId: row.profile_record_id,
    registryRecordId: row.registry_record_id,
    previousRunId: row.previous_run_id,
    stage: row.stage,
    adaptationPlan: row.adaptation_plan,
    activeResearchTaskRef: row.active_research_task_ref,
    blockedResearchTaskRefs: row.blocked_research_task_refs,
    proposalIds: row.proposal_ids,
    detail: row.detail,
    contentSha256: row.content_sha256,
    createdAt: dbTimestamp(row.created_at),
  };
}

export const adaptationResolutionStore: AdaptationResolutionStore = {
  async loadContext(input) {
    const result = rows<DbContext>(await getDb().execute(sql`
      SELECT
        unit.id AS curriculum_unit_record_id,
        review.promoted_spec AS curriculum,
        profile.id AS profile_record_id,
        profile.profile AS language_profile,
        registry.id AS registry_record_id,
        registry.registry AS registry
      FROM language_curriculum_units unit
      JOIN language_curriculum_unit_reviews review
        ON review.source_unit_record_id = unit.id
        AND review.user_id = ${input.userId}
        AND review.action = 'accepted'
        AND review.promoted_spec IS NOT NULL
      JOIN language_curriculum_compilation_runs compilation
        ON compilation.id = unit.compilation_run_id
      JOIN language_curriculum_document_versions version
        ON version.id = compilation.document_version_id
      JOIN language_curriculum_documents document
        ON document.id = version.document_record_id
      JOIN language_knowledge_profiles profile
        ON profile.id = ${input.profileRecordId}
        AND profile.user_id = ${input.userId}
      JOIN language_decision_registry_versions registry
        ON registry.id = ${input.registryRecordId}
        AND registry.user_id = ${input.userId}
        AND registry.profile_record_id = profile.id
      WHERE unit.id = ${input.curriculumUnitRecordId}
        AND document.user_id = ${input.userId}
      LIMIT 1
    `));
    return result[0] ? mapContext(result[0]) : null;
  },

  async createRun(input) {
    const result = rows<DbRun>(await getDb().execute(sql`
      INSERT INTO language_adaptation_resolution_runs (
        user_id,
        curriculum_unit_record_id,
        profile_record_id,
        registry_record_id,
        previous_run_id,
        stage,
        adaptation_plan,
        active_research_task_ref,
        blocked_research_task_refs,
        proposal_ids,
        detail,
        content_sha256
      )
      SELECT
        ${input.userId},
        unit.id,
        profile.id,
        registry.id,
        ${input.previousRunId ?? null},
        ${input.stage},
        ${JSON.stringify(input.adaptationPlan)}::jsonb,
        ${input.activeResearchTaskRef ?? null},
        ${JSON.stringify(input.blockedResearchTaskRefs ?? [])}::jsonb,
        ${JSON.stringify(input.proposalIds ?? [])}::jsonb,
        ${input.detail ?? null},
        ${input.contentSha256}
      FROM language_curriculum_units unit
      JOIN language_curriculum_unit_reviews review
        ON review.source_unit_record_id = unit.id
        AND review.user_id = ${input.userId}
        AND review.action = 'accepted'
        AND review.promoted_spec IS NOT NULL
        AND review.promoted_spec = ${JSON.stringify(input.context.curriculum)}::jsonb
      JOIN language_curriculum_compilation_runs compilation
        ON compilation.id = unit.compilation_run_id
      JOIN language_curriculum_document_versions version
        ON version.id = compilation.document_version_id
      JOIN language_curriculum_documents document
        ON document.id = version.document_record_id
      JOIN language_knowledge_profiles profile
        ON profile.id = ${input.context.profileRecordId}
        AND profile.user_id = ${input.userId}
      JOIN language_decision_registry_versions registry
        ON registry.id = ${input.context.registryRecordId}
        AND registry.user_id = ${input.userId}
        AND registry.profile_record_id = profile.id
      WHERE unit.id = ${input.context.curriculumUnitRecordId}
        AND document.user_id = ${input.userId}
        AND (
          ${input.previousRunId ?? null}::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM language_adaptation_resolution_runs previous
            WHERE previous.id = ${input.previousRunId ?? null}
              AND previous.user_id = ${input.userId}
              AND previous.curriculum_unit_record_id = unit.id
          )
        )
      RETURNING *
    `));
    return result[0] ? mapRun(result[0]) : null;
  },

  async findRunForUser(userId, runId) {
    const result = rows<DbRun>(await getDb().execute(sql`
      SELECT *
      FROM language_adaptation_resolution_runs
      WHERE id = ${runId} AND user_id = ${userId}
      LIMIT 1
    `));
    return result[0] ? mapRun(result[0]) : null;
  },
};
