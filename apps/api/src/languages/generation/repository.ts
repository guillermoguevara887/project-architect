import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { dbTimestamp, type DbTimestamp } from "../../db/timestamps.js";
import type {
  CandidateValidationAttempt,
  ValidatedCandidate,
} from "../ai/structured-candidate-boundary.js";
import type { LessonSpec } from "../lessons/lesson-spec.js";
import type {
  GeneratedLesson,
  GeneratedLessonCandidate,
} from "./generated-lesson.js";

export type LessonGenerationRunStatus = "running" | "ready" | "failed";

export type LessonGenerationRunRecord = {
  id: string;
  userId: string;
  lessonSpecId: string;
  lessonSpecVersion: string;
  languageId: string;
  varietyId: string;
  levelId: string;
  unitId: string;
  routeNodeRef: string;
  generationIntent: LessonSpec["generationIntent"];
  lessonSpec: LessonSpec;
  generatorKey: string;
  provider: string;
  model: string | null;
  status: LessonGenerationRunStatus;
  attempts: number | null;
  validationHistory: CandidateValidationAttempt[] | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type GeneratedLessonRecord = {
  id: string;
  generationRunId: string;
  generatedLesson: GeneratedLesson;
  contentSha256: string;
  createdAt: Date;
};

export type LessonGenerationWithOutput = {
  run: LessonGenerationRunRecord;
  lesson: GeneratedLessonRecord | null;
};

export interface ProductionLessonGenerationStore {
  begin(input: {
    userId: string;
    lessonSpec: LessonSpec;
    generatorKey: string;
    provider: string;
    model: string | null;
  }): Promise<LessonGenerationRunRecord>;
  complete(input: {
    userId: string;
    runId: string;
    candidate: ValidatedCandidate<GeneratedLessonCandidate>;
    generatedLesson: GeneratedLesson;
    contentSha256: string;
  }): Promise<LessonGenerationWithOutput | null>;
  fail(input: {
    userId: string;
    runId: string;
    errorCode: string;
    validationHistory: CandidateValidationAttempt[];
  }): Promise<LessonGenerationRunRecord | null>;
  findForUser(
    userId: string,
    runId: string,
  ): Promise<LessonGenerationWithOutput | null>;
}

type DbRun = {
  id: string;
  user_id: string;
  lesson_spec_id: string;
  lesson_spec_version: string;
  language_id: string;
  variety_id: string;
  level_id: string;
  unit_id: string;
  route_node_ref: string;
  generation_intent: LessonSpec["generationIntent"];
  lesson_spec: LessonSpec;
  generator_key: string;
  provider: string;
  model: string | null;
  status: LessonGenerationRunStatus;
  attempts: number | null;
  validation_history: CandidateValidationAttempt[] | null;
  error_code: string | null;
  started_at: DbTimestamp;
  completed_at: DbTimestamp | null;
};

type DbLesson = {
  id: string;
  generation_run_id: string;
  generated_lesson: GeneratedLesson;
  content_sha256: string;
  created_at: DbTimestamp;
};

function rows<T>(value: unknown) {
  return value as T[];
}

function mapRun(row: DbRun): LessonGenerationRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    lessonSpecId: row.lesson_spec_id,
    lessonSpecVersion: row.lesson_spec_version,
    languageId: row.language_id,
    varietyId: row.variety_id,
    levelId: row.level_id,
    unitId: row.unit_id,
    routeNodeRef: row.route_node_ref,
    generationIntent: row.generation_intent,
    lessonSpec: row.lesson_spec,
    generatorKey: row.generator_key,
    provider: row.provider,
    model: row.model,
    status: row.status,
    attempts: row.attempts,
    validationHistory: row.validation_history,
    errorCode: row.error_code,
    startedAt: dbTimestamp(row.started_at),
    completedAt:
      row.completed_at === null ? null : dbTimestamp(row.completed_at),
  };
}

