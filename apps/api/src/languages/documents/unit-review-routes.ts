import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStore } from "../../auth/repository.js";
import { requireSuperadmin } from "../../auth/authorization.js";
import { readSession } from "../../auth/session.js";
import {
  type CurriculumUnitReviewRecord,
  type CurriculumUnitReviewService,
} from "./unit-review.js";

const pathSchema = z.object({ unitRecordId: z.string().uuid() }).strict();

async function authenticatedUserId(request: FastifyRequest, authStore: AuthStore) {
  const session = readSession(request.headers.cookie);
  if (!session) return null;
  const user = await authStore.findById(session.userId);
  return user?.sessionVersion === session.sessionVersion ? user.id : null;
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

export function registerCurriculumUnitReviewRoutes(
  server: FastifyInstance,
  dependencies: { authStore: AuthStore; service: CurriculumUnitReviewService },
) {
  const { authStore, service } = dependencies;

  server.post("/languages/curriculum-units/:unitRecordId/review", { preHandler: requireSuperadmin(authStore) }, async (_request, reply) =>
    reply.code(410).send({ error: "LEGACY_CURRICULUM_MUTATION_RETIRED" }));

  server.get("/languages/curriculum-units/:unitRecordId/review", { preHandler: requireSuperadmin(authStore) }, async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const path = pathSchema.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ error: "Invalid curriculum unit id." });
    const review = await service.getReview(path.data.unitRecordId);
    if (!review) return reply.code(404).send({ error: "curriculum_unit_review_not_found" });
    return { review: publicReview(review) };
  });
}
