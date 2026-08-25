import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { exercises } from "../db/schema.js";
import type {
  ExerciseStatus,
  ExerciseWorkspaceType,
} from "./contracts.js";

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

export interface ExerciseStore {
  listExercises(userId: string): Promise<Exercise[]>;
  createExercise(input: CreateExerciseInput): Promise<Exercise>;
  findExerciseByIdForUser(
    exerciseId: string,
    userId: string,
  ): Promise<Exercise | null>;
  updateExercise(input: UpdateExerciseInput): Promise<Exercise | null>;
  updateStatus(
    exerciseId: string,
    userId: string,
    status: ExerciseStatus,
  ): Promise<Exercise | null>;
  updateWorkspace(
    input: UpdateExerciseWorkspaceInput,
  ): Promise<Exercise | null>;
  saveGuide(
    exerciseId: string,
    userId: string,
    guideContent: string,
  ): Promise<Exercise | null>;
  saveSuggestedSteps(
    exerciseId: string,
    userId: string,
    suggestedSteps: string[],
  ): Promise<Exercise | null>;
}

const ownedExercise = (exerciseId: string, userId: string) =>
  and(eq(exercises.id, exerciseId), eq(exercises.userId, userId));

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

  async saveGuide(exerciseId, userId, guideContent) {
    const [exercise] = await getDb()
      .update(exercises)
      .set({ guideContent, updatedAt: new Date() })
      .where(ownedExercise(exerciseId, userId))
      .returning();

    return exercise ?? null;
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
