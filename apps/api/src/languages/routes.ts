import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../auth/repository.js";
import { readSessionUserId } from "../auth/session.js";
import {
  createLanguageProjectSchema,
  languageLessonIdSchema,
  languageProjectIdSchema,
  updateLanguageLessonSchema,
} from "./contracts.js";
import type {
  LanguageLesson,
  LanguageProject,
  LanguageStore,
} from "./repository.js";

function publicProject(project: LanguageProject) {
  return {
    id: project.id,
    language: project.language,
    level: project.level,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function publicLesson(lesson: LanguageLesson) {
  return {
    id: lesson.id,
    languageProjectId: lesson.languageProjectId,
    lessonNumber: lesson.lessonNumber,
    sourceContent: lesson.sourceContent,
    createdAt: lesson.createdAt.toISOString(),
    updatedAt: lesson.updatedAt.toISOString(),
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

export function registerLanguageRoutes(
  server: FastifyInstance,
  store: LanguageStore,
  authStore: AuthStore,
) {
  server.get("/languages/projects", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const projects = await store.listProjects(userId);
      return { projects: projects.map(publicProject) };
    } catch (error) {
      server.log.error({ error }, "Language project listing failed.");
      return reply.code(503).send({
        error: "LANGUAGES_UNAVAILABLE",
        message: "No se pudieron cargar los idiomas.",
      });
    }
  });

  server.post("/languages/projects", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const parsedInput = createLanguageProjectSchema.safeParse(request.body);

      if (!parsedInput.success) {
        return reply.code(400).send({
          error: "INVALID_LANGUAGE_PROJECT",
          message: "Completa el idioma y el nivel.",
        });
      }

      const project = await store.createProject({ userId, ...parsedInput.data });
      return reply.code(201).send({ project: publicProject(project) });
    } catch (error) {
      server.log.error({ error }, "Language project creation failed.");
      return reply.code(503).send({
        error: "LANGUAGES_UNAVAILABLE",
        message: "No se pudo crear el idioma.",
      });
    }
  });

  server.get<{ Params: { projectId: string } }>(
    "/languages/projects/:projectId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!languageProjectIdSchema.safeParse(request.params.projectId).success) {
          return reply.code(404).send({ error: "LANGUAGE_PROJECT_NOT_FOUND" });
        }

        const project = await store.findProjectByIdForUser(
          request.params.projectId,
          userId,
        );

        if (!project) {
          return reply.code(404).send({ error: "LANGUAGE_PROJECT_NOT_FOUND" });
        }

        return { project: publicProject(project) };
      } catch (error) {
        server.log.error({ error }, "Language project lookup failed.");
        return reply.code(503).send({
          error: "LANGUAGES_UNAVAILABLE",
          message: "No se pudo cargar el idioma.",
        });
      }
    },
  );

  server.get<{ Params: { projectId: string } }>(
    "/languages/projects/:projectId/lessons",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!languageProjectIdSchema.safeParse(request.params.projectId).success) {
          return reply.code(404).send({ error: "LANGUAGE_PROJECT_NOT_FOUND" });
        }

        const lessons = await store.listLessons(request.params.projectId, userId);

        if (!lessons) {
          return reply.code(404).send({ error: "LANGUAGE_PROJECT_NOT_FOUND" });
        }

        return { lessons: lessons.map(publicLesson) };
      } catch (error) {
        server.log.error({ error }, "Language lesson listing failed.");
        return reply.code(503).send({
          error: "LANGUAGES_UNAVAILABLE",
          message: "No se pudieron cargar las lecciones.",
        });
      }
    },
  );

  server.post<{ Params: { projectId: string } }>(
    "/languages/projects/:projectId/lessons",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!languageProjectIdSchema.safeParse(request.params.projectId).success) {
          return reply.code(404).send({ error: "LANGUAGE_PROJECT_NOT_FOUND" });
        }

        const lesson = await store.createNextLesson({
          languageProjectId: request.params.projectId,
          userId,
        });

        if (!lesson) {
          return reply.code(404).send({ error: "LANGUAGE_PROJECT_NOT_FOUND" });
        }

        return reply.code(201).send({ lesson: publicLesson(lesson) });
      } catch (error) {
        server.log.error({ error }, "Language lesson creation failed.");
        return reply.code(503).send({
          error: "LANGUAGES_UNAVAILABLE",
          message: "No se pudo crear la lección.",
        });
      }
    },
  );

  server.get<{ Params: { projectId: string; lessonId: string } }>(
    "/languages/projects/:projectId/lessons/:lessonId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (
          !languageProjectIdSchema.safeParse(request.params.projectId).success ||
          !languageLessonIdSchema.safeParse(request.params.lessonId).success
        ) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        const lesson = await store.findLessonByIdForUser(
          request.params.lessonId,
          request.params.projectId,
          userId,
        );

        if (!lesson) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        return { lesson: publicLesson(lesson) };
      } catch (error) {
        server.log.error({ error }, "Language lesson lookup failed.");
        return reply.code(503).send({
          error: "LANGUAGES_UNAVAILABLE",
          message: "No se pudo cargar la lección.",
        });
      }
    },
  );

  server.patch<{ Params: { projectId: string; lessonId: string } }>(
    "/languages/projects/:projectId/lessons/:lessonId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (
          !languageProjectIdSchema.safeParse(request.params.projectId).success ||
          !languageLessonIdSchema.safeParse(request.params.lessonId).success
        ) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        const parsedInput = updateLanguageLessonSchema.safeParse(request.body);

        if (!parsedInput.success) {
          return reply.code(400).send({
            error: "INVALID_LANGUAGE_LESSON",
            message: "El material de la lección no es válido.",
          });
        }

        const lesson = await store.updateLessonSourceContent({
          languageProjectId: request.params.projectId,
          lessonId: request.params.lessonId,
          userId,
          sourceContent: parsedInput.data.sourceContent,
        });

        if (!lesson) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        return { lesson: publicLesson(lesson) };
      } catch (error) {
        server.log.error({ error }, "Language lesson update failed.");
        return reply.code(503).send({
          error: "LANGUAGES_UNAVAILABLE",
          message: "No se pudo guardar el material.",
        });
      }
    },
  );
}
