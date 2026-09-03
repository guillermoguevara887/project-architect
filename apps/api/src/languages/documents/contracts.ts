import { z } from "zod";
import {
  domainIdSchema,
  requiredTextSchema,
  semanticVersionSchema,
} from "../curriculum/primitives.js";

export const curriculumDocumentSourceFormatSchema = z.enum([
  "pdf_extracted_text",
  "docx_extracted_text",
  "plain_text",
  "other_extracted_text",
]);

export type CurriculumDocumentSourceFormat = z.infer<
  typeof curriculumDocumentSourceFormatSchema
>;

export const curriculumDocumentStorageStatusSchema = z.enum([
  "pending",
  "ready",
  "failed",
]);

export type CurriculumDocumentStorageStatus = z.infer<
  typeof curriculumDocumentStorageStatusSchema
>;

export const curriculumDocumentExtractionStatusSchema = z.enum([
  "pending",
  "ready",
  "failed",
]);

export type CurriculumDocumentExtractionStatus = z.infer<
  typeof curriculumDocumentExtractionStatusSchema
>;

export const curriculumCompilationStatusSchema = z.enum([
  "running",
  "ready",
  "failed",
]);

export type CurriculumCompilationStatus = z.infer<
  typeof curriculumCompilationStatusSchema
>;

const base64Schema = z
  .string()
  .trim()
  .min(1)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u, {
    message: "Invalid base64 payload",
  });

export const ingestCurriculumDocumentSchema = z
  .object({
    documentId: domainIdSchema,
    documentVersion: semanticVersionSchema,
    curriculumId: domainIdSchema,
    levelId: domainIdSchema,
    sourceTitle: requiredTextSchema.max(240),
    sourceLanguageHint: requiredTextSchema.max(100).optional(),
    sourceFormat: curriculumDocumentSourceFormatSchema,
    originalFilename: requiredTextSchema.max(255),
    mediaType: requiredTextSchema.max(160),
    fileBase64: base64Schema,
    extractedText: requiredTextSchema.optional(),
    extractionMethod: requiredTextSchema.max(120).optional(),
  })
  .strict();

export type IngestCurriculumDocumentInput = z.infer<
  typeof ingestCurriculumDocumentSchema
>;

export const attachCurriculumExtractedTextSchema = z
  .object({
    extractedText: requiredTextSchema,
    extractionMethod: requiredTextSchema.max(120),
  })
  .strict();

export type AttachCurriculumExtractedTextInput = z.infer<
  typeof attachCurriculumExtractedTextSchema
>;

export const curriculumDocumentPathSchema = z
  .object({
    documentId: domainIdSchema,
  })
  .strict();

export const curriculumDocumentVersionPathSchema = z
  .object({
    documentId: domainIdSchema,
    documentVersion: semanticVersionSchema,
  })
  .strict();

export const curriculumCompilationPathSchema = z
  .object({
    documentId: domainIdSchema,
    documentVersion: semanticVersionSchema,
    compilationRunId: z.string().uuid(),
  })
  .strict();

export const CURRICULUM_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
export const CURRICULUM_DOCUMENT_ROUTE_BODY_LIMIT = 24 * 1024 * 1024;
export const CURRICULUM_COMPILER_BOUNDARY_KEY = "curriculum-document-m6";
