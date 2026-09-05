import { createHash } from "node:crypto";
import {
  OpenAICurriculumDocumentExtractor,
  type CurriculumDocumentExtractor,
} from "../ai/document-curriculum-extractor.js";
import {
  StructuredCandidateBoundaryError,
  type CandidateValidationAttempt,
  type SafeProviderErrorMetadata,
} from "../ai/structured-candidate-boundary.js";
import {
  CURRICULUM_COMPILER_BOUNDARY_KEY,
  CURRICULUM_DOCUMENT_MAX_BYTES,
  attachCurriculumExtractedTextSchema,
  ingestCurriculumDocumentSchema,
  type AttachCurriculumExtractedTextInput,
  type IngestCurriculumDocumentInput,
} from "./contracts.js";
import {
  curriculumDocumentStore,
  type CurriculumCompilationRunRecord,
  type CurriculumDocumentRecord,
  type CurriculumDocumentStore,
  type CurriculumDocumentVersionRecord,
  type CurriculumUnitRecord,
} from "./repository.js";
import {
  curriculumDocumentStorage,
  curriculumDocumentStorageKey,
  type CurriculumDocumentStorage,
} from "./storage.js";

export type CurriculumDocumentServiceErrorCode =
  | "file_too_large"
  | "identity_conflict"
  | "version_conflict"
  | "storage_error"
  | "not_found"
  | "storage_not_ready"
  | "text_conflict"
  | "not_extractable"
  | "compiler_failed";

export class CurriculumDocumentServiceError extends Error {
  constructor(
    readonly code: CurriculumDocumentServiceErrorCode,
    readonly detail?: string,
    readonly validationHistory: CandidateValidationAttempt[] = [],
    readonly providerMetadata?: SafeProviderErrorMetadata,
  ) {
    super(`Curriculum document service failed: ${code}`);
    this.name = "CurriculumDocumentServiceError";
  }
}

export type IngestedCurriculumDocument = {
  document: CurriculumDocumentRecord;
  version: CurriculumDocumentVersionRecord;
};

export type CurriculumCompilationResult = {
  run: CurriculumCompilationRunRecord;
  units: CurriculumUnitRecord[];
};

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function decodeBase64(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0) {
    throw new CurriculumDocumentServiceError("storage_error", "empty_file");
  }
  return bytes;
}

export class CurriculumDocumentService {
  constructor(
    private readonly store: CurriculumDocumentStore,
    private readonly storage: CurriculumDocumentStorage,
    private readonly extractor: CurriculumDocumentExtractor,
  ) {}

  async ingest(
    userId: string,
    rawInput: IngestCurriculumDocumentInput,
  ): Promise<IngestedCurriculumDocument> {
    const input = ingestCurriculumDocumentSchema.parse(rawInput);
    const bytes = decodeBase64(input.fileBase64);
    if (bytes.byteLength > CURRICULUM_DOCUMENT_MAX_BYTES) {
      throw new CurriculumDocumentServiceError("file_too_large");
    }

    const contentSha256 = sha256Bytes(bytes);
    const storageKey = curriculumDocumentStorageKey({
      userId,
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      contentSha256,
    });

    const reservation = await this.store.reserveVersion({
      userId,
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      curriculumId: input.curriculumId,
      levelId: input.levelId,
      sourceTitle: input.sourceTitle,
      sourceLanguageHint: input.sourceLanguageHint ?? null,
      sourceFormat: input.sourceFormat,
      originalFilename: input.originalFilename,
      mediaType: input.mediaType,
      storageKey,
      contentSha256,
      byteSize: bytes.byteLength,
    });

    if (reservation.kind === "identity_conflict") {
      throw new CurriculumDocumentServiceError("identity_conflict");
    }
    if (reservation.kind === "version_conflict") {
      throw new CurriculumDocumentServiceError("version_conflict");
    }
    if (!("version" in reservation)) {
      throw new CurriculumDocumentServiceError("version_conflict");
    }

    let version = reservation.version;
    if (version.storageStatus !== "ready") {
      try {
        await this.storage.put({
          key: storageKey,
          contentType: input.mediaType,
          body: bytes,
        });
        version = (await this.store.markStorageReady(version.id)) ?? version;
      } catch {
        await this.store.markStorageFailed(version.id);
        throw new CurriculumDocumentServiceError("storage_error");
      }
    }

    if (input.extractedText !== undefined) {
      const extraction = await this.store.attachExtractedText({
        userId,
        documentId: input.documentId,
        documentVersion: input.documentVersion,
        extractedText: input.extractedText,
        extractedTextSha256: sha256Text(input.extractedText),
        extractionMethod: input.extractionMethod ?? "provided_at_ingestion",
      });
      if (extraction.kind === "text_conflict") {
        throw new CurriculumDocumentServiceError("text_conflict");
      }
      if (extraction.kind === "storage_not_ready") {
        throw new CurriculumDocumentServiceError("storage_not_ready");
      }
      if (extraction.kind === "not_found") {
        throw new CurriculumDocumentServiceError("not_found");
      }
      if (!("version" in extraction)) {
        throw new CurriculumDocumentServiceError("text_conflict");
      }
      version = extraction.version;
    }

    return { document: reservation.document, version };
  }

