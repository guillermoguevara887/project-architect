import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { architectProjects } from "../db/schema.js";

export type ArchitectProject = typeof architectProjects.$inferSelect;

export type CreateCompetitionInput = {
  userId: string;
  sourceText: string;
  officialUrl: string | null;
};

export interface ArchitectProjectStore {
  listForUser(userId: string): Promise<ArchitectProject[]>;
  createCompetition(input: CreateCompetitionInput): Promise<ArchitectProject>;
  findByIdForUser(
    projectId: string,
    userId: string,
  ): Promise<ArchitectProject | null>;
}

export const architectProjectStore: ArchitectProjectStore = {
  async listForUser(userId) {
    return getDb()
      .select()
      .from(architectProjects)
      .where(eq(architectProjects.userId, userId))
      .orderBy(desc(architectProjects.createdAt));
  },

  async createCompetition(input) {
    const [project] = await getDb()
      .insert(architectProjects)
      .values({
        userId: input.userId,
        projectType: "competition",
        sourceText: input.sourceText,
        officialUrl: input.officialUrl,
        analysisStatus: "pending",
        structuredData: null,
      })
      .returning();

    if (!project) {
      throw new Error("The competition could not be created.");
    }

    return project;
  },

  async findByIdForUser(projectId, userId) {
    const [project] = await getDb()
      .select()
      .from(architectProjects)
      .where(
        and(
          eq(architectProjects.id, projectId),
          eq(architectProjects.userId, userId),
        ),
      )
      .limit(1);

    return project ?? null;
  },
};
