import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  architectProjects,
  projectLinks,
  type ArchitectProjectStatus,
} from "../db/schema.js";

export type ProjectStatus = ArchitectProjectStatus;
export type ArchitectProject = typeof architectProjects.$inferSelect;
export type ProjectLink = typeof projectLinks.$inferSelect;

export type CreateProjectInput = {
  userId: string;
  name: string;
  sourceText: string | null;
  objective: string | null;
  status: ProjectStatus;
};

export type UpdateProjectInput = Omit<CreateProjectInput, "userId">;

export type CreateCompetitionInput = {
  userId: string;
  sourceText: string;
  officialUrl: string | null;
};

export type CreateProjectLinkInput = {
  projectId: string;
  userId: string;
  name: string;
  url: string;
};

export interface ArchitectProjectStore {
  listForUser(
    userId: string,
    status?: ProjectStatus,
  ): Promise<ArchitectProject[]>;
  createProject(input: CreateProjectInput): Promise<ArchitectProject>;
  createCompetition(input: CreateCompetitionInput): Promise<ArchitectProject>;
  findByIdForUser(
    projectId: string,
    userId: string,
  ): Promise<ArchitectProject | null>;
  updateForUser(
    projectId: string,
    userId: string,
    input: UpdateProjectInput,
  ): Promise<ArchitectProject | null>;
  listLinksForProject(
    projectId: string,
    userId: string,
  ): Promise<ProjectLink[]>;
  createLink(input: CreateProjectLinkInput): Promise<ProjectLink | null>;
  deleteLink(
    projectId: string,
    linkId: string,
    userId: string,
  ): Promise<boolean>;
}

export const architectProjectStore: ArchitectProjectStore = {
  async listForUser(userId, status) {
    return getDb()
      .select()
      .from(architectProjects)
      .where(
        status
          ? and(
              eq(architectProjects.userId, userId),
              eq(architectProjects.status, status),
            )
          : eq(architectProjects.userId, userId),
      )
      .orderBy(desc(architectProjects.updatedAt));
  },

  async createProject(input) {
    const [project] = await getDb()
      .insert(architectProjects)
      .values({
        userId: input.userId,
        projectType: "project",
        sourceText: input.sourceText,
        officialUrl: null,
        analysisStatus: "pending",
        structuredData: null,
        name: input.name,
        objective: input.objective,
        status: input.status,
      })
      .returning();

    if (!project) {
      throw new Error("The project could not be created.");
    }

    return project;
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

  async updateForUser(projectId, userId, input) {
    const [project] = await getDb()
      .update(architectProjects)
      .set({
        name: input.name,
        sourceText: input.sourceText,
        objective: input.objective,
        status: input.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(architectProjects.id, projectId),
          eq(architectProjects.userId, userId),
        ),
      )
      .returning();

    return project ?? null;
  },

  async listLinksForProject(projectId, userId) {
    const project = await this.findByIdForUser(projectId, userId);
    if (!project) return [];

    return getDb()
      .select()
      .from(projectLinks)
      .where(eq(projectLinks.projectId, projectId))
      .orderBy(asc(projectLinks.createdAt));
  },

  async createLink(input) {
    const project = await this.findByIdForUser(input.projectId, input.userId);
    if (!project) return null;

    const [link] = await getDb()
      .insert(projectLinks)
      .values({
        projectId: input.projectId,
        name: input.name,
        url: input.url,
      })
      .returning();

    if (link) {
      await getDb()
        .update(architectProjects)
        .set({ updatedAt: new Date() })
        .where(eq(architectProjects.id, input.projectId));
    }

    return link ?? null;
  },

  async deleteLink(projectId, linkId, userId) {
    const project = await this.findByIdForUser(projectId, userId);
    if (!project) return false;

    const [deleted] = await getDb()
      .delete(projectLinks)
      .where(
        and(
          eq(projectLinks.id, linkId),
          eq(projectLinks.projectId, projectId),
        ),
      )
      .returning({ id: projectLinks.id });

    if (deleted) {
      await getDb()
        .update(architectProjects)
        .set({ updatedAt: new Date() })
        .where(eq(architectProjects.id, projectId));
    }

    return Boolean(deleted);
  },
};
