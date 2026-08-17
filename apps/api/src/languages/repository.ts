import { and, asc, desc, eq, max } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { languageLessons, languageProjects } from "../db/schema.js";

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
};

export type UpdateLanguageLessonInput = CreateNextLanguageLessonInput & {
  lessonId: string;
  sourceContent: string;
};

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
  ): Promise<LanguageLesson | null>;
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
      const [lesson] = await transaction
        .insert(languageLessons)
        .values({ languageProjectId: project.id, lessonNumber })
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
    if (!(await ownsProject(input.languageProjectId, input.userId))) {
      return null;
    }

    const [lesson] = await getDb()
      .update(languageLessons)
      .set({ sourceContent: input.sourceContent, updatedAt: new Date() })
      .where(
        and(
          eq(languageLessons.id, input.lessonId),
          eq(languageLessons.languageProjectId, input.languageProjectId),
        ),
      )
      .returning();

    return lesson ?? null;
  },
};
