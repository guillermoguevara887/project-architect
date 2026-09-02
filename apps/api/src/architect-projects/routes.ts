import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../auth/repository.js";
import { readSessionUserId } from "../auth/session.js";
import type {
  ArchitectProject,
  ArchitectProjectStore,
  ProjectLink,
  ProjectStatus,
  UpdateProjectInput,
} from "./repository.js";
import {
  ProjectTextImproverError,
  type ProjectTextImprover,
} from "./text-improver.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_STATUSES = ["idea", "in_progress", "completed"] as const;
const MAX_NAME_LENGTH = 160;
const MAX_LINK_NAME_LENGTH = 80;
const MAX_IMPROVEMENT_TEXT_LENGTH = 10_000;

type InputError = {
  error: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    PROJECT_STATUSES.includes(value as ProjectStatus)
  );
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readProjectInput(body: unknown): UpdateProjectInput | InputError {
  if (!isRecord(body)) {
    return {
      error: "INVALID_PROJECT",
      message: "Los datos del proyecto no son válidos.",
    };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return {
      error: "PROJECT_NAME_REQUIRED",
      message: "El nombre del proyecto es obligatorio.",
    };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      error: "PROJECT_NAME_TOO_LONG",
      message: `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres.`,
    };
  }

  if (
    (body.sourceText !== undefined && typeof body.sourceText !== "string") ||
    (body.objective !== undefined && typeof body.objective !== "string")
  ) {
    return {
      error: "INVALID_PROJECT_TEXT",
      message: "La descripción y el objetivo deben ser texto.",
    };
  }

  const status = body.status ?? "idea";
  if (!isProjectStatus(status)) {
    return {
      error: "INVALID_PROJECT_STATUS",
      message: "El estado del proyecto no es válido.",
    };
  }

  return {
    name,
    sourceText: nullableText(body.sourceText),
    objective: nullableText(body.objective),
    status,
  };
}

function readCompetitionInput(
  body: Record<string, unknown>,
):
  | { sourceText: string; officialUrl: string | null }
  | InputError {
  const sourceText =
    typeof body.sourceText === "string" ? body.sourceText.trim() : "";
  if (!sourceText) {
    return {
      error: "SOURCE_TEXT_REQUIRED",
      message: "El texto del concurso es obligatorio.",
    };
  }

  if (
    body.officialUrl !== undefined &&
    body.officialUrl !== null &&
    typeof body.officialUrl !== "string"
  ) {
    return {
      error: "INVALID_OFFICIAL_URL",
      message: "La URL oficial debe ser una dirección HTTP o HTTPS válida.",
    };
  }

  const officialUrl = nullableText(body.officialUrl);
  if (officialUrl && !isHttpUrl(officialUrl)) {
    return {
      error: "INVALID_OFFICIAL_URL",
      message: "La URL oficial debe ser una dirección HTTP o HTTPS válida.",
    };
  }

  return { sourceText, officialUrl };
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function readLinkInput(
  body: unknown,
): { name: string; url: string } | InputError {
  if (!isRecord(body)) {
    return {
      error: "INVALID_PROJECT_LINK",
      message: "Los datos de la herramienta no son válidos.",
    };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!name || name.length > MAX_LINK_NAME_LENGTH) {
    return {
      error: "INVALID_PROJECT_LINK_NAME",
      message: "El nombre de la herramienta es obligatorio y debe ser breve.",
    };
  }

  if (!url || !isHttpUrl(url)) {
    return {
      error: "INVALID_PROJECT_LINK_URL",
      message: "La URL debe ser una dirección HTTP o HTTPS válida.",
    };
  }

  return { name, url };
}

function legacyName(project: ArchitectProject) {
  return (
    project.sourceText?.trim().split(/\r?\n/u, 1)[0]?.trim() ||
    (project.projectType === "competition"
      ? "Concurso sin nombre"
      : "Proyecto sin nombre")
  );
}

function projectStatus(project: ArchitectProject): ProjectStatus {
  if (project.status) return project.status;
  return project.analysisStatus === "completed" ? "completed" : "idea";
}

function publicLink(link: ProjectLink) {
  return {
    id: link.id,
    name: link.name,
    url: link.url,
    createdAt: link.createdAt.toISOString(),
  };
}

function publicProject(project: ArchitectProject, links: ProjectLink[]) {
  return {
    id: project.id,
    name: project.name?.trim() || legacyName(project),
    description: project.sourceText ?? "",
    objective: project.objective ?? "",
    status: projectStatus(project),
    links: links.map(publicLink),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    projectType: project.projectType,
    sourceText: project.sourceText,
    officialUrl: project.officialUrl,
    analysisStatus: project.analysisStatus,
  };
}

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);
  if (!userId) return null;
  return (await authStore.findById(userId))?.id ?? null;
}

function validId(value: string) {
  return UUID_PATTERN.test(value);
}

async function projectWithLinks(
  projectStore: ArchitectProjectStore,
  project: ArchitectProject,
  userId: string,
) {
  const links = await projectStore.listLinksForProject(project.id, userId);
  return publicProject(project, links);
}

