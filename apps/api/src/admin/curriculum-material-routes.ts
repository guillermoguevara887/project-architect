import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readAuthenticatedUser } from "../auth/authenticated-user.js";
import { requireSuperadmin } from "../auth/authorization.js";
import type { AuthStore } from "../auth/repository.js";
import { CURRICULUM_DOCUMENT_ROUTE_BODY_LIMIT } from "../languages/documents/contracts.js";
import { RealCurriculumDocumentWorkflowError, type RealCurriculumDocumentWorkflow } from "../languages/documents/real-document-workflow.js";
import { CurriculumDocumentServiceError, type CurriculumDocumentService } from "../languages/documents/service.js";
import { curriculumUnitReviewInputSchema, CurriculumUnitReviewServiceError, type CurriculumUnitReviewService } from "../languages/documents/unit-review.js";

export const CURRICULUM_ID = "memoos-core-language";
export const CURRICULUM_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
const levelSchema = z.enum(CURRICULUM_LEVELS);
const levelPath = z.object({ levelId: levelSchema }).strict();
const unitPath = z.object({ levelId: levelSchema, unitOrder: z.coerce.number().int().positive().max(999999) }).strict();
const reviewPath = z.object({ unitRecordId: z.string().uuid() }).strict();
const uploadBody = z.object({
  fileBase64: z.string().min(1).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  originalFilename: z.string().trim().min(1).max(255),
  sourceTitle: z.string().trim().min(1).max(240),
}).strict();

export function curriculumUnitId(levelId: string, unitOrder: number) {
  return `${levelId}-U${String(unitOrder).padStart(2, "0")}`;
}

function materialError(error: unknown, reply: { code(code: number): { send(value: unknown): unknown } }) {
  if (error instanceof CurriculumDocumentServiceError) {
    const status = error.code === "identity_conflict" || error.code === "version_conflict" || error.code === "storage_not_ready" || error.code === "not_extractable" || error.code === "compilation_running" || error.code === "already_processed" ? 409
      : error.code === "file_too_large" ? 413
      : error.code === "not_found" ? 404
      : error.code === "storage_error" || error.detail === "not_configured" ? 503 : 422;
    return reply.code(status).send({
      error: error.code,
      reason: error.detail ?? null,
      validationHistory: error.validationHistory,
      ...(error.providerMetadata ? { providerMetadata: error.providerMetadata } : {}),
    });
  }
  if (error instanceof RealCurriculumDocumentWorkflowError) {
    const status = error.code === "not_found" ? 404 : error.code === "storage_not_ready" ? 409 : error.code === "unsupported_media_type" ? 415 : error.code === "storage_error" || error.code === "storage_integrity_error" ? 503 : 422;
    return reply.code(status).send({ error: error.code, reason: error.detail ?? null });
  }
  if (error instanceof CurriculumUnitReviewServiceError) {
    return reply.code(error.code === "already_reviewed" ? 409 : error.code === "candidate_not_found" ? 404 : 422).send({ error: error.code, detail: error.detail ?? null });
  }
  throw error;
}

