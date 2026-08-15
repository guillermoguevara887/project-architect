import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../auth/repository.js";
import { readSessionUserId } from "../auth/session.js";
import type {
  ArchitectProject,
  ArchitectProjectStore,
} from "./repository.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ValidCompetitionInput = {
  sourceText: string;
  officialUrl: string | null;
};

type InvalidCompetitionInput = {
  error: string;
  message: string;
};

function readCompetitionInput(
  body: unknown,
): ValidCompetitionInput | InvalidCompetitionInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      error: "INVALID_COMPETITION",
      message: "El texto del concurso es obligatorio.",
    };
  }

  const { sourceText, officialUrl } = body as Record<string, unknown>;

  if (typeof sourceText !== "string" || sourceText.trim().length === 0) {
    return {
      error: "SOURCE_TEXT_REQUIRED",
      message: "El texto del concurso es obligatorio.",
    };
  }

  if (
    officialUrl !== undefined &&
    officialUrl !== null &&
    typeof officialUrl !== "string"
  ) {
    return {
      error: "INVALID_OFFICIAL_URL",
      message: "La URL oficial debe ser una dirección HTTP o HTTPS válida.",
    };
  }

  const normalizedUrl =
    typeof officialUrl === "string" ? officialUrl.trim() : "";

  if (normalizedUrl) {
    try {
      const parsedUrl = new URL(normalizedUrl);

      if (
        (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
        !parsedUrl.hostname ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        throw new Error("Invalid official URL.");
      }
    } catch {
      return {
        error: "INVALID_OFFICIAL_URL",
        message: "La URL oficial debe ser una dirección HTTP o HTTPS válida.",
      };
    }
  }

  return {
    sourceText: sourceText.trim(),
    officialUrl: normalizedUrl || null,
  };
}

function publicProject(project: ArchitectProject) {
  return {
    id: project.id,
    projectType: project.projectType,
    sourceText: project.sourceText,
    officialUrl: project.officialUrl,
    analysisStatus: project.analysisStatus,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);

  if (!userId) {
    return null;
  }

  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

export function registerArchitectProjectRoutes(
  server: FastifyInstance,
  projectStore: ArchitectProjectStore,
  authStore: AuthStore,
) {
  server.get("/architect/projects", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const projects = await projectStore.listForUser(userId);
      return { projects: projects.map(publicProject) };
    } catch (error) {
      server.log.error({ error }, "Project listing failed.");

      return reply.code(503).send({
        error: "PROJECT_UNAVAILABLE",
        message: "No se pudieron cargar los proyectos.",
      });
    }
  });

  server.post("/architect/projects", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const input = readCompetitionInput(request.body);

      if ("error" in input) {
        return reply.code(400).send(input);
      }

      const project = await projectStore.createCompetition({
        userId,
        sourceText: input.sourceText,
        officialUrl: input.officialUrl,
      });

      return reply.code(201).send({ project: publicProject(project) });
    } catch (error) {
      server.log.error({ error }, "Competition creation failed.");

      return reply.code(503).send({
        error: "PROJECT_UNAVAILABLE",
        message: "No se pudo guardar el concurso.",
      });
    }
  });

  server.get<{ Params: { projectId: string } }>(
    "/architect/projects/:projectId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!UUID_PATTERN.test(request.params.projectId)) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        const project = await projectStore.findByIdForUser(
          request.params.projectId,
          userId,
        );

        if (!project) {
          return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        }

        return { project: publicProject(project) };
      } catch (error) {
        server.log.error({ error }, "Competition lookup failed.");

        return reply.code(503).send({
          error: "PROJECT_UNAVAILABLE",
          message: "No se pudo cargar el concurso.",
        });
      }
    },
  );
}
