import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { languageLessons, languageProjects } from "../db/schema.js";
import {
  structuredLanguageLessonSchema,
  type AssimilLanguageLessonContent,
  type FreeLanguageLessonAnalysis,
  type LanguageLessonDifficulty,
  type LanguageLessonLearningStatus,
  type LanguageLessonSplitPart,
  type LanguageLessonSource,
  type LanguageLessonStatus,
  type StructuredLanguageLesson,
} from "./contracts.js";
import {
  isA1LanguageLevel,
  languageLessonIsSplitEligible,
} from "./lesson-splitter.js";

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
  sourceLessonNumber?: number;
};

export class AssimilLanguageLessonNumberExistsError extends Error {
  constructor(readonly sourceLessonNumber: number) {
    super(`Assimil lesson ${sourceLessonNumber} already exists.`);
    this.name = "AssimilLanguageLessonNumberExistsError";
  }
}

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

export type CompleteAssimilLanguageLessonProcessingInput =
  OwnedLanguageProjectInput & {
    lessonId: string;
    processingStartedAt: Date;
    structuredContent: AssimilLanguageLessonContent;
  };

type OwnedLanguageLessonInput = OwnedLanguageProjectInput & {
  lessonId: string;
};

export type UpdateLanguageLessonProgressInput = OwnedLanguageLessonInput & {
  learningStatus?: LanguageLessonLearningStatus;
  difficulty?: LanguageLessonDifficulty | null;
};

export type PrepareFreeLanguageLessonInput = OwnedLanguageLessonInput & {
  title: string;
  sourceContent: string;
};

export type SaveFreeLanguageLessonAnalysisInput = OwnedLanguageLessonInput & {
  analysis: FreeLanguageLessonAnalysis;
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

export type LanguageLessonSplitParts = Record<
  LanguageLessonSplitPart,
  LanguageLesson
>;

export type InspectLanguageLessonSplitInput = OwnedLanguageLessonInput;

export type CreateLanguageLessonSplitChildrenInput =
  OwnedLanguageLessonInput & {
    partA: StructuredLanguageLesson;
    partB: StructuredLanguageLesson;
  };

export type InspectLanguageLessonSplitResult =
  | {
      kind: "eligible";
      project: LanguageProject;
      parent: LanguageLesson;
    }
  | {
      kind: "existing";
      project: LanguageProject;
      parent: LanguageLesson;
      parts: LanguageLessonSplitParts;
    }
  | { kind: "not_found" }
  | { kind: "not_eligible" }
  | { kind: "inconsistent" };

export type CreateLanguageLessonSplitChildrenResult =
  | {
      kind: "created" | "existing";
      parent: LanguageLesson;
      parts: LanguageLessonSplitParts;
    }
  | { kind: "not_found" }
  | { kind: "not_eligible" }
  | { kind: "inconsistent" };

export type DeleteLanguageLessonResult =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "split_child" };

export type UpdateLanguageLessonResult =
  | { kind: "updated"; lesson: LanguageLesson }
  | { kind: "not_found" }
  | { kind: "not_editable" };

export type PrepareFreeLanguageLessonResult =
  | { kind: "prepared"; lesson: LanguageLesson }
  | { kind: "not_found" }
  | { kind: "wrong_source" }
  | { kind: "not_editable" };

export type SaveFreeLanguageLessonAnalysisResult =
  | { kind: "saved"; lesson: LanguageLesson }
  | { kind: "existing"; lesson: LanguageLesson }
  | { kind: "not_found" }
  | { kind: "not_eligible" };

