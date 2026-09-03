import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import type { ProfileResearchRunRecord } from "./repository.js";
import {
  ProfileResearchServiceError,
  type ProfileResearchService,
} from "./service.js";

const resolutionPathSchema = z.object({ runId: z.string().uuid() }).strict();
const researchPathSchema = z.object({ researchRunId: z.string().uuid() }).strict();
const emptyBodySchema = z.object({}).strict();

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);
  if (!userId) return null;
  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

function publicRun(run: ProfileResearchRunRecord) {
  return {
    id: run.id,
    adaptationResolutionRunId: run.adaptationResolutionRunId,
    resumedResolutionRunId: run.resumedResolutionRunId,
    baseProfileRecordId: run.baseProfileRecordId,
    enrichedProfileRecordId: run.enrichedProfileRecordId,
    stage: run.stage,
    researchTaskRefs: run.researchTaskRefs,
    candidate: run.candidate,
    observedUrls: run.observedUrls,
    providerModel: run.providerModel,
    validationHistory: run.validationHistory,
    detail: run.detail,
    contentSha256: run.contentSha256,
    createdAt: run.createdAt.toISOString(),
  };
}

function serviceErrorReply(
  error: ProfileResearchServiceError,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
) {
  if (
    error.code === "resolution_run_not_found" ||
    error.code === "context_not_found" ||
    error.code === "research_run_not_found"
  ) {
    return reply.code(404).send({
      error: error.code,
      detail: error.detail ?? null,
      researchRunId: error.researchRunId ?? null,
    });
  }
  if (
    error.code === "invalid_resolution_stage" ||
    error.code === "research_tasks_missing"
  ) {
    return reply.code(409).send({
      error: error.code,
      detail: error.detail ?? null,
      researchRunId: error.researchRunId ?? null,
    });
  }
  if (error.code === "research_failed" && error.detail === "not_configured") {
    return reply.code(503).send({
      error: error.code,
      detail: error.detail,
      researchRunId: error.researchRunId ?? null,
    });
  }
  return reply.code(422).send({
    error: error.code,
    detail: error.detail ?? null,
    researchRunId: error.researchRunId ?? null,
  });
}

export function registerProfileResearchRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    service: ProfileResearchService;
  },
) {
  const { authStore, service } = dependencies;

  server.post(
    "/languages/adaptation-resolution-runs/:runId/profile-research",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = resolutionPathSchema.safeParse(request.params);
      const body = emptyBodySchema.safeParse(request.body ?? {});
      if (!path.success || !body.success) {
        return reply.code(400).send({ error: "Invalid profile research request." });
      }
      try {
        const result = await service.researchBlockedRun({
          userId,
          resolutionRunId: path.data.runId,
        });
        return reply.code(201).send({ run: publicRun(result.researchRun) });
      } catch (error) {
        if (error instanceof ProfileResearchServiceError) {
          return serviceErrorReply(error, reply);
        }
        throw error;
      }
    },
  );

  server.get(
    "/languages/profile-research-runs/:researchRunId",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = researchPathSchema.safeParse(request.params);
      if (!path.success) {
        return reply.code(400).send({ error: "Invalid profile research run id." });
      }
      try {
        const run = await service.getRun(userId, path.data.researchRunId);
        return { run: publicRun(run) };
      } catch (error) {
        if (error instanceof ProfileResearchServiceError) {
          return serviceErrorReply(error, reply);
        }
        throw error;
      }
    },
  );
}
