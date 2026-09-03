import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import type { AdaptationResolutionRunRecord } from "./repository.js";
import {
  AdaptationResolutionServiceError,
  type AdaptationResolutionService,
} from "./service.js";

const startSchema = z
  .object({
    curriculumUnitRecordId: z.string().uuid(),
    profileRecordId: z.string().uuid(),
    registryRecordId: z.string().uuid(),
  })
  .strict();

const runPathSchema = z.object({ runId: z.string().uuid() }).strict();

const resumeSchema = z
  .object({
    profileRecordId: z.string().uuid().optional(),
    registryRecordId: z.string().uuid().optional(),
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

function publicRun(run: AdaptationResolutionRunRecord) {
  return {
    id: run.id,
    curriculumUnitRecordId: run.curriculumUnitRecordId,
    profileRecordId: run.profileRecordId,
    registryRecordId: run.registryRecordId,
    previousRunId: run.previousRunId,
    stage: run.stage,
    adaptationPlan: run.adaptationPlan,
    activeResearchTaskRef: run.activeResearchTaskRef,
    blockedResearchTaskRefs: run.blockedResearchTaskRefs,
    proposalIds: run.proposalIds,
    detail: run.detail,
    contentSha256: run.contentSha256,
    createdAt: run.createdAt.toISOString(),
  };
}

function serviceErrorReply(
  error: AdaptationResolutionServiceError,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
) {
  if (
    error.code === "context_not_found" ||
    error.code === "resolution_run_not_found" ||
    error.code === "proposal_not_found"
  ) {
    return reply.code(404).send({ error: error.code, detail: error.detail ?? null });
  }
  if (
    error.code === "decision_review_pending" ||
    error.code === "resume_requires_updated_knowledge"
  ) {
    return reply.code(409).send({
      error: error.code,
      detail: error.detail ?? null,
      resolutionRunId: error.resolutionRunId ?? null,
    });
  }
  if (error.code === "decision_proposal_failed") {
    return reply.code(error.detail === "not_configured" ? 503 : 422).send({
      error: error.code,
      detail: error.detail ?? null,
      resolutionRunId: error.resolutionRunId ?? null,
    });
  }
  return reply.code(422).send({
    error: error.code,
    detail: error.detail ?? null,
    resolutionRunId: error.resolutionRunId ?? null,
  });
}

export function registerAdaptationResolutionRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    service: AdaptationResolutionService;
  },
) {
  const { authStore, service } = dependencies;

  server.post("/languages/adaptation-resolution-runs", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid adaptation resolution request." });
    }
    try {
      const run = await service.start({ userId, ...parsed.data });
      return reply.code(201).send({ run: publicRun(run) });
    } catch (error) {
      if (error instanceof AdaptationResolutionServiceError) {
        return serviceErrorReply(error, reply);
      }
      throw error;
    }
  });

  server.get(
    "/languages/adaptation-resolution-runs/:runId",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = runPathSchema.safeParse(request.params);
      if (!path.success) return reply.code(400).send({ error: "Invalid resolution run id." });
      const run = await service.getRun(userId, path.data.runId);
      if (!run) return reply.code(404).send({ error: "resolution_run_not_found" });
      return { run: publicRun(run) };
    },
  );

  server.post(
    "/languages/adaptation-resolution-runs/:runId/resume",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = runPathSchema.safeParse(request.params);
      const body = resumeSchema.safeParse(request.body ?? {});
      if (!path.success || !body.success) {
        return reply.code(400).send({ error: "Invalid adaptation resume request." });
      }
      try {
        const run = await service.resume({
          userId,
          runId: path.data.runId,
          ...body.data,
        });
        return reply.code(201).send({ run: publicRun(run) });
      } catch (error) {
        if (error instanceof AdaptationResolutionServiceError) {
          return serviceErrorReply(error, reply);
        }
        throw error;
      }
    },
  );
}
