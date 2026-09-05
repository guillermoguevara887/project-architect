import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../../auth/repository.js";
import { readSessionUserId } from "../../auth/session.js";
import { curriculumDocumentVersionPathSchema } from "./contracts.js";
import type {
  CurriculumCompilationRunRecord,
  CurriculumDocumentVersionRecord,
  CurriculumUnitRecord,
} from "./repository.js";
import { CurriculumDocumentServiceError } from "./service.js";
import {
  RealCurriculumDocumentWorkflowError,
  type RealCurriculumDocumentWorkflow,
} from "./real-document-workflow.js";

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);
  if (!userId) return null;
  const user = await authStore.findById(userId);
  return user?.id ?? null;
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

function documentServiceErrorStatus(error: CurriculumDocumentServiceError) {
  if (error.code === "not_found") return 404;
  if (
    error.code === "identity_conflict" ||
    error.code === "version_conflict" ||
    error.code === "text_conflict" ||
    error.code === "storage_not_ready" ||
    error.code === "not_extractable"
  ) {
    return 409;
  }
  if (error.code === "storage_error" || error.detail === "not_configured") {
    return 503;
  }
  return 422;
}

function workflowErrorStatus(error: RealCurriculumDocumentWorkflowError) {
  if (error.code === "not_found") return 404;
  if (error.code === "storage_not_ready") return 409;
  if (error.code === "unsupported_media_type") return 415;
  if (
    error.code === "storage_error" ||
    error.code === "storage_integrity_error" ||
    error.detail === "not_configured"
  ) {
    return 503;
  }
  return 422;
}

export function registerRealCurriculumDocumentWorkflowRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    workflow: RealCurriculumDocumentWorkflow;
  },
) {
  const { authStore, workflow } = dependencies;

  server.post(
    "/languages/curriculum-documents/:documentId/versions/:documentVersion/process",
    async (request, reply) => {
      const userId = await authenticatedUserId(request, authStore);
      if (!userId) {
        return reply.code(401).send({ error: "Authentication required." });
      }

      const path = curriculumDocumentVersionPathSchema.safeParse(request.params);
      if (!path.success) {
        return reply.code(400).send({ error: "Invalid process path." });
      }

      try {
        const result = await workflow.process(
          userId,
          path.data.documentId,
          path.data.documentVersion,
        );
        return reply.code(201).send({
          extractionPerformed: result.extractionPerformed,
          version: publicVersion(result.version),
          run: publicCompilation(result.compilation.run),
          units: result.compilation.units.map(publicUnit),
        });
      } catch (error) {
        if (error instanceof RealCurriculumDocumentWorkflowError) {
          return reply.code(workflowErrorStatus(error)).send({
            error: error.code,
            reason: error.detail ?? null,
          });
        }
        if (error instanceof CurriculumDocumentServiceError) {
          return reply.code(documentServiceErrorStatus(error)).send({
            error: error.code,
            reason: error.detail ?? null,
            validationHistory: error.validationHistory,
            ...(error.providerMetadata
              ? { providerMetadata: error.providerMetadata }
              : {}),
          });
        }
        throw error;
      }
    },
  );
}
