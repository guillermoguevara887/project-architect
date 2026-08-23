import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../auth/repository.js";
import { readSessionUserId } from "../auth/session.js";
import {
  createLanguageLessonSchema,
  createLanguageProjectSchema,
  LANGUAGE_LESSON_SOURCE_MAX_LENGTH,
  languageLessonIdSchema,
  languageProjectIdSchema,
  processLanguageLessonSchema,
  structuredLanguageLessonSchema,
  updateLanguageLessonSchema,
} from "./contracts.js";
import {
  LanguageLessonProcessingError,
  type LanguageLessonProcessor,
} from "./lesson-processor.js";
import type {
  LanguageLesson,
  LanguageProject,
  LanguageStore,
} from "./repository.js";
import { effectiveLanguageLessonStatus } from "./repository.js";

function publicProject(project: LanguageProject) {
  return {
    id: project.id,
    language: project.language,
    level: project.level,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function publicLessonSummary(lesson: LanguageLesson) {
  const status = effectiveLanguageLessonStatus(lesson);

  return {
    id: lesson.id,
    languageProjectId: lesson.languageProjectId,
    lessonNumber: lesson.lessonNumber,
    lessonSource: lesson.lessonSource,
    sourceLessonNumber: lesson.sourceLessonNumber,
    status,
    processedAt: lesson.processedAt?.toISOString() ?? null,
    createdAt: lesson.createdAt.toISOString(),
    updatedAt: lesson.updatedAt.toISOString(),
  };
}

function publicLesson(lesson: LanguageLesson) {
  const summary = publicLessonSummary(lesson);

  if (summary.status === "ready") {
    const simplifiedStructuredContent = lesson.simplifiedStructuredContent
      ? structuredLanguageLessonSchema.parse(
          lesson.simplifiedStructuredContent,
        )
      : null;

    return {
      ...summary,
      structuredContent: structuredLanguageLessonSchema.parse(
        lesson.structuredContent,
      ),
      simplifiedStructuredContent,
      simplifiedAt: lesson.simplifiedAt?.toISOString() ?? null,
    };
  }

  return {
    ...summary,
    sourceContent: lesson.sourceContent,
    structuredContent: null,
    simplifiedStructuredContent: null,
    simplifiedAt: null,
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
  processor: LanguageLessonProcessor,
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

        return { lessons: lessons.map(publicLessonSummary) };
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

        const parsedInput = createLanguageLessonSchema.safeParse(
          request.body ?? {},
        );

        if (!parsedInput.success) {
          return reply.code(400).send({
            error: "INVALID_LANGUAGE_LESSON_SOURCE",
            message: "Selecciona una procedencia válida para la lección.",
          });
        }

        const lesson = await store.createNextLesson({
          languageProjectId: request.params.projectId,
          userId,
          lessonSource: parsedInput.data.lessonSource,
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

        const result = await store.updateLessonSourceContent({
          languageProjectId: request.params.projectId,
          lessonId: request.params.lessonId,
          userId,
          sourceContent: parsedInput.data.sourceContent,
        });

        if (result.kind === "not_found") {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        if (result.kind === "not_editable") {
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_NOT_EDITABLE",
            message: "Una lección procesada no se puede editar.",
          });
        }

        return { lesson: publicLesson(result.lesson) };
      } catch (error) {
        server.log.error({ error }, "Language lesson update failed.");
        return reply.code(503).send({
          error: "LANGUAGES_UNAVAILABLE",
          message: "No se pudo guardar el material.",
        });
      }
    },
  );

  server.post<{ Params: { projectId: string; lessonId: string } }>(
    "/languages/projects/:projectId/lessons/:lessonId/process",
    async (request, reply) => {
      const { projectId, lessonId } = request.params;
      let userId: string | null = null;
      let processingStartedAt: Date | null = null;

      try {
        userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (
          !languageProjectIdSchema.safeParse(projectId).success ||
          !languageLessonIdSchema.safeParse(lessonId).success
        ) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        const sourceContent =
          request.body &&
          typeof request.body === "object" &&
          "sourceContent" in request.body
            ? request.body.sourceContent
            : undefined;

        if (
          typeof sourceContent === "string" &&
          sourceContent.length > LANGUAGE_LESSON_SOURCE_MAX_LENGTH
        ) {
          return reply.code(413).send({
            error: "LANGUAGE_LESSON_SOURCE_TOO_LARGE",
            message:
              `El material supera el límite de ${LANGUAGE_LESSON_SOURCE_MAX_LENGTH.toLocaleString("es")} caracteres.`,
          });
        }

        const parsedInput = processLanguageLessonSchema.safeParse(request.body);

        if (!parsedInput.success) {
          return reply.code(400).send({
            error: "INVALID_LANGUAGE_LESSON",
            message: "Pega material antes de procesar la lección.",
          });
        }

        const claim = await store.claimLessonForProcessing({
          languageProjectId: projectId,
          lessonId,
          userId,
          sourceContent: parsedInput.data.sourceContent,
        });

        if (claim.kind === "not_found") {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        if (claim.kind === "already_ready") {
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_ALREADY_PROCESSED",
            message: "La lección ya fue procesada.",
          });
        }

        if (claim.kind === "processing") {
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_PROCESSING",
            message: "La lección ya se está procesando.",
          });
        }

        const claimedAt = claim.lesson.updatedAt;
        processingStartedAt = claimedAt;
        const structuredContent = await processor.process({
          language: claim.project.language,
          level: claim.project.level,
          sourceContent: parsedInput.data.sourceContent,
        });
        const lesson = await store.completeLessonProcessing({
          languageProjectId: projectId,
          lessonId,
          userId,
          processingStartedAt: claimedAt,
          structuredContent,
        });

        if (!lesson) {
          server.log.warn(
            { projectId, lessonId, processingState: "changed" },
            "Language lesson completion was not persisted.",
          );
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_STATE_CHANGED",
            message: "La lección cambió mientras se procesaba.",
          });
        }

        return { lesson: publicLesson(lesson) };
      } catch (error) {
        if (userId && processingStartedAt) {
          try {
            await store.failLessonProcessing({
              languageProjectId: projectId,
              lessonId,
              userId,
              processingStartedAt,
            });
          } catch {
            server.log.error(
              { projectId, lessonId, errorType: "failure_state_persist_error" },
              "Language lesson failure state could not be persisted.",
            );
          }
        }

        server.log.error(
          {
            projectId,
            lessonId,
            errorType:
              error instanceof LanguageLessonProcessingError
                ? error.code
                : "unexpected",
          },
          "Language lesson processing failed.",
        );
        return reply.code(502).send({
          error: "LANGUAGE_LESSON_PROCESSING_FAILED",
          message: "No se pudo procesar la lección. Intenta nuevamente.",
        });
      }
    },
  );

  server.post<{ Params: { projectId: string; lessonId: string } }>(
    "/languages/projects/:projectId/lessons/:lessonId/simplify",
    async (request, reply) => {
      const { projectId, lessonId } = request.params;
      let userId: string | null = null;
      let simplificationStartedAt: Date | null = null;

      try {
        userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (
          !languageProjectIdSchema.safeParse(projectId).success ||
          !languageLessonIdSchema.safeParse(lessonId).success
        ) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        const claim = await store.claimLessonForSimplification({
          languageProjectId: projectId,
          lessonId,
          userId,
        });

        if (claim.kind === "not_found") {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        if (claim.kind === "not_ready") {
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_NOT_READY",
            message: "Solo una lección procesada se puede simplificar.",
          });
        }

        if (claim.kind === "already_simplified") {
          return { lesson: publicLesson(claim.lesson) };
        }

        if (claim.kind === "processing") {
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_SIMPLIFICATION_PROCESSING",
            message: "La lección ya se está simplificando.",
          });
        }

        const claimedAt = claim.lesson.simplificationStartedAt;

        if (!claimedAt) {
          throw new Error("Language lesson simplification claim is missing.");
        }

        simplificationStartedAt = claimedAt;
        const structuredContent = structuredLanguageLessonSchema.parse(
          claim.lesson.structuredContent,
        );
        const simplifiedStructuredContent = await processor.simplify({
          language: claim.project.language,
          level: claim.project.level,
          structuredContent,
        });
        const lesson = await store.completeLessonSimplification({
          languageProjectId: projectId,
          lessonId,
          userId,
          simplificationStartedAt: claimedAt,
          simplifiedStructuredContent,
        });

        if (!lesson) {
          server.log.warn(
            { projectId, lessonId, simplificationState: "changed" },
            "Language lesson simplification was not persisted.",
          );
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_STATE_CHANGED",
            message: "La lección cambió mientras se simplificaba.",
          });
        }

        return { lesson: publicLesson(lesson) };
      } catch (error) {
        if (userId && simplificationStartedAt) {
          try {
            await store.failLessonSimplification({
              languageProjectId: projectId,
              lessonId,
              userId,
              simplificationStartedAt,
            });
          } catch {
            server.log.error(
              {
                projectId,
                lessonId,
                errorType: "simplification_failure_state_persist_error",
              },
              "Language lesson simplification failure state could not be cleared.",
            );
          }
        }

        server.log.error(
          {
            projectId,
            lessonId,
            errorType:
              error instanceof LanguageLessonProcessingError
                ? error.code
                : "unexpected",
          },
          "Language lesson simplification failed.",
        );
        return reply.code(502).send({
          error: "LANGUAGE_LESSON_SIMPLIFICATION_FAILED",
          message: "No se pudo simplificar la lección. Intenta nuevamente.",
        });
      }
    },
  );

  server.delete<{ Params: { projectId: string; lessonId: string } }>(
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

        const deleted = await store.deleteLesson(
          request.params.lessonId,
          request.params.projectId,
          userId,
        );

        if (!deleted) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        return reply.code(204).send();
      } catch (error) {
        server.log.error({ error }, "Language lesson deletion failed.");
        return reply.code(503).send({
          error: "LANGUAGES_UNAVAILABLE",
          message: "No se pudo eliminar la lección.",
        });
      }
    },
  );
}
