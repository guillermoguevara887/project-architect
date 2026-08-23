import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { languageLessons, languageProjects } from "../db/schema.js";
import type {
  LanguageLessonSource,
  LanguageLessonStatus,
  StructuredLanguageLesson,
} from "./contracts.js";

export const LANGUAGE_LESSON_PROCESSING_TIMEOUT_MS = 15 * 60 * 1_000;
export const LANGUAGE_LESSON_SIMPLIFICATION_TIMEOUT_MS = 15 * 60 * 1_000;

export type LanguageProject = typeof languageProjects.$inferSelect;
export type LanguageLesson = typeof languageLessons.$inferSelect;

export type CreateLanguageProjectInput = {
  userId: string;
  language: string;
  level: string;
};

export type CreateNextLanguageLessonInput = {
  languageProjectId: string;
  userId: string;
  lessonSource: LanguageLessonSource;
};

type OwnedLanguageProjectInput = Pick<
  CreateNextLanguageLessonInput,
  "languageProjectId" | "userId"
>;

export type UpdateLanguageLessonInput = OwnedLanguageProjectInput & {
  lessonId: string;
  sourceContent: string;
};

export type ClaimLanguageLessonInput = UpdateLanguageLessonInput;

export type CompleteLanguageLessonProcessingInput =
  OwnedLanguageProjectInput & {
    lessonId: string;
    processingStartedAt: Date;
    structuredContent: StructuredLanguageLesson;
  };

export type FailLanguageLessonProcessingInput = OwnedLanguageProjectInput & {
  lessonId: string;
  processingStartedAt: Date;
};

type OwnedLanguageLessonInput = OwnedLanguageProjectInput & {
  lessonId: string;
};

export type ClaimLanguageLessonSimplificationInput =
  OwnedLanguageLessonInput & {
    regenerate: boolean;
  };

export type CompleteLanguageLessonSimplificationInput =
  OwnedLanguageLessonInput & {
    simplificationStartedAt: Date;
    simplifiedStructuredContent: StructuredLanguageLesson;
  };

export type FailLanguageLessonSimplificationInput =
  OwnedLanguageLessonInput & {
    simplificationStartedAt: Date;
  };

export type UpdateLanguageLessonResult =
  | { kind: "updated"; lesson: LanguageLesson }
  | { kind: "not_found" }
  | { kind: "not_editable" };

export type ClaimLanguageLessonResult =
  | {
      kind: "claimed";
      lesson: LanguageLesson;
      project: LanguageProject;
    }
  | { kind: "not_found" }
  | { kind: "already_ready" }
  | { kind: "processing" };

export type ClaimLanguageLessonSimplificationResult =
  | {
      kind: "claimed";
      lesson: LanguageLesson;
      project: LanguageProject;
    }
  | { kind: "not_found" }
  | { kind: "not_ready" }
  | { kind: "already_simplified"; lesson: LanguageLesson }
  | { kind: "processing" };

export interface LanguageStore {
  listProjects(userId: string): Promise<LanguageProject[]>;
  createProject(input: CreateLanguageProjectInput): Promise<LanguageProject>;
  findProjectByIdForUser(
    projectId: string,
    userId: string,
  ): Promise<LanguageProject | null>;
  createNextLesson(
    input: CreateNextLanguageLessonInput,
  ): Promise<LanguageLesson | null>;
  listLessons(
    projectId: string,
    userId: string,
  ): Promise<LanguageLesson[] | null>;
  findLessonByIdForUser(
    lessonId: string,
    projectId: string,
    userId: string,
  ): Promise<LanguageLesson | null>;
  updateLessonSourceContent(
    input: UpdateLanguageLessonInput,
  ): Promise<UpdateLanguageLessonResult>;
  claimLessonForProcessing(
    input: ClaimLanguageLessonInput,
  ): Promise<ClaimLanguageLessonResult>;
  completeLessonProcessing(
    input: CompleteLanguageLessonProcessingInput,
  ): Promise<LanguageLesson | null>;
  failLessonProcessing(
    input: FailLanguageLessonProcessingInput,
  ): Promise<LanguageLesson | null>;
  claimLessonForSimplification(
    input: ClaimLanguageLessonSimplificationInput,
  ): Promise<ClaimLanguageLessonSimplificationResult>;
  completeLessonSimplification(
    input: CompleteLanguageLessonSimplificationInput,
  ): Promise<LanguageLesson | null>;
  failLessonSimplification(
    input: FailLanguageLessonSimplificationInput,
  ): Promise<LanguageLesson | null>;
  deleteLesson(
    lessonId: string,
    projectId: string,
    userId: string,
  ): Promise<boolean>;
}

export function effectiveLanguageLessonStatus(
  lesson: Pick<LanguageLesson, "status" | "updatedAt">,
  now = Date.now(),
): LanguageLessonStatus {
  if (
    lesson.status === "processing" &&
    now - lesson.updatedAt.getTime() >= LANGUAGE_LESSON_PROCESSING_TIMEOUT_MS
  ) {
    return "failed";
  }

  return lesson.status;
}

