import { z } from "zod";
import { ProjectDiscoverySummarySchema } from "./discovery-shared.js";

export const ProjectTypeSchema = z.enum(["research", "competition"]);

const TrimmedRequiredStringSchema = z
  .string()
  .trim()
  .min(1, "Este campo es obligatorio.");

export const CreateProjectRequestSchema = z.object({
  name: TrimmedRequiredStringSchema,
  projectType: ProjectTypeSchema,
  globalObjective: TrimmedRequiredStringSchema,
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  projectType: ProjectTypeSchema,
  globalObjective: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProjectsListResponseSchema = z.object({
  projects: z.array(
    ProjectSchema.extend({
      discovery: ProjectDiscoverySummarySchema,
    }),
  ),
});

export const CreateProjectResponseSchema = z.object({
  project: ProjectSchema,
});

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ProjectType = z.infer<typeof ProjectTypeSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectsListResponse = z.infer<typeof ProjectsListResponseSchema>;
export type ProjectListItem = ProjectsListResponse["projects"][number];
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
