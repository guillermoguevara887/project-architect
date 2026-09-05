import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { dbTimestamp, type DbTimestamp } from "../../db/timestamps.js";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import type { AdaptedUnitSpec } from "../adapted/adapted-unit-spec.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import type { LanguageDecisionRegistry } from "../decisions/language-decision-registry.js";
import type { LessonSpec } from "../lessons/lesson-spec.js";
import type { LanguageProfile } from "../profile/language-profile.js";
import type { LessonRoute } from "../routing/lesson-route.js";

export type TrustedPlanningBundlePayload = {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  registry: LanguageDecisionRegistry;
  adaptationPlan: AdaptationPlan;
  adaptedUnit: AdaptedUnitSpec;
  route: LessonRoute;
  lessonSpecs: LessonSpec[];
};

export type PlanningBundleRecord = {
  id: string;
  userId: string;
  curriculumUnitRecordId: string;
  languageId: string;
  varietyId: string;
  levelId: string;
  unitId: string;
  payload: TrustedPlanningBundlePayload;
  contentSha256: string;
  createdAt: Date;
};

export type CurriculumOrchestrationRunStatus = "running" | "ready" | "failed";

export type CurriculumOrchestrationRunRecord = {
  id: string;
  userId: string;
  planningBundleId: string;
  status: CurriculumOrchestrationRunStatus;
  expectedLessonCount: number;
  generationRunIds: string[];
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export interface CurriculumOrchestrationStore {
  createPlanningBundle(input: {
    userId: string;
    curriculumUnitRecordId: string;
    payload: TrustedPlanningBundlePayload;
    contentSha256: string;
  }): Promise<PlanningBundleRecord | null>;
  findPlanningBundleForUser(
    userId: string,
    bundleId: string,
  ): Promise<PlanningBundleRecord | null>;
  beginRun(input: {
    userId: string;
    planningBundleId: string;
    expectedLessonCount: number;
  }): Promise<CurriculumOrchestrationRunRecord | null>;
  appendGenerationRun(input: {
    userId: string;
    runId: string;
    generationRunId: string;
  }): Promise<CurriculumOrchestrationRunRecord | null>;
  completeRun(
    userId: string,
    runId: string,
  ): Promise<CurriculumOrchestrationRunRecord | null>;
  failRun(input: {
    userId: string;
    runId: string;
    errorCode: string;
  }): Promise<CurriculumOrchestrationRunRecord | null>;
  findRunForUser(
    userId: string,
    runId: string,
  ): Promise<CurriculumOrchestrationRunRecord | null>;
}

type DbBundle = {
  id: string;
  user_id: string;
  curriculum_unit_record_id: string;
  language_id: string;
  variety_id: string;
  level_id: string;
  unit_id: string;
  curriculum_unit_spec: CurriculumUnitSpec;
  language_profile: LanguageProfile;
  decision_registry: LanguageDecisionRegistry;
  adaptation_plan: AdaptationPlan;
  adapted_unit_spec: AdaptedUnitSpec;
  lesson_route: LessonRoute;
  lesson_specs: LessonSpec[];
  content_sha256: string;
  created_at: DbTimestamp;
};

type DbRun = {
  id: string;
  user_id: string;
  planning_bundle_id: string;
  status: CurriculumOrchestrationRunStatus;
  expected_lesson_count: number;
  generation_run_ids: string[];
  error_code: string | null;
  started_at: DbTimestamp;
  completed_at: DbTimestamp | null;
};

function rows<T>(value: unknown) {
  return value as T[];
}

function mapBundle(row: DbBundle): PlanningBundleRecord {
  return {
    id: row.id,
    userId: row.user_id,
    curriculumUnitRecordId: row.curriculum_unit_record_id,
    languageId: row.language_id,
    varietyId: row.variety_id,
    levelId: row.level_id,
    unitId: row.unit_id,
    payload: {
      curriculum: row.curriculum_unit_spec,
      languageProfile: row.language_profile,
      registry: row.decision_registry,
      adaptationPlan: row.adaptation_plan,
      adaptedUnit: row.adapted_unit_spec,
      route: row.lesson_route,
      lessonSpecs: row.lesson_specs,
    },
    contentSha256: row.content_sha256,
    createdAt: dbTimestamp(row.created_at),
  };
}

function mapRun(row: DbRun): CurriculumOrchestrationRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    planningBundleId: row.planning_bundle_id,
    status: row.status,
    expectedLessonCount: row.expected_lesson_count,
    generationRunIds: row.generation_run_ids,
    errorCode: row.error_code,
    startedAt: dbTimestamp(row.started_at),
    completedAt:
      row.completed_at === null ? null : dbTimestamp(row.completed_at),
  };
}