function mapLesson(row: DbLesson): GeneratedLessonRecord {
  return {
    id: row.id,
    generationRunId: row.generation_run_id,
    generatedLesson: row.generated_lesson,
    contentSha256: row.content_sha256,
    createdAt: dbTimestamp(row.created_at),
  };
}

async function findRun(userId: string, runId: string) {
  const result = rows<DbRun>(
    await getDb().execute(sql`
      SELECT *
      FROM language_lesson_generation_runs
      WHERE id=${runId} AND user_id=${userId}
      LIMIT 1
    `),
  );
  return result[0] ? mapRun(result[0]) : null;
}

async function findLesson(runId: string) {
  const result = rows<DbLesson>(
    await getDb().execute(sql`
      SELECT *
      FROM language_generated_lessons
      WHERE generation_run_id=${runId}
      LIMIT 1
    `),
  );
  return result[0] ? mapLesson(result[0]) : null;
}

export const productionLessonGenerationStore: ProductionLessonGenerationStore = {
  async begin(input) {
    const lesson = input.lessonSpec;
    const inserted = rows<DbRun>(
      await getDb().execute(sql`
        INSERT INTO language_lesson_generation_runs (
          user_id,
          lesson_spec_id,
          lesson_spec_version,
          language_id,
          variety_id,
          level_id,
          unit_id,
          route_node_ref,
          generation_intent,
          lesson_spec,
          generator_key,
          provider,
          model
        ) VALUES (
          ${input.userId},
          ${lesson.identity.lessonSpecId},
          ${lesson.version},
          ${lesson.identity.languageId},
          ${lesson.identity.varietyId},
          ${lesson.identity.levelId},
          ${lesson.identity.unitId},
          ${lesson.identity.routeNodeRef},
          ${lesson.generationIntent},
          ${JSON.stringify(lesson)}::jsonb,
          ${input.generatorKey},
          ${input.provider},
          ${input.model}
        )
        RETURNING *
      `),
    );
    if (!inserted[0]) {
      throw new Error("Lesson generation run insert returned no row.");
    }
    return mapRun(inserted[0]);
  },

  async complete(input) {
    return getDb().transaction(async (tx) => {
      const updated = rows<DbRun>(
        await tx.execute(sql`
          UPDATE language_lesson_generation_runs
          SET
            status='ready',
            attempts=${input.candidate.attempts},
            validation_history=${JSON.stringify(input.candidate.validationHistory)}::jsonb,
            completed_at=now()
          WHERE id=${input.runId}
            AND user_id=${input.userId}
            AND status='running'
          RETURNING *
        `),
      );
      if (!updated[0]) return null;

      const inserted = rows<DbLesson>(
        await tx.execute(sql`
          INSERT INTO language_generated_lessons (
            id,
            generation_run_id,
            generated_lesson,
            content_sha256
          ) VALUES (
            ${input.generatedLesson.identity.generatedLessonId},
            ${input.runId},
            ${JSON.stringify(input.generatedLesson)}::jsonb,
            ${input.contentSha256}
          )
          RETURNING *
        `),
      );
      if (!inserted[0]) {
        throw new Error("Generated lesson insert returned no row.");
      }
      return { run: mapRun(updated[0]), lesson: mapLesson(inserted[0]) };
    });
  },

  async fail(input) {
    const updated = rows<DbRun>(
      await getDb().execute(sql`
        UPDATE language_lesson_generation_runs
        SET
          status='failed',
          validation_history=${JSON.stringify(input.validationHistory)}::jsonb,
          error_code=${input.errorCode},
          completed_at=now()
        WHERE id=${input.runId}
          AND user_id=${input.userId}
          AND status='running'
        RETURNING *
      `),
    );
    return updated[0] ? mapRun(updated[0]) : null;
  },

  async findForUser(userId, runId) {
    const run = await findRun(userId, runId);
    if (!run) return null;
    const lesson = await findLesson(run.id);
    return { run, lesson };
  },
};
