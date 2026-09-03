import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import {
  CurriculumOrchestrationServiceError,
  type CurriculumOrchestrationService,
} from "./service.js";

const planningBundlePathSchema = z
  .object({ planningBundleId: z.string().uuid() })
  .strict();

const orchestrationRunPathSchema = z
  .object({ orchestrationRunId: z.string().uuid() })
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

function publicRun(run: {
  id: string;
  planningBundleId: string;
  status: string;
  expectedLessonCount: number;
  generationRunIds: string[];
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: run.id,
    planningBundleId: run.planningBundleId,
    status: run.status,
    expectedLessonCount: run.expectedLessonCount,
    generationRunIds: run.generationRunIds,
    errorCode: run.errorCode,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function serviceErrorReply(
  error: CurriculumOrchestrationServiceError,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
) {
  if (
    error.code === "planning_bundle_not_found" ||
    error.code === "orchestration_not_found"
  ) {
    return reply.code(404).send({ error: error.code });
  }
  return reply.code(502).send({
    error: error.code,
    reason: error.detail ?? null,
    orchestrationRunId: error.orchestrationRunId ?? null,
  });
}

export function registerCurriculumOrchestrationRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    service: CurriculumOrchestrationService;
  },
) {
  const { authStore, service } = dependencies;

  server.post(
    "/languages/curriculum-planning-bundles/:planningBundleId/generate",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) {
        return reply.code(401).send({ error: "Authentication required." });
      }
      const path = planningBundlePathSchema.safeParse(request.params);
      if (!path.success) {
        return reply.code(400).send({ error: "Invalid planning bundle id." });
      }

      try {
        const run = await service.generatePlanningBundle(
          userId,
          path.data.planningBundleId,
        );
        return reply.code(201).send({ run: publicRun(run) });
      } catch (error) {
        if (error instanceof CurriculumOrchestrationServiceError) {
          return serviceErrorReply(error, reply);
        }
        throw error;
      }
    },
  );

  server.get(
    "/languages/curriculum-orchestrations/:orchestrationRunId",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) {
        return reply.code(401).send({ error: "Authentication required." });
      }
      const path = orchestrationRunPathSchema.safeParse(request.params);
      if (!path.success) {
        return reply.code(400).send({ error: "Invalid orchestration run id." });
      }

      try {
        const run = await service.getRun(
          userId,
          path.data.orchestrationRunId,
        );
        return { run: publicRun(run) };
      } catch (error) {
        if (error instanceof CurriculumOrchestrationServiceError) {
          return serviceErrorReply(error, reply);
        }
        throw error;
      }
    },
  );
}