async function ownsProject(projectId: string, userId: string) {
  const [project] = await getDb()
    .select({ id: languageProjects.id })
    .from(languageProjects)
    .where(
      and(eq(languageProjects.id, projectId), eq(languageProjects.userId, userId)),
    )
    .limit(1);

  return Boolean(project);
}

export const languageStore: LanguageStore = {
  async listProjects(userId) {
    return getDb()
      .select()
      .from(languageProjects)
      .where(eq(languageProjects.userId, userId))
      .orderBy(desc(languageProjects.createdAt));
  },

  async createProject(input) {
    const [project] = await getDb()
      .insert(languageProjects)
      .values(input)
      .returning();

    if (!project) {
      throw new Error("The language project could not be created.");
    }

    return project;
  },

  async findProjectByIdForUser(projectId, userId) {
    const [project] = await getDb()
      .select()
      .from(languageProjects)
      .where(
        and(
          eq(languageProjects.id, projectId),
          eq(languageProjects.userId, userId),
        ),
      )
      .limit(1);

    return project ?? null;
  },

  async createNextLesson(input) {
    return getDb().transaction(async (transaction) => {
      const [project] = await transaction
        .select({ id: languageProjects.id })
        .from(languageProjects)
        .where(
          and(
            eq(languageProjects.id, input.languageProjectId),
            eq(languageProjects.userId, input.userId),
          ),
        )
        .limit(1)
        .for("update");

      if (!project) {
        return null;
      }

      const [latestLesson] = await transaction
        .select({ lessonNumber: max(languageLessons.lessonNumber) })
        .from(languageLessons)
        .where(eq(languageLessons.languageProjectId, project.id));
      const lessonNumber = (latestLesson?.lessonNumber ?? 0) + 1;
      const [latestSourceLesson] = await transaction
        .select({
          sourceLessonNumber: max(languageLessons.sourceLessonNumber),
        })
        .from(languageLessons)
        .where(
          and(
            eq(languageLessons.languageProjectId, project.id),
            eq(languageLessons.lessonSource, input.lessonSource),
          ),
        );
      const sourceLessonNumber =
        (latestSourceLesson?.sourceLessonNumber ?? 0) + 1;
      const [lesson] = await transaction
        .insert(languageLessons)
        .values({
          languageProjectId: project.id,
          lessonNumber,
          lessonSource: input.lessonSource,
          sourceLessonNumber,
        })
        .returning();

      if (!lesson) {
        throw new Error("The language lesson could not be created.");
      }

      return lesson;
    });
  },

  async listLessons(projectId, userId) {
    if (!(await ownsProject(projectId, userId))) {
      return null;
    }

    return getDb()
      .select()
      .from(languageLessons)
      .where(eq(languageLessons.languageProjectId, projectId))
      .orderBy(asc(languageLessons.lessonNumber));
  },

  async findLessonByIdForUser(lessonId, projectId, userId) {
    if (!(await ownsProject(projectId, userId))) {
      return null;
    }

    const [lesson] = await getDb()
      .select()
      .from(languageLessons)
      .where(
        and(
          eq(languageLessons.id, lessonId),
          eq(languageLessons.languageProjectId, projectId),
        ),
      )
      .limit(1);

    return lesson ?? null;
  },

  async updateLessonSourceContent(input) {
    return getDb().transaction(async (transaction) => {
      const [project] = await transaction
        .select({ id: languageProjects.id })
        .from(languageProjects)
        .where(
          and(
            eq(languageProjects.id, input.languageProjectId),
            eq(languageProjects.userId, input.userId),
          ),
        )
        .limit(1);

      if (!project) {
        return { kind: "not_found" as const };
      }

      const [existing] = await transaction
        .select()
        .from(languageLessons)
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
          ),
        )
        .limit(1)
        .for("update");

      if (!existing) {
        return { kind: "not_found" as const };
      }

      if (!(["draft", "failed"] as LanguageLessonStatus[]).includes(existing.status)) {
        return { kind: "not_editable" as const };
      }

      const [lesson] = await transaction
        .update(languageLessons)
        .set({ sourceContent: input.sourceContent, updatedAt: new Date() })
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
            inArray(languageLessons.status, ["draft", "failed"]),
          ),
        )
        .returning();

      return lesson
        ? { kind: "updated" as const, lesson }
        : { kind: "not_editable" as const };
    });
  },

  async claimLessonForProcessing(input) {
    return getDb().transaction(async (transaction) => {
      const [project] = await transaction
        .select()
        .from(languageProjects)
        .where(
          and(
            eq(languageProjects.id, input.languageProjectId),
            eq(languageProjects.userId, input.userId),
          ),
        )
        .limit(1);

      if (!project) {
        return { kind: "not_found" as const };
      }

      const [existing] = await transaction
        .select()
        .from(languageLessons)
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
          ),
        )
        .limit(1)
        .for("update");

      if (!existing) {
        return { kind: "not_found" as const };
      }

      const effectiveStatus = effectiveLanguageLessonStatus(existing);

      if (effectiveStatus === "ready") {
        return { kind: "already_ready" as const };
      }

      if (effectiveStatus === "processing") {
        return { kind: "processing" as const };
      }

      const processingStartedAt = new Date();
      const [lesson] = await transaction
        .update(languageLessons)
        .set({
          sourceContent: input.sourceContent,
          status: "processing",
          structuredContent: null,
          processedAt: null,
          updatedAt: processingStartedAt,
        })
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
          ),
        )
        .returning();

      if (!lesson) {
        throw new Error("The language lesson could not enter processing.");
      }

      return { kind: "claimed" as const, lesson, project };
    });
  },

  async completeLessonProcessing(input) {
    if (!(await ownsProject(input.languageProjectId, input.userId))) {
      return null;
    }

    const completedAt = new Date();
    const [lesson] = await getDb()
      .update(languageLessons)
      .set({
        status: "ready",
        structuredContent: input.structuredContent,
        processedAt: completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(languageLessons.id, input.lessonId),
          eq(languageLessons.languageProjectId, input.languageProjectId),
          eq(languageLessons.status, "processing"),
          eq(languageLessons.updatedAt, input.processingStartedAt),
        ),
      )
      .returning();

    return lesson ?? null;
  },

  async failLessonProcessing(input) {
    if (!(await ownsProject(input.languageProjectId, input.userId))) {
      return null;
    }

    const [lesson] = await getDb()
      .update(languageLessons)
      .set({
        status: "failed",
        structuredContent: null,
        processedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(languageLessons.id, input.lessonId),
          eq(languageLessons.languageProjectId, input.languageProjectId),
          eq(languageLessons.status, "processing"),
          eq(languageLessons.updatedAt, input.processingStartedAt),
        ),
      )
      .returning();

    return lesson ?? null;
  },

  async claimLessonForSimplification(input) {
    return getDb().transaction(async (transaction) => {
      const [project] = await transaction
        .select()
        .from(languageProjects)
        .where(
          and(
            eq(languageProjects.id, input.languageProjectId),
            eq(languageProjects.userId, input.userId),
          ),
        )
        .limit(1);

      if (!project) {
        return { kind: "not_found" as const };
      }

      const [existing] = await transaction
        .select()
        .from(languageLessons)
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
          ),
        )
        .limit(1)
        .for("update");

      if (!existing) {
        return { kind: "not_found" as const };
      }

      if (existing.status !== "ready" || !existing.structuredContent) {
        return { kind: "not_ready" as const };
      }

      if (!input.regenerate && existing.simplifiedStructuredContent) {
        return { kind: "already_simplified" as const, lesson: existing };
      }

      if (
        existing.simplificationStartedAt &&
        Date.now() - existing.simplificationStartedAt.getTime() <
          LANGUAGE_LESSON_SIMPLIFICATION_TIMEOUT_MS
      ) {
        return { kind: "processing" as const };
      }

      const simplificationStartedAt = new Date();
      const [lesson] = await transaction
        .update(languageLessons)
        .set({ simplificationStartedAt })
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
            eq(languageLessons.status, "ready"),
          ),
        )
        .returning();

      if (!lesson) {
        throw new Error("The language lesson could not enter simplification.");
      }

      return { kind: "claimed" as const, lesson, project };
    });
  },

  async completeLessonSimplification(input) {
    if (!(await ownsProject(input.languageProjectId, input.userId))) {
      return null;
    }

    const completedAt = new Date();
    const [lesson] = await getDb()
      .update(languageLessons)
      .set({
        simplifiedStructuredContent: input.simplifiedStructuredContent,
        simplifiedAt: completedAt,
        simplificationStartedAt: null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(languageLessons.id, input.lessonId),
          eq(languageLessons.languageProjectId, input.languageProjectId),
          eq(languageLessons.status, "ready"),
          eq(
            languageLessons.simplificationStartedAt,
            input.simplificationStartedAt,
          ),
        ),
      )
      .returning();

    return lesson ?? null;
  },

  async failLessonSimplification(input) {
    if (!(await ownsProject(input.languageProjectId, input.userId))) {
      return null;
    }

    const [lesson] = await getDb()
      .update(languageLessons)
      .set({ simplificationStartedAt: null })
      .where(
        and(
          eq(languageLessons.id, input.lessonId),
          eq(languageLessons.languageProjectId, input.languageProjectId),
          eq(languageLessons.status, "ready"),
          eq(
            languageLessons.simplificationStartedAt,
            input.simplificationStartedAt,
          ),
        ),
      )
      .returning();

    return lesson ?? null;
  },

  async deleteLesson(lessonId, projectId, userId) {
    if (!(await ownsProject(projectId, userId))) {
      return false;
    }

    const deleted = await getDb()
      .delete(languageLessons)
      .where(
        and(
          eq(languageLessons.id, lessonId),
          eq(languageLessons.languageProjectId, projectId),
        ),
      )
      .returning({ id: languageLessons.id });

    return deleted.length === 1;
  },
};
