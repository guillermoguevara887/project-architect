import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { exercises } from "../db/schema.js";
import type {
  ExerciseStatus,
  ExerciseWorkspaceType,
  StructuredExerciseGuide,
} from "./contracts.js";
import { EXERCISE_GUIDE_MAX_GENERATIONS } from "./contracts.js";

export type Exercise = typeof exercises.$inferSelect;

export type CreateExerciseInput = {
  userId: string;
  title: string;
  sourceName: string | null;
  chapter: string | null;
  exerciseNumber: string | null;
  prompt: string;
};

export type UpdateExerciseInput = {
  exerciseId: string;
  userId: string;
  title?: string;
  sourceName?: string | null;
  chapter?: string | null;
  exerciseNumber?: string | null;
  prompt?: string;
};

export type UpdateExerciseWorkspaceInput = {
  exerciseId: string;
  userId: string;
  workspaceType: ExerciseWorkspaceType | null;
  workspaceValue: string | null;
};

export type SaveStructuredGuideResult =
  | { status: "saved"; exercise: Exercise }
  | { status: "limit_reached"; exercise: Exercise }
  | { status: "not_found" };

export function effectiveGuideGenerationCount(
  exercise: Pick<Exercise, "guideContent" | "guideGenerationCount">,
) {
  // A legacy guide is the first generation without requiring a data backfill.
  return Math.max(
    exercise.guideGenerationCount,
    exercise.guideContent === null ? 0 : 1,
  );
}

export interface ExerciseStore {
  listExercises(userId: string): Promise<Exercise[]>;
  createExercise(input: CreateExerciseInput): Promise<Exercise>;
  findExerciseByIdForUser(
    exerciseId: string,
    userId: string,
  ): Promise<Exercise | null>;
  deleteExercise(exerciseId: string, userId: string): Promise<boolean>;
  updateExercise(input: UpdateExerciseInput): Promise<Exercise | null>;
  updateStatus(
    exerciseId: string,
    userId: string,
    status: ExerciseStatus,
  ): Promise<Exercise | null>;
  updateWorkspace(
    input: UpdateExerciseWorkspaceInput,
  ): Promise<Exercise | null>;
  saveStructuredGuide(
    exerciseId: string,
    userId: string,
    guide: StructuredExerciseGuide,
  ): Promise<SaveStructuredGuideResult>;
  saveSuggestedSteps(
    exerciseId: string,
    userId: string,
    suggestedSteps: string[],
  ): Promise<Exercise | null>;
}

const ownedExercise = (exerciseId: string, userId: string) =>
  and(eq(exercises.id, exerciseId), eq(exercises.userId, userId));

const effectiveGuideGenerationCountSql = sql<number>`greatest(
  ${exercises.guideGenerationCount},
  case when ${exercises.guideContent} is null then 0 else 1 end
)`;

export const exerciseStore: ExerciseStore = {
  async listExercises(userId) {
    return getDb()
      .select()
      .from(exercises)
      .where(eq(exercises.userId, userId))
      .orderBy(desc(exercises.createdAt));
  },

  async createExercise(input) {
    const [exercise] = await getDb()
      .insert(exercises)
      .values(input)
      .returning();

    if (!exercise) {
      throw new Error("The exercise could not be created.");
    }

    return exercise;
  },

  async findExerciseByIdForUser(exerciseId, userId) {
    const [exercise] = await getDb()
      .select()
      .from(exercises)
      .where(ownedExercise(exerciseId, userId))
      .limit(1);

    return exercise ?? null;
  },

  async deleteExercise(exerciseId, userId) {
    const deleted = await getDb()
      .delete(exercises)
      .where(ownedExercise(exerciseId, userId))
      .returning({ id: exercises.id });

    return deleted.length === 1;
  },

  async updateExercise(input) {
    const { exerciseId, userId, ...updates } = input;
    const [exercise] = await getDb()
      .update(exercises)
      .set({ ...updates, updatedAt: new Date() })
      .where(ownedExercise(exerciseId, userId))
      .returning();

    return exercise ?? null;
  },

  async updateStatus(exerciseId, userId, status) {
    const [exercise] = await getDb()
      .update(exercises)
      .set({ status, updatedAt: new Date() })
      .where(ownedExercise(exerciseId, userId))
      .returning();

    return exercise ?? null;
  },

  async updateWorkspace(input) {
    const [exercise] = await getDb()
      .update(exercises)
      .set({
        workspaceType: input.workspaceType,
        workspaceValue: input.workspaceValue,
        updatedAt: new Date(),
      })
      .where(ownedExercise(input.exerciseId, input.userId))
      .returning();

    return exercise ?? null;
  },

  async saveStructuredGuide(exerciseId, userId, guide) {
    const [exercise] = await getDb()
      .update(exercises)
      .set({
        guideStructuredContent: guide,
        guideGenerationCount: sql`${effectiveGuideGenerationCountSql} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          ownedExercise(exerciseId, userId),
          sql`${effectiveGuideGenerationCountSql} < ${EXERCISE_GUIDE_MAX_GENERATIONS}`,
        ),
      )
      .returning();

    if (exercise) {
      return { status: "saved", exercise };
    }

    const current = await this.findExerciseByIdForUser(exerciseId, userId);
    return current
      ? { status: "limit_reached", exercise: current }
      : { status: "not_found" };
  },

  async saveSuggestedSteps(exerciseId, userId, suggestedSteps) {
    const [exercise] = await getDb()
      .update(exercises)
      .set({ suggestedSteps, updatedAt: new Date() })
      .where(ownedExercise(exerciseId, userId))
      .returning();

    return exercise ?? null;
  },
};