export type ClaimLanguageLessonResult =
  | {
      kind: "claimed";
      lesson: LanguageLesson;
      project: LanguageProject;
    }
  | { kind: "not_found" }
  | { kind: "not_eligible" }
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
  | { kind: "not_eligible" }
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
  inspectLessonSplit(
    input: InspectLanguageLessonSplitInput,
  ): Promise<InspectLanguageLessonSplitResult>;
  createLessonSplitChildren(
    input: CreateLanguageLessonSplitChildrenInput,
  ): Promise<CreateLanguageLessonSplitChildrenResult>;
  updateLessonSourceContent(
    input: UpdateLanguageLessonInput,
  ): Promise<UpdateLanguageLessonResult>;
  updateLessonLearningProgress(
    input: UpdateLanguageLessonProgressInput,
  ): Promise<LanguageLesson | null>;
  prepareFreeLesson(
    input: PrepareFreeLanguageLessonInput,
  ): Promise<PrepareFreeLanguageLessonResult>;
  saveFreeLessonAnalysis(
    input: SaveFreeLanguageLessonAnalysisInput,
  ): Promise<SaveFreeLanguageLessonAnalysisResult>;
  claimLessonForProcessing(
    input: ClaimLanguageLessonInput,
  ): Promise<ClaimLanguageLessonResult>;
  completeLessonProcessing(
    input: CompleteLanguageLessonProcessingInput,
  ): Promise<LanguageLesson | null>;
  failLessonProcessing(
    input: FailLanguageLessonProcessingInput,
  ): Promise<LanguageLesson | null>;
  claimAssimilLessonForProcessing(
    input: ClaimLanguageLessonInput,
  ): Promise<ClaimLanguageLessonResult>;
  completeAssimilLessonProcessing(
    input: CompleteAssimilLanguageLessonProcessingInput,
  ): Promise<LanguageLesson | null>;
  failAssimilLessonProcessing(
    input: FailLanguageLessonProcessingInput,
  ): Promise<LanguageLesson | null>;
  claimLessonForSimplification(
    input: ClaimLanguageLessonSimplificationInput,
  ): Promise<ClaimLanguageLessonSimplificationResult>;
  claimLessonForVerySimplification(
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
  ): Promise<DeleteLanguageLessonResult>;
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