export function registerCurriculumMaterialAdminRoutes(server: FastifyInstance, dependencies: {
  authStore: AuthStore;
  documents: CurriculumDocumentService;
  workflow: RealCurriculumDocumentWorkflow;
  reviews: CurriculumUnitReviewService;
}) {
  const { authStore, documents, workflow, reviews } = dependencies;
  const guard = requireSuperadmin(authStore);

  async function materialForLevel(levelId: typeof CURRICULUM_LEVELS[number]) {
    const material = (await documents.listMaterial()).filter(({ document }) => document.levelId === levelId);
    const units = material.map(({ document, version, compilation }) => ({
      unitId: document.unitId,
      unitOrder: document.unitOrder,
      documentId: document.documentId,
      sourceTitle: version?.sourceTitle ?? null,
      originalFilename: version?.originalFilename ?? null,
      storageStatus: version?.storageStatus ?? "pending",
      extractionStatus: version?.extractionStatus ?? "pending",
      processingStatus: compilation?.status ?? "pending",
      processingError: compilation?.errorCode ?? null,
    }));
    const nextUnitOrder = (units.at(-1)?.unitOrder ?? 0) + 1;
    return { levelId, units, nextUnitOrder, nextUnitId: curriculumUnitId(levelId, nextUnitOrder) };
  }

  server.get("/admin/curriculum-material", { preHandler: guard }, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { levels: await Promise.all(CURRICULUM_LEVELS.map(materialForLevel)) };
  });

  server.get("/admin/curriculum-material/:levelId", { preHandler: guard }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const path = levelPath.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ error: "INVALID_LEVEL" });
    return materialForLevel(path.data.levelId);
  });

  server.post("/admin/curriculum-material/:levelId/units/:unitOrder", {
    preHandler: guard,
    bodyLimit: CURRICULUM_DOCUMENT_ROUTE_BODY_LIMIT,
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const path = unitPath.safeParse(request.params);
    const body = uploadBody.safeParse(request.body);
    if (!path.success || !body.success) return reply.code(400).send({ error: "INVALID_MATERIAL_UPLOAD" });
    if (!body.data.originalFilename.toLowerCase().endsWith(".pdf") ||
        Buffer.from(body.data.fileBase64, "base64").subarray(0, 5).toString("ascii") !== "%PDF-") {
      return reply.code(415).send({ error: "PDF_REQUIRED" });
    }
    const actor = await readAuthenticatedUser(request, authStore);
    if (!actor) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const { levelId, unitOrder } = path.data;
    const unitId = curriculumUnitId(levelId, unitOrder);
    try {
      const result = await documents.ingest(actor.id, {
        curriculumId: CURRICULUM_ID,
        levelId,
        unitId,
        unitOrder,
        documentId: `${CURRICULUM_ID}-${unitId}`,
        documentVersion: "1.0.0",
        sourceTitle: body.data.sourceTitle,
        sourceFormat: "pdf_extracted_text",
        originalFilename: body.data.originalFilename,
        mediaType: "application/pdf",
        fileBase64: body.data.fileBase64,
      });
      return reply.code(201).send({ documentId: result.document.documentId, unitId, unitOrder, storageStatus: result.version.storageStatus });
    } catch (error) {
      return materialError(error, reply);
    }
  });

  server.post("/admin/curriculum-material/:levelId/units/:unitOrder/process", { preHandler: guard }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const path = unitPath.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ error: "INVALID_UNIT" });
    const { levelId, unitOrder } = path.data;
    const documentId = `${CURRICULUM_ID}-${curriculumUnitId(levelId, unitOrder)}`;
    const existing = await documents.getVersion(documentId, "1.0.0");
    if (!existing || existing.document.levelId !== levelId || existing.document.unitOrder !== unitOrder) return reply.code(404).send({ error: "not_found" });
    try {
      const result = await workflow.process(documentId, "1.0.0");
      return reply.code(201).send({ storageStatus: result.version.storageStatus, extractionStatus: result.version.extractionStatus, processingStatus: result.compilation.run.status, units: result.compilation.units.map((unit) => ({ id: unit.id, unitId: unit.unitId, unitOrder: unit.unitOrder })) });
    } catch (error) {
      return materialError(error, reply);
    }
  });

  server.post("/admin/curriculum-material/units/:unitRecordId/review", { preHandler: guard }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const path = reviewPath.safeParse(request.params);
    const body = curriculumUnitReviewInputSchema.safeParse(request.body);
    if (!path.success || !body.success) return reply.code(400).send({ error: "INVALID_REVIEW" });
    const actor = await readAuthenticatedUser(request, authStore);
    if (!actor) return reply.code(401).send({ error: "UNAUTHORIZED" });
    try {
      const review = await reviews.review(actor.id, path.data.unitRecordId, body.data);
      return reply.code(201).send({ review: { id: review.id, action: review.action, sourceUnitRecordId: review.sourceUnitRecordId } });
    } catch (error) {
      return materialError(error, reply);
    }
  });
}
