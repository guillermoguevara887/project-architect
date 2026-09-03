import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import {
  curriculumUnitReviewInputSchema,
  CurriculumUnitReviewServiceError,
  type CurriculumUnitReviewRecord,
  type CurriculumUnitReviewService,
} from "./unit-review.js";

const pathSchema = z.object({ unitRecordId: z.string().uuid() }).strict();

async function authenticatedUserId(request: FastifyRequest, authStore: AuthStore) {
  const userId = readSessionUserId(request.headers.cookie);
  if (!userId) return null;
  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

function publicReview(review: CurriculumUnitReviewRecord) {
  return {
    id: review.id,
    sourceUnitRecordId: review.sourceUnitRecordId,
    action: review.action,
    reviewNote: review.reviewNote,
    promotedSpec: review.promotedSpec,
    promotedSpecSha256: review.promotedSpecSha256,
    reviewedAt: review.reviewedAt.toISOString(),
  };
}

function serviceErrorReply(
  error: CurriculumUnitReviewServiceError,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
) {
  if (error.code === "candidate_not_found") {
    return reply.code(404).send({ error: error.code, detail: error.detail ?? null });
  }
  if (error.code === "already_reviewed") {
    return reply.code(409).send({ error: error.code, detail: error.detail ?? null });
  }
  return reply.code(422).send({ error: error.code, detail: error.detail ?? null });
}

export function registerCurriculumUnitReviewRoutes(
  server: FastifyInstance,
  dependencies: { authStore: AuthStore; service: CurriculumUnitReviewService },
) {
  const { authStore, service } = dependencies;

  server.post("/languages/curriculum-units/:unitRecordId/review", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const path = pathSchema.safeParse(request.params);
    const body = curriculumUnitReviewInputSchema.safeParse(request.body);
    if (!path.success || !body.success) {
      return reply.code(400).send({ error: "Invalid curriculum unit review request." });
    }
    try {
      const review = await service.review(userId, path.data.unitRecordId, body.data);
      return reply.code(201).send({ review: publicReview(review) });
    } catch (error) {
      if (error instanceof CurriculumUnitReviewServiceError) {
        return serviceErrorReply(error, reply);
      }
      throw error;
    }
  });

  server.get("/languages/curriculum-units/:unitRecordId/review", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const path = pathSchema.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ error: "Invalid curriculum unit id." });
    const review = await service.getReview(userId, path.data.unitRecordId);
    if (!review) return reply.code(404).send({ error: "curriculum_unit_review_not_found" });
    return { review: publicReview(review) };
  });
}
