import { desc, eq } from "drizzle-orm";
import type {
  CreateProjectRequest,
  Project,
} from "@project-architect/contracts";
import { getDb } from "../db/client.js";
import { projects } from "../db/schema.js";

type ProjectRow = typeof projects.$inferSelect;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    projectType: row.projectType,
    globalObjective: row.globalObjective,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = getDb();
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));

  return rows.map(toProject);
}

export async function getProjectById(
  projectId: string,
): Promise<Project | null> {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return project ? toProject(project) : null;
}

export async function createProject(
  input: CreateProjectRequest,
): Promise<Project> {
  const db = getDb();
  const [project] = await db
    .insert(projects)
    .values({
      name: input.name,
      projectType: input.projectType,
      globalObjective: input.globalObjective,
    })
    .returning();

  if (!project) {
    throw new Error("Project insert did not return a row.");
  }

  return toProject(project);
}
