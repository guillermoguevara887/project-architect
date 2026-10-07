import type { FastifyInstance } from "fastify";
import { requireSuperadmin } from "../../auth/authorization.js";
import type { AuthStore } from "../../auth/repository.js";
import type { RealCurriculumDocumentWorkflow } from "./real-document-workflow.js";

export function registerRealCurriculumDocumentWorkflowRoutes(
  server: FastifyInstance,
  dependencies: { authStore: AuthStore; workflow: RealCurriculumDocumentWorkflow },
) {
  server.post(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/process",
    { preHandler: requireSuperadmin(dependencies.authStore) },
    async (_request, reply) => reply.code(410).send({ error: "LEGACY_CURRICULUM_MUTATION_RETIRED" }),
  );
}
