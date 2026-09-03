import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import {
  LanguageKnowledgeServiceError,
  type LanguageKnowledgeService,
} from "./service.js";

const filterSchema = z
  .object({
    languageId: z.string().min(1).optional(),
    varietyId: z.string().min(1).optional(),
  })
  .strict();
const proposalFilterSchema = z
  .object({
    status: z.enum(["pending_review", "accepted", "rejected"]).optional(),
  })
  .strict();
const proposalPathSchema = z.object({ proposalId: z.string().uuid() }).strict();
const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    evidenceReviewStatus: z.enum(["cross_checked", "human_reviewed"]),
    confidence: z.enum(["medium", "high"]),
    note: z.string().trim().min(1),
  }).strict(),
  z.object({
    action: z.literal("reject"),
    note: z.string().trim().min(1),
  }).strict(),
]);

async function authenticatedUserId(request: FastifyRequest, authStore: AuthStore) {
  const userId = readSessionUserId(request.headers.cookie);
  if (!userId) return null;
  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

function profileSummary(record: Awaited<ReturnType<LanguageKnowledgeService["listProfiles"]>>[number]) {
  return {
    id: record.id,
    profileId: record.profile.identity.profileId,
    languageId: record.profile.identity.languageId,
    varietyId: record.profile.identity.varietyId,
    version: record.profile.version,
    status: record.profile.status,
    contentSha256: record.contentSha256,
    createdAt: record.createdAt.toISOString(),
  };
}

function registrySummary(record: Awaited<ReturnType<LanguageKnowledgeService["listRegistries"]>>[number]) {
  return {
    id: record.id,
    profileRecordId: record.profileRecordId,
    registryId: record.registry.identity.registryId,
    languageId: record.registry.identity.languageId,
    varietyId: record.registry.identity.varietyId,
    curriculumId: record.registry.identity.curriculumId,
    version: record.registry.version,
    status: record.registry.status,
    decisionCount: record.registry.decisions.length,
    contentSha256: record.contentSha256,
    createdAt: record.createdAt.toISOString(),
  };
}

function proposalView(record: Awaited<ReturnType<LanguageKnowledgeService["getProposal"]>>) {
  return {
    id: record.id,
    profileRecordId: record.profileRecordId,
    baseRegistryRecordId: record.baseRegistryRecordId,
    adaptationPlanRef: record.adaptationPlanRef,
    researchTaskRef: record.researchTaskRef,
    proposal: record.proposal,
    status: record.status,
    reviewNote: record.reviewNote,
    reviewEvidenceStatus: record.reviewEvidenceStatus,
    reviewConfidence: record.reviewConfidence,
    promotedRegistryRecordId: record.promotedRegistryRecordId,
    createdAt: record.createdAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
  };
}

function errorReply(
  error: LanguageKnowledgeServiceError,
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
) {
  if (["profile_not_found", "registry_not_found", "proposal_not_found"].includes(error.code)) {
    return reply.code(404).send({ error: error.code });
  }
  if (error.code === "proposal_already_reviewed") {
    return reply.code(409).send({ error: error.code, reason: error.detail ?? null });
  }
  if (["invalid_profile", "invalid_registry", "invalid_decision_candidate", "promotion_invalid", "knowledge_context_mismatch"].includes(error.code)) {
    return reply.code(422).send({ error: error.code, reason: error.detail ?? null });
  }
  return reply.code(500).send({ error: error.code, reason: error.detail ?? null });
}

export function registerLanguageKnowledgeRoutes(
  server: FastifyInstance,
  dependencies: { authStore: AuthStore; service: LanguageKnowledgeService },
) {
  const { authStore, service } = dependencies;

  server.get("/languages/knowledge/profiles", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const query = filterSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid knowledge filters." });
    const records = await service.listProfiles(userId, query.data.languageId, query.data.varietyId);
    return { profiles: records.map(profileSummary) };
  });

  server.get("/languages/knowledge/registries", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const query = filterSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid knowledge filters." });
    const records = await service.listRegistries(userId, query.data.languageId, query.data.varietyId);
    return { registries: records.map(registrySummary) };
  });

  server.get("/languages/decision-proposals", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const query = proposalFilterSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid proposal filters." });
    const records = await service.listProposals(userId, query.data.status);
    return { proposals: records.map(proposalView) };
  });

  server.get("/languages/decision-proposals/:proposalId", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const path = proposalPathSchema.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ error: "Invalid proposal id." });
    try {
      return { proposal: proposalView(await service.getProposal(userId, path.data.proposalId)) };
    } catch (error) {
      if (error instanceof LanguageKnowledgeServiceError) return errorReply(error, reply);
      throw error;
    }
  });

  server.post("/languages/decision-proposals/:proposalId/review", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const path = proposalPathSchema.safeParse(request.params);
    const body = reviewSchema.safeParse(request.body);
    if (!path.success || !body.success) {
      return reply.code(400).send({ error: "Invalid decision review request." });
    }
    try {
      const result = await service.reviewProposal(userId, path.data.proposalId, body.data);
      return reply.code(200).send({
        proposal: proposalView(result.proposal),
        promotedRegistry: result.promotedRegistry ? registrySummary(result.promotedRegistry) : null,
      });
    } catch (error) {
      if (error instanceof LanguageKnowledgeServiceError) return errorReply(error, reply);
      throw error;
    }
  });
}
