import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import { lessonSpecSchema } from "../lessons/lesson-spec.js";
import type {
  GeneratedLessonRecord,
  LessonGenerationRunRecord,
} from "./repository.js";
import {
  ProductionLessonGenerationServiceError,
  type ProductionLessonGenerationService,
} from "./service.js";

const generateLessonBodySchema = z
  .object({
    lessonSpec: lessonSpecSchema,
  })
  .strict();

const generationRunPathSchema = z
  .object({
    generationRunId: z.string().uuid(),
  })
  .strict();

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);
  if (!userId) return null;
  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

function publicRun(run: LessonGenerationRunRecord) {
  return {
    id: run.id,
    lessonSpecId: run.lessonSpecId,
    lessonSpecVersion: run.lessonSpecVersion,
    languageId: run.languageId,
    varietyId: run.varietyId,
    levelId: run.levelId,
    unitId: run.unitId,
    routeNodeRef: run.routeNodeRef,
    generationIntent: run.generationIntent,
    generatorKey: run.generatorKey,
    provider: run.provider,
    model: run.model,
    status: run.status,
    attempts: run.attempts,
    validationHistory: run.validationHistory,
    errorCode: run.errorCode,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function publicLesson(lesson: GeneratedLessonRecord | null) {
  if (!lesson) return null;
  return {
    id: lesson.id,
    generationRunId: lesson.generationRunId,
    generatedLesson: lesson.generatedLesson,
    contentSha256: lesson.contentSha256,
    createdAt: lesson.createdAt.toISOString(),
  };
}

function serviceErrorReply(
  error: ProductionLessonGenerationServiceError,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
) {
  if (error.code === "invalid_lesson_spec") {
    return reply.code(400).send({
      error: error.code,
      reason: error.detail ?? null,
      validationHistory: error.validationHistory,
    });
  }
  if (error.code === "not_found") {
    return reply.code(404).send({ error: error.code });
  }

  const unavailable =
    error.detail === "not_configured" ||
    error.detail === "provider_error";
  return reply.code(unavailable ? 503 : 422).send({
    error: error.code,
    reason: error.detail ?? null,
    validationHistory: error.validationHistory,
  });
}

export function registerProductionLessonGenerationRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    service: ProductionLessonGenerationService;
  },
) {
  const { authStore, service } = dependencies;

  server.post("/languages/lesson-generations", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) {
      return reply.code(401).send({ error: "Authentication required." });
    }

    const parsed = generateLessonBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid lesson generation payload." });
    }

    try {
      const result = await service.generate(userId, parsed.data.lessonSpec);
      return reply.code(201).send({
        run: publicRun(result.run),
        lesson: publicLesson(result.lesson),
      });
    } catch (error) {
      if (error instanceof ProductionLessonGenerationServiceError) {
        return serviceErrorReply(error, reply);
      }
      throw error;
    }
  });

  server.get(
    "/languages/lesson-generations/:generationRunId",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) {
        return reply.code(401).send({ error: "Authentication required." });
      }

      const parsed = generationRunPathSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid generation run id." });
      }

      try {
        const result = await service.get(userId, parsed.data.generationRunId);
        return {
          run: publicRun(result.run),
          lesson: publicLesson(result.lesson),
        };
      } catch (error) {
        if (error instanceof ProductionLessonGenerationServiceError) {
          return serviceErrorReply(error, reply);
        }
        throw error;
      }
    },
  );
}