function existingLanguageLessonSplit(
  children: LanguageLesson[],
): LanguageLessonSplitParts | null {
  if (children.length !== 2) return null;

  const partA = children.find(({ splitPart }) => splitPart === "A");
  const partB = children.find(({ splitPart }) => splitPart === "B");
  return partA && partB ? { A: partA, B: partB } : null;
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
      let sourceLessonNumber: number;

      if (input.lessonSource === "assimil") {
        if (input.sourceLessonNumber === undefined) {
          throw new Error("Assimil lessons require a source lesson number.");
        }

        const [duplicate] = await transaction
          .select({ id: languageLessons.id })
          .from(languageLessons)
          .where(
            and(
              eq(languageLessons.languageProjectId, project.id),
              eq(languageLessons.lessonSource, "assimil"),
              eq(languageLessons.sourceLessonNumber, input.sourceLessonNumber),
              isNull(languageLessons.splitParentLessonId),
            ),
          )
          .limit(1);

        if (duplicate) {
          throw new AssimilLanguageLessonNumberExistsError(
            input.sourceLessonNumber,
          );
        }

        sourceLessonNumber = input.sourceLessonNumber;
      } else {
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
        sourceLessonNumber =
          (latestSourceLesson?.sourceLessonNumber ?? 0) + 1;
      }
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

  async inspectLessonSplit(input) {
    const [project] = await getDb()
      .select()
      .from(languageProjects)
      .where(
        and(
          eq(languageProjects.id, input.languageProjectId),
          eq(languageProjects.userId, input.userId),
        ),
      )
      .limit(1);

    if (!project) return { kind: "not_found" as const };

    const [parent] = await getDb()
      .select()
      .from(languageLessons)
      .where(
        and(
          eq(languageLessons.id, input.lessonId),
          eq(languageLessons.languageProjectId, project.id),
        ),
      )
      .limit(1);

    if (!parent) return { kind: "not_found" as const };
    if (!languageLessonIsSplitEligible(project.level, parent)) {
      return { kind: "not_eligible" as const };
    }

    const children = await getDb()
      .select()
      .from(languageLessons)
      .where(eq(languageLessons.splitParentLessonId, parent.id))
      .orderBy(asc(languageLessons.lessonNumber));

    if (children.length === 0) {
      return { kind: "eligible" as const, project, parent };
    }

    const parts = existingLanguageLessonSplit(children);
    return parts
      ? { kind: "existing" as const, project, parent, parts }
      : { kind: "inconsistent" as const };
  },

  async createLessonSplitChildren(input) {
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
        .limit(1)
        .for("update");

      if (!project) return { kind: "not_found" as const };

      const [parent] = await transaction
        .select()
        .from(languageLessons)
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, project.id),
          ),
        )
        .limit(1)
        .for("update");

      if (!parent) return { kind: "not_found" as const };
      if (!languageLessonIsSplitEligible(project.level, parent)) {
        return { kind: "not_eligible" as const };
      }

      const children = await transaction
        .select()
        .from(languageLessons)
        .where(eq(languageLessons.splitParentLessonId, parent.id))
        .orderBy(asc(languageLessons.lessonNumber))
        .for("update");

      if (children.length > 0) {
        const parts = existingLanguageLessonSplit(children);
        return parts
          ? { kind: "existing" as const, parent, parts }
          : { kind: "inconsistent" as const };
      }

      const [latestLesson] = await transaction
        .select({ lessonNumber: max(languageLessons.lessonNumber) })
        .from(languageLessons)
        .where(eq(languageLessons.languageProjectId, project.id));
      const partALessonNumber = (latestLesson?.lessonNumber ?? 0) + 1;
      const processedAt = new Date();
      const commonValues = {
        languageProjectId: project.id,
        lessonSource: "language_framework" as const,
        sourceLessonNumber: parent.sourceLessonNumber,
        splitParentLessonId: parent.id,
        sourceContent: "",
        freeTitle: null,
        freeAnalysis: null,
        status: "ready" as const,
        learningStatus: "pending" as const,
        difficulty: null,
        simplifiedStructuredContent: null,
        simplificationStartedAt: null,
        simplifiedAt: null,
        processedAt,
        updatedAt: processedAt,
      };

      const [partA] = await transaction
        .insert(languageLessons)
        .values({
          ...commonValues,
          lessonNumber: partALessonNumber,
          splitPart: "A",
          structuredContent: input.partA,
        })
        .returning();

      if (!partA) {
        throw new Error("Language lesson split part A could not be created.");
      }

      const [partB] = await transaction
        .insert(languageLessons)
        .values({
          ...commonValues,
          lessonNumber: partALessonNumber + 1,
          splitPart: "B",
          structuredContent: input.partB,
        })
        .returning();

      if (!partB) {
        throw new Error("Language lesson split part B could not be created.");
      }

      return {
        kind: "created" as const,
        parent,
        parts: { A: partA, B: partB },
      };
    });
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

      if (
        existing.lessonSource !== "language_framework" ||
        existing.splitParentLessonId !== null ||
        existing.splitPart !== null
      ) {
        return { kind: "not_eligible" as const };
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

  async claimAssimilLessonForProcessing(input) {
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

      if (!project) return { kind: "not_found" as const };

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

      if (!existing) return { kind: "not_found" as const };

      if (
        existing.lessonSource !== "assimil" ||
        existing.splitParentLessonId !== null ||
        existing.splitPart !== null ||
        existing.sourceLessonNumber < 1 ||
        existing.sourceLessonNumber > 9_999
      ) {
        return { kind: "not_eligible" as const };
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
        throw new Error("The Assimil lesson could not enter processing.");
      }

      return { kind: "claimed" as const, lesson, project };
    });
  },

  async completeAssimilLessonProcessing(input) {
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
          eq(languageLessons.lessonSource, "assimil"),
          isNull(languageLessons.splitParentLessonId),
          eq(languageLessons.status, "processing"),
          eq(languageLessons.updatedAt, input.processingStartedAt),
        ),
      )
      .returning();

    return lesson ?? null;
  },

  async failAssimilLessonProcessing(input) {
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
          eq(languageLessons.lessonSource, "assimil"),
          isNull(languageLessons.splitParentLessonId),
          eq(languageLessons.status, "processing"),
          eq(languageLessons.updatedAt, input.processingStartedAt),
        ),
      )
      .returning();

    return lesson ?? null;
  },

  async updateLessonLearningProgress(input) {
    if (!(await ownsProject(input.languageProjectId, input.userId))) {
      return null;
    }

    const progress: {
      learningStatus?: LanguageLessonLearningStatus;
      difficulty?: LanguageLessonDifficulty | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (input.learningStatus !== undefined) {
      progress.learningStatus = input.learningStatus;
    }
    if (input.difficulty !== undefined) {
      progress.difficulty = input.difficulty;
    }

    const [lesson] = await getDb()
      .update(languageLessons)
      .set(progress)
      .where(
        and(
          eq(languageLessons.id, input.lessonId),
          eq(languageLessons.languageProjectId, input.languageProjectId),
        ),
      )
      .returning();

    return lesson ?? null;
  },

  async prepareFreeLesson(input) {
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

      if (existing.lessonSource !== "free") {
        return { kind: "wrong_source" as const };
      }

      if (
        existing.freeTitle !== null ||
        !(existing.status === "draft" || existing.status === "failed")
      ) {
        return { kind: "not_editable" as const };
      }

      const preparedAt = new Date();
      const [lesson] = await transaction
        .update(languageLessons)
        .set({
          freeTitle: input.title,
          sourceContent: input.sourceContent,
          status: "ready",
          structuredContent: null,
          simplifiedStructuredContent: null,
          simplificationStartedAt: null,
          simplifiedAt: null,
          processedAt: preparedAt,
          updatedAt: preparedAt,
        })
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
            eq(languageLessons.lessonSource, "free"),
            inArray(languageLessons.status, ["draft", "failed"]),
          ),
        )
        .returning();

      return lesson
        ? { kind: "prepared" as const, lesson }
        : { kind: "not_editable" as const };
    });
  },

  async saveFreeLessonAnalysis(input) {
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

      if (!project) return { kind: "not_found" as const };

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

      if (!existing) return { kind: "not_found" as const };

      if (
        existing.lessonSource !== "free" ||
        existing.freeTitle === null ||
        existing.status !== "ready" ||
        !existing.sourceContent.trim()
      ) {
        return { kind: "not_eligible" as const };
      }

      if (existing.freeAnalysis !== null) {
        return { kind: "existing" as const, lesson: existing };
      }

      const [lesson] = await transaction
        .update(languageLessons)
        .set({ freeAnalysis: input.analysis, updatedAt: new Date() })
        .where(
          and(
            eq(languageLessons.id, input.lessonId),
            eq(languageLessons.languageProjectId, input.languageProjectId),
          ),
        )
        .returning();

      return lesson
        ? { kind: "saved" as const, lesson }
        : { kind: "not_found" as const };
    });
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

      if (
        existing.splitParentLessonId !== null ||
        existing.splitPart !== null
      ) {
        return { kind: "not_eligible" as const };
      }

      if (existing.status !== "ready" || !existing.structuredContent) {
        return { kind: "not_ready" as const };
      }

      if (
        !structuredLanguageLessonSchema.safeParse(existing.structuredContent)
          .success
      ) {
        return { kind: "not_eligible" as const };
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

  async claimLessonForVerySimplification(input) {
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

      if (
        !isA1LanguageLevel(project.level) ||
        existing.lessonSource !== "language_framework" ||
        existing.splitParentLessonId === null ||
        (existing.splitPart !== "A" && existing.splitPart !== "B") ||
        existing.status !== "ready" ||
        !structuredLanguageLessonSchema.safeParse(existing.structuredContent)
          .success
      ) {
        return { kind: "not_eligible" as const };
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
        throw new Error(
          "The language lesson could not enter very simplification.",
        );
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
      return { kind: "not_found" as const };
    }

    const [lesson] = await getDb()
      .select({ splitParentLessonId: languageLessons.splitParentLessonId })
      .from(languageLessons)
      .where(
        and(
          eq(languageLessons.id, lessonId),
          eq(languageLessons.languageProjectId, projectId),
        ),
      )
      .limit(1);

    if (!lesson) return { kind: "not_found" as const };
    if (lesson.splitParentLessonId !== null) {
      return { kind: "split_child" as const };
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

    return deleted.length === 1
      ? { kind: "deleted" as const }
      : { kind: "not_found" as const };
  },
};
