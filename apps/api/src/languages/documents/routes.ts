import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import {
  CURRICULUM_DOCUMENT_ROUTE_BODY_LIMIT,
  attachCurriculumExtractedTextSchema,
  curriculumCompilationPathSchema,
  curriculumDocumentPathSchema,
  curriculumDocumentVersionPathSchema,
  ingestCurriculumDocumentSchema,
} from "./contracts.js";
import type {
  CurriculumCompilationRunRecord,
  CurriculumDocumentRecord,
  CurriculumDocumentVersionRecord,
  CurriculumUnitRecord,
} from "./repository.js";
import {
  CurriculumDocumentServiceError,
  type CurriculumDocumentService,
} from "./service.js";

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);
  if (!userId) return null;
  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

function publicDocument(document: CurriculumDocumentRecord) {
  return {
    id: document.id,
    documentId: document.documentId,
    curriculumId: document.curriculumId,
    levelId: document.levelId,
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

function serviceErrorReply(error: CurriculumDocumentServiceError, reply: { code(statusCode: number): { send(payload: unknown): unknown } }) {
  if (error.code === "file_too_large") {
    return reply.code(413).send({ error: error.code });
  }
  if (error.code === "not_found") {
    return reply.code(404).send({ error: error.code });
  }
  if (
    error.code === "identity_conflict" ||
    error.code === "version_conflict" ||
    error.code === "text_conflict" ||
    error.code === "storage_not_ready" ||
    error.code === "not_extractable"
  ) {
    return reply.code(409).send({ error: error.code });
  }
  if (error.code === "storage_error") {
    return reply.code(503).send({ error: error.code });
  }
  return reply.code(error.detail === "not_configured" ? 503 : 422).send({
    error: error.code,
    reason: error.detail ?? null,
    validationHistory: error.validationHistory,
  });
}

export function registerCurriculumDocumentRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    service: CurriculumDocumentService;
  },
) {
  const { authStore, service } = dependencies;

  server.get("/languages/curriculum-documents", async (request, reply) => {
    const userId = await authenticatedUserId(request, authStore);
    if (!userId) return reply.code(401).send({ error: "Authentication required." });
    const documents = await service.listDocuments(userId);
    return { documents: documents.map(publicDocument) };
  });

  server.post(
    "/languages/curriculum-documents",
    { bodyLimit: CURRICULUM_DOCUMENT_ROUTE_BODY_LIMIT },
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const parsed = ingestCurriculumDocumentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid curriculum document payload." });

      try {
        const result = await service.ingest(userId, parsed.data);
        return reply.code(201).send({
          document: publicDocument(result.document),
          version: publicVersion(result.version),
        });
      } catch (error) {
        if (error instanceof CurriculumDocumentServiceError) return serviceErrorReply(error, reply);
        throw error;
      }
    },
  );

  server.get(
    "/languages/curriculum-documents/:documentId/versions",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const parsed = curriculumDocumentPathSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid document id." });
      const versions = await service.listVersions(userId, parsed.data.documentId);
      if (!versions) return reply.code(404).send({ error: "not_found" });
      return { versions: versions.map(publicVersion) };
    },
  );

  server.get(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const parsed = curriculumDocumentVersionPathSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid document version path." });
      const result = await service.getVersion(userId, parsed.data.documentId, parsed.data.documentVersion);
      if (!result) return reply.code(404).send({ error: "not_found" });
      return { document: publicDocument(result.document), version: publicVersion(result.version) };
    },
  );

  server.put(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/extracted-text",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = curriculumDocumentVersionPathSchema.safeParse(request.params);
      const body = attachCurriculumExtractedTextSchema.safeParse(request.body);
      if (!path.success || !body.success) return reply.code(400).send({ error: "Invalid extracted text request." });
      try {
        const version = await service.attachExtractedText(userId, path.data.documentId, path.data.documentVersion, body.data);
        return { version: publicVersion(version) };
      } catch (error) {
        if (error instanceof CurriculumDocumentServiceError) return serviceErrorReply(error, reply);
        throw error;
      }
    },
  );

  server.post(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/compile",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = curriculumDocumentVersionPathSchema.safeParse(request.params);
      if (!path.success) return reply.code(400).send({ error: "Invalid compile path." });
      try {
        const result = await service.compile(userId, path.data.documentId, path.data.documentVersion);
        return reply.code(201).send({ run: publicCompilation(result.run), units: result.units.map(publicUnit) });
      } catch (error) {
        if (error instanceof CurriculumDocumentServiceError) return serviceErrorReply(error, reply);
        throw error;
      }
    },
  );

  server.get(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/compilations/:compilationRunId",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) return reply.code(401).send({ error: "Authentication required." });
      const path = curriculumCompilationPathSchema.safeParse(request.params);
      if (!path.success) return reply.code(400).send({ error: "Invalid compilation path." });
      const version = await service.getVersion(userId, path.data.documentId, path.data.documentVersion);
      if (!version) return reply.code(404).send({ error: "not_found" });
      const compilation = await service.getCompilation(userId, path.data.compilationRunId);
      if (!compilation || compilation.run.documentVersionId !== version.version.id) return reply.code(404).send({ error: "not_found" });
      return { run: publicCompilation(compilation.run), units: compilation.units.map(publicUnit) };
    },
  );
}