  async attachExtractedText(
    userId: string,
    documentId: string,
    documentVersion: string,
    rawInput: AttachCurriculumExtractedTextInput,
  ) {
    const input = attachCurriculumExtractedTextSchema.parse(rawInput);
    const result = await this.store.attachExtractedText({
      userId,
      documentId,
      documentVersion,
      extractedText: input.extractedText,
      extractedTextSha256: sha256Text(input.extractedText),
      extractionMethod: input.extractionMethod,
    });

    if (result.kind === "not_found") {
      throw new CurriculumDocumentServiceError("not_found");
    }
    if (result.kind === "storage_not_ready") {
      throw new CurriculumDocumentServiceError("storage_not_ready");
    }
    if (result.kind === "text_conflict") {
      throw new CurriculumDocumentServiceError("text_conflict");
    }
    if (!("version" in result)) {
      throw new CurriculumDocumentServiceError("text_conflict");
    }
    return result.version;
  }

  listDocuments(userId: string) {
    return this.store.listDocuments(userId);
  }

  listVersions(userId: string, documentId: string) {
    return this.store.listVersions(userId, documentId);
  }

  async getVersion(
    userId: string,
    documentId: string,
    documentVersion: string,
  ) {
    return this.store.findVersionForUser(userId, documentId, documentVersion);
  }

  async compile(
    userId: string,
    documentId: string,
    documentVersion: string,
  ): Promise<CurriculumCompilationResult> {
    const owned = await this.store.findVersionForUser(
      userId,
      documentId,
      documentVersion,
    );
    if (!owned) throw new CurriculumDocumentServiceError("not_found");
    if (
      owned.version.storageStatus !== "ready" ||
      owned.version.extractionStatus !== "ready" ||
      !owned.version.extractedText
    ) {
      throw new CurriculumDocumentServiceError("not_extractable");
    }

    const started = await this.store.beginCompilation({
      userId,
      documentId,
      documentVersion,
      boundaryKey: CURRICULUM_COMPILER_BOUNDARY_KEY,
    });
    if (started.kind === "not_found") {
      throw new CurriculumDocumentServiceError("not_found");
    }
    if (started.kind === "not_extractable") {
      throw new CurriculumDocumentServiceError("not_extractable");
    }
    if (!("run" in started)) {
      throw new CurriculumDocumentServiceError("not_extractable");
    }

    try {
      const candidate = await this.extractor.extract({
        documentId: owned.document.documentId,
        documentVersion: owned.version.documentVersion,
        sourceTitle: owned.version.sourceTitle,
        sourceFormat: owned.version.sourceFormat,
        sourceLanguageHint: owned.version.sourceLanguageHint ?? undefined,
        curriculumId: owned.document.curriculumId,
        levelId: owned.document.levelId,
        sourceText: owned.version.extractedText,
      });

      const run = await this.store.completeCompilation({
        userId,
        runId: started.run.id,
        candidate,
      });
      if (!run) throw new CurriculumDocumentServiceError("compiler_failed");
      const units = await this.store.listUnitsForCompilation(userId, run.id);
      if (!units) throw new CurriculumDocumentServiceError("compiler_failed");
      return { run, units };
    } catch (error) {
      const code =
        error instanceof StructuredCandidateBoundaryError
          ? error.code
          : error instanceof CurriculumDocumentServiceError
            ? error.detail ?? error.code
            : "unexpected_compiler_error";
      const validationHistory =
        error instanceof StructuredCandidateBoundaryError ||
        error instanceof CurriculumDocumentServiceError
          ? error.validationHistory
          : [];
      const providerMetadata =
        error instanceof StructuredCandidateBoundaryError ||
        error instanceof CurriculumDocumentServiceError
          ? error.providerMetadata
          : undefined;

      await this.store.failCompilation({
        userId,
        runId: started.run.id,
        errorCode: code,
        validationHistory,
      });

      if (error instanceof CurriculumDocumentServiceError) {
        throw error;
      }
      throw new CurriculumDocumentServiceError(
        "compiler_failed",
        code,
        validationHistory,
        providerMetadata,
      );
    }
  }

  async getCompilation(userId: string, runId: string) {
    const run = await this.store.findCompilationForUser(userId, runId);
    if (!run) return null;
    const units = await this.store.listUnitsForCompilation(userId, runId);
    return { run, units: units ?? [] };
  }
}

export const curriculumDocumentService = new CurriculumDocumentService(
  curriculumDocumentStore,
  curriculumDocumentStorage,
  new OpenAICurriculumDocumentExtractor(),
);