export const curriculumOrchestrationStore: CurriculumOrchestrationStore = {
  async createPlanningBundle(input) {
    const payload = input.payload;
    const inserted = rows<DbBundle>(
      await getDb().execute(sql`
        INSERT INTO language_curriculum_planning_bundles (
          user_id,
          curriculum_unit_record_id,
          language_id,
          variety_id,
          level_id,
          unit_id,
          curriculum_unit_spec,
          language_profile,
          decision_registry,
          adaptation_plan,
          adapted_unit_spec,
          lesson_route,
          lesson_specs,
          content_sha256
        )
        SELECT
          ${input.userId},
          unit.id,
          ${payload.languageProfile.identity.languageId},
          ${payload.languageProfile.identity.varietyId},
          ${payload.curriculum.identity.levelId},
          ${payload.curriculum.identity.unitId},
          ${JSON.stringify(payload.curriculum)}::jsonb,
          ${JSON.stringify(payload.languageProfile)}::jsonb,
          ${JSON.stringify(payload.registry)}::jsonb,
          ${JSON.stringify(payload.adaptationPlan)}::jsonb,
          ${JSON.stringify(payload.adaptedUnit)}::jsonb,
          ${JSON.stringify(payload.route)}::jsonb,
          ${JSON.stringify(payload.lessonSpecs)}::jsonb,
          ${input.contentSha256}
        FROM language_curriculum_units unit
        JOIN language_curriculum_compilation_runs compilation
          ON compilation.id=unit.compilation_run_id
        JOIN language_curriculum_document_versions version
          ON version.id=compilation.document_version_id
        JOIN language_curriculum_documents document
          ON document.id=version.document_record_id
        WHERE unit.id=${input.curriculumUnitRecordId}
          AND document.user_id=${input.userId}
        ON CONFLICT (
          user_id,
          curriculum_unit_record_id,
          language_id,
          variety_id,
          content_sha256
        ) DO NOTHING
        RETURNING *
      `),
    );
    if (inserted[0]) return mapBundle(inserted[0]);

    const existing = rows<DbBundle>(
      await getDb().execute(sql`
        SELECT bundle.*
        FROM language_curriculum_planning_bundles bundle
        WHERE bundle.user_id=${input.userId}
          AND bundle.curriculum_unit_record_id=${input.curriculumUnitRecordId}
          AND bundle.language_id=${payload.languageProfile.identity.languageId}
          AND bundle.variety_id=${payload.languageProfile.identity.varietyId}
          AND bundle.content_sha256=${input.contentSha256}
        LIMIT 1
      `),
    );
    return existing[0] ? mapBundle(existing[0]) : null;
  },

  async findPlanningBundleForUser(userId, bundleId) {
    const result = rows<DbBundle>(
      await getDb().execute(sql`
        SELECT *
        FROM language_curriculum_planning_bundles
        WHERE id=${bundleId} AND user_id=${userId}
        LIMIT 1
      `),
    );
    return result[0] ? mapBundle(result[0]) : null;
  },

  async beginRun(input) {
    const result = rows<DbRun>(
      await getDb().execute(sql`
        INSERT INTO language_curriculum_orchestration_runs (
          user_id,
          planning_bundle_id,
          expected_lesson_count
        )
        SELECT ${input.userId}, bundle.id, ${input.expectedLessonCount}
        FROM language_curriculum_planning_bundles bundle
        WHERE bundle.id=${input.planningBundleId}
          AND bundle.user_id=${input.userId}
        RETURNING *
      `),
    );
    return result[0] ? mapRun(result[0]) : null;
  },

  async appendGenerationRun(input) {
    const result = rows<DbRun>(
      await getDb().execute(sql`
        UPDATE language_curriculum_orchestration_runs
        SET generation_run_ids=generation_run_ids || jsonb_build_array(${input.generationRunId}::text)
        WHERE id=${input.runId}
          AND user_id=${input.userId}
          AND status='running'
          AND NOT generation_run_ids ? ${input.generationRunId}
        RETURNING *
      `),
    );
    return result[0] ? mapRun(result[0]) : null;
  },

  async completeRun(userId, runId) {
    const result = rows<DbRun>(
      await getDb().execute(sql`
        UPDATE language_curriculum_orchestration_runs
        SET status='ready', completed_at=now()
        WHERE id=${runId}
          AND user_id=${userId}
          AND status='running'
          AND jsonb_array_length(generation_run_ids)=expected_lesson_count
        RETURNING *
      `),
    );
    return result[0] ? mapRun(result[0]) : null;
  },

  async failRun(input) {
    const result = rows<DbRun>(
      await getDb().execute(sql`
        UPDATE language_curriculum_orchestration_runs
        SET status='failed', error_code=${input.errorCode}, completed_at=now()
        WHERE id=${input.runId}
          AND user_id=${input.userId}
          AND status='running'
        RETURNING *
      `),
    );
    return result[0] ? mapRun(result[0]) : null;
  },

  async findRunForUser(userId, runId) {
    const result = rows<DbRun>(
      await getDb().execute(sql`
        SELECT *
        FROM language_curriculum_orchestration_runs
        WHERE id=${runId} AND user_id=${userId}
        LIMIT 1
      `),
    );
    return result[0] ? mapRun(result[0]) : null;
  },
};
