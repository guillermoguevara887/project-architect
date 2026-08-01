import type { FastifyInstance } from "fastify";
import {
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  ProjectDetailResponseSchema,
  ProjectIdParamsSchema,
  ProjectsListResponseSchema,
} from "@project-architect/contracts";
import type { DiscoveryService } from "../discovery/service.js";
import { apiError } from "../lib/api-error.js";
import {
  createProject,
  getProjectById,
  listProjects,
} from "./repository.js";

export function registerProjectRoutes(
  server: FastifyInstance,
  discoveryService: DiscoveryService,
) {
  server.get("/projects", async (_request, reply) => {
    try {
      const projects = await listProjects();
      const projectsWithDiscovery = await Promise.all(
        projects.map(async (project) => ({
          ...project,
          discovery: await discoveryService.getSummary(project.id),
        })),
      );

      return ProjectsListResponseSchema.parse({
        projects: projectsWithDiscovery,
      });
    } catch (error) {
      server.log.error({ error }, "Failed to load projects.");

      return reply.code(500).send(
        apiError(
          "PROJECTS_LOAD_FAILED",
          "No se pudieron cargar los proyectos.",
        ),
      );
    }
  });

  server.get("/projects/:projectId", async (request, reply) => {
    const parsedParams = ProjectIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return reply
        .code(400)
        .send(apiError("INVALID_PROJECT_ID", "El ID del proyecto no es válido."));
    }

    try {
      const project = await getProjectById(parsedParams.data.projectId);

      if (!project) {
        return reply
          .code(404)
          .send(apiError("PROJECT_NOT_FOUND", "El proyecto solicitado no existe."));
      }

      return ProjectDetailResponseSchema.parse({
        project: {
          ...project,
          discovery: await discoveryService.getSummary(project.id),
        },
      });
    } catch (error) {
      server.log.error({ error }, "Failed to load project.");

      return reply
        .code(500)
        .send(
          apiError(
            "PROJECT_LOAD_FAILED",
            "No se pudo cargar el proyecto.",
          ),
        );
    }
  });

  server.post("/projects", async (request, reply) => {
    const parsedInput = CreateProjectRequestSchema.safeParse(request.body);

    if (!parsedInput.success) {
      return reply.code(400).send(
        apiError(
          "INVALID_PROJECT_INPUT",
          "Completa nombre, tipo de proyecto y objetivo global.",
        ),
      );
    }

    try {
      const project = await createProject(parsedInput.data);

      return reply.code(201).send(
        CreateProjectResponseSchema.parse({
          project,
        }),
      );
    } catch (error) {
      server.log.error({ error }, "Failed to create project.");

      return reply.code(500).send(
        apiError(
          "PROJECT_CREATE_FAILED",
          "No se pudo guardar el proyecto.",
        ),
      );
    }
  });
}