export function registerArchitectProjectRoutes(
  server: FastifyInstance,
  projectStore: ArchitectProjectStore,
  authStore: AuthStore,
  textImprover: ProjectTextImprover,
) {
  server.get<{ Querystring: { status?: string } }>(
    "/architect/projects",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);
        if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

        if (
          request.query.status !== undefined &&
          !isProjectStatus(request.query.status)
        ) {
          return reply.code(400).send({ error: "INVALID_PROJECT_STATUS" });
        }

        const projects = await projectStore.listForUser(userId);
        const publicProjects = await Promise.all(
          projects.map((project) => projectWithLinks(projectStore, project, userId)),
        );
        const filtered = request.query.status
          ? publicProjects.filter(
              (project) => project.status === request.query.status,
            )
          : publicProjects;

        return { projects: filtered };
      } catch (error) {
        server.log.error({ error }, "Project listing failed.");
        return reply.code(503).send({
          error: "PROJECT_UNAVAILABLE",
          message: "No se pudieron cargar los proyectos.",
        });
      }
    },
  );

  server.post("/architect/projects", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
      if (!isRecord(request.body)) {
        return reply.code(400).send({
          error: "INVALID_PROJECT",
          message: "Los datos del proyecto no son válidos.",
        });
      }

      if (!("name" in request.body)) {
        const legacyInput = readCompetitionInput(request.body);
        if ("error" in legacyInput) return reply.code(400).send(legacyInput);
        const legacyProject = await projectStore.createCompetition({
          userId,
          ...legacyInput,
        });
        return reply.code(201).send({
          project: await projectWithLinks(projectStore, legacyProject, userId),
        });
      }

      const input = readProjectInput(request.body);
      if ("error" in input) return reply.code(400).send(input);
      const project = await projectStore.createProject({ userId, ...input });
      return reply.code(201).send({
        project: await projectWithLinks(projectStore, project, userId),
      });
    } catch (error) {
      server.log.error({ error }, "Project creation failed.");
      return reply.code(503).send({
        error: "PROJECT_UNAVAILABLE",
        message: "No se pudo guardar el proyecto.",
      });
    }
  });

  server.post("/architect/projects/improve-text", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });

      if (!isRecord(request.body) || typeof request.body.text !== "string") {
        return reply.code(400).send({
          error: "PROJECT_TEXT_REQUIRED",
          message: "Escribe el texto que quieres mejorar.",
        });
      }

      const text = request.body.text.trim();
      if (!text) {
        return reply.code(400).send({
          error: "PROJECT_TEXT_REQUIRED",
          message: "Escribe el texto que quieres mejorar.",
        });
      }
      if (text.length > MAX_IMPROVEMENT_TEXT_LENGTH) {
        return reply.code(400).send({
          error: "PROJECT_TEXT_TOO_LONG",
          message: "El texto es demasiado largo para mejorarlo.",
        });
      }

      return { improvedText: await textImprover.improve(text) };
    } catch (error) {
      if (error instanceof ProjectTextImproverError) {
        const notConfigured = error.code === "not_configured";
        return reply.code(notConfigured ? 503 : 502).send({
          error: notConfigured ? "AI_NOT_CONFIGURED" : "AI_UNAVAILABLE",
          message: notConfigured
            ? "La mejora de texto todavía no está configurada."
            : "No se pudo mejorar el texto. Inténtalo de nuevo.",
        });
      }

      server.log.error({ error }, "Project text improvement failed.");
      return reply.code(502).send({
        error: "AI_UNAVAILABLE",
        message: "No se pudo mejorar el texto. Inténtalo de nuevo.",
      });
    }
  });

  server.get<{ Params: { projectId: string } }>(
    "/architect/projects/:projectId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);
        if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
        if (!validId(request.params.projectId)) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        const project = await projectStore.findByIdForUser(
          request.params.projectId,
          userId,
        );
        if (!project) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        return {
          project: await projectWithLinks(projectStore, project, userId),
        };
      } catch (error) {
        server.log.error({ error }, "Project lookup failed.");
        return reply.code(503).send({
          error: "PROJECT_UNAVAILABLE",
          message: "No se pudo cargar el proyecto.",
        });
      }
    },
  );

  server.patch<{ Params: { projectId: string } }>(
    "/architect/projects/:projectId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);
        if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
        if (!validId(request.params.projectId)) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        const input = readProjectInput(request.body);
        if ("error" in input) return reply.code(400).send(input);
        const project = await projectStore.updateForUser(
          request.params.projectId,
          userId,
          input,
        );
        if (!project) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        return {
          project: await projectWithLinks(projectStore, project, userId),
        };
      } catch (error) {
        server.log.error({ error }, "Project update failed.");
        return reply.code(503).send({
          error: "PROJECT_UNAVAILABLE",
          message: "No se pudo actualizar el proyecto.",
        });
      }
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/architect/projects/:projectId/links",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);
        if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
        if (!validId(request.params.projectId)) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        const input = readLinkInput(request.body);
        if ("error" in input) return reply.code(400).send(input);
        const link = await projectStore.createLink({
          projectId: request.params.projectId,
          userId,
          ...input,
        });
        if (!link) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        return reply.code(201).send({ link: publicLink(link) });
      } catch (error) {
        server.log.error({ error }, "Project link creation failed.");
        return reply.code(503).send({
          error: "PROJECT_UNAVAILABLE",
          message: "No se pudo guardar la herramienta.",
        });
      }
    },
  );

  server.delete<{ Params: { projectId: string; linkId: string } }>(
    "/architect/projects/:projectId/links/:linkId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);
        if (!userId) return reply.code(401).send({ error: "UNAUTHORIZED" });
        if (
          !validId(request.params.projectId) ||
          !validId(request.params.linkId)
        ) {
          return reply.code(404).send({ error: "PROJECT_LINK_NOT_FOUND" });
        }

        const deleted = await projectStore.deleteLink(
          request.params.projectId,
          request.params.linkId,
          userId,
        );
        if (!deleted) {
          return reply.code(404).send({ error: "PROJECT_LINK_NOT_FOUND" });
        }

        return reply.code(204).send();
      } catch (error) {
        server.log.error({ error }, "Project link deletion failed.");
        return reply.code(503).send({
          error: "PROJECT_UNAVAILABLE",
          message: "No se pudo eliminar la herramienta.",
        });
      }
    },
  );
}
