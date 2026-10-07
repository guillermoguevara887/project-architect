import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../../auth/repository.js";
import { requireSuperadmin } from "../../auth/authorization.js";
import { readSession } from "../../auth/session.js";
import {
  curriculumCompilationPathSchema,
  curriculumDocumentPathSchema,
  curriculumDocumentVersionPathSchema,
} from "./contracts.js";
import type {
  CurriculumCompilationRunRecord,
  CurriculumDocumentRecord,
  CurriculumDocumentVersionRecord,
  CurriculumUnitRecord,
} from "./repository.js";
import type { CurriculumDocumentService } from "./service.js";

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const session = readSession(request.headers.cookie);
  if (!session) return null;
  const user = await authStore.findById(session.userId);
  return user?.sessionVersion === session.sessionVersion ? user.id : null;
}

function publicDocument(document: CurriculumDocumentRecord) {
  return {
    id: document.id,
    documentId: document.documentId,
    curriculumId: document.curriculumId,
    levelId: document.levelId,
    unitId: document.unitId,
    unitOrder: document.unitOrder,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function publicVersion(version: CurriculumDocumentVersionRecord) {
  return {
    id: version.id,
    documentVersion: version.documentVersion,
    sourceTitle: version.sourceTitle,
    sourceLanguageHint: version.sourceLanguageHint,
    sourceFormat: version.sourceFormat,
    originalFilename: version.originalFilename,
    mediaType: version.mediaType,
    contentSha256: version.contentSha256,
    byteSize: version.byteSize,
    storageStatus: version.storageStatus,
    extractionStatus: version.extractionStatus,
    extractedTextSha256: version.extractedTextSha256,
    extractionMethod: version.extractionMethod,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

function publicCompilation(run: CurriculumCompilationRunRecord) {
  return {
    id: run.id,
    documentVersionId: run.documentVersionId,
    boundaryKey: run.boundaryKey,
    status: run.status,
    attempts: run.attempts,
    validationHistory: run.validationHistory,
    errorCode: run.errorCode,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function publicUnit(unit: CurriculumUnitRecord) {
  return {
    id: unit.id,
    unitId: unit.unitId,
    specVersion: unit.specVersion,
    unitOrder: unit.unitOrder,
    status: unit.status,
    spec: unit.spec,
    createdAt: unit.createdAt.toISOString(),
  };
}

export function registerCurriculumDocumentRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    service: CurriculumDocumentService;
  },
) {
  const { authStore, service } = dependencies;

  server.get("/languages/curriculum-documents", { preHandler: requireSuperadmin(authStore) }, async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const documents = await service.listDocuments();
    return { documents: documents.map(publicDocument) };
  });

  server.post(
    "/languages/curriculum-documents",
    { preHandler: requireSuperadmin(authStore) },
    async (_request, reply) => reply.code(410).send({ error: "LEGACY_CURRICULUM_MUTATION_RETIRED" }),
  );

  server.get(
    "/languages/curriculum-documents/:documentId/versions",
    { preHandler: requireSuperadmin(authStore) },
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const parsed = curriculumDocumentPathSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid document id." });
      const versions = await service.listVersions(parsed.data.documentId);
      if (!versions) return reply.code(404).send({ error: "not_found" });
      return { versions: versions.map(publicVersion) };
    },
  );

  server.get(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion",
    { preHandler: requireSuperadmin(authStore) },
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const parsed = curriculumDocumentVersionPathSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid document version path." });
      const result = await service.getVersion(parsed.data.documentId, parsed.data.documentVersion);
      if (!result) return reply.code(404).send({ error: "not_found" });
      return { document: publicDocument(result.document), version: publicVersion(result.version) };
    },
  );

  server.put(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/extracted-text",
    { preHandler: requireSuperadmin(authStore) },
    async (_request, reply) => reply.code(410).send({ error: "LEGACY_CURRICULUM_MUTATION_RETIRED" }),
  );

  server.post(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/compile",
    { preHandler: requireSuperadmin(authStore) },
    async (_request, reply) => reply.code(410).send({ error: "LEGACY_CURRICULUM_MUTATION_RETIRED" }),
  );

  server.get(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/compilations/:compilationRunId",
    { preHandler: requireSuperadmin(authStore) },
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = curriculumCompilationPathSchema.safeParse(request.params);
      if (!path.success) return reply.code(400).send({ error: "Invalid compilation path." });
      const version = await service.getVersion(path.data.documentId, path.data.documentVersion);
      if (!version) return reply.code(404).send({ error: "not_found" });
      const compilation = await service.getCompilation(path.data.compilationRunId);
      if (!compilation || compilation.run.documentVersionId !== version.version.id) return reply.code(404).send({ error: "not_found" });
      return { run: publicCompilation(compilation.run), units: compilation.units.map(publicUnit) };
    },
  );
}
