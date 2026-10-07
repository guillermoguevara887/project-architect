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
  | "compilation_running"
  | "already_processed"
  | "unit_identity_mismatch"
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
      curriculumId: input.curriculumId,
      levelId: input.levelId,
      unitId: input.unitId,
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      contentSha256,
    });

    const reservation = await this.store.reserveVersion({
      uploadedByUserId: userId,
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      curriculumId: input.curriculumId,
      levelId: input.levelId,
      unitId: input.unitId,
      unitOrder: input.unitOrder,
      sourceTitle: input.sourceTitle,
      sourceLanguageHint: null,
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
        const ready = await this.store.markStorageReadyUnderVersionBarrier({
          versionId: version.id,
          put: () => this.storage.put({
            key: storageKey,
            contentType: input.mediaType,
            body: bytes,
          }),
        });
        if (!ready) throw new CurriculumDocumentServiceError("not_found");
        version = ready;
      } catch {
        await this.store.markStorageFailed(version.id);
        throw new CurriculumDocumentServiceError("storage_error");
      }
    }

    if (input.extractedText !== undefined) {
      const extraction = await this.store.attachExtractedText({
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
    documentId: string,
    documentVersion: string,
    rawInput: AttachCurriculumExtractedTextInput,
  ) {
    const input = attachCurriculumExtractedTextSchema.parse(rawInput);
    const result = await this.store.attachExtractedText({
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

  listDocuments() {
    return this.store.listDocuments();
  }

  async listMaterial() {
    const documents = await this.store.listDocuments();
    return Promise.all(documents.map(async (document) => {
      const [version] = await this.store.listVersions(document.documentId) ?? [];
      const compilation = version ? await this.store.latestCompilation(version.id) : null;
      return { document, version: version ?? null, compilation };
    }));
  }

  listVersions(documentId: string) {
    return this.store.listVersions(documentId);
  }

  async getVersion(
    documentId: string,
    documentVersion: string,
  ) {
    return this.store.findVersion(documentId, documentVersion);
  }

  async markExtractionFailed(versionId: string) {
    return this.store.markExtractionFailed(versionId);
  }

  async compile(
    documentId: string,
    documentVersion: string,
  ): Promise<CurriculumCompilationResult> {
    const owned = await this.store.findVersion(
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
    if (started.kind === "already_running") {
      throw new CurriculumDocumentServiceError("compilation_running");
    }
    if (started.kind === "already_ready") {
      throw new CurriculumDocumentServiceError("already_processed");
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
        unitCountHint: { min: 1, max: 1 },
      });

      const expected = owned.document;
      const units = candidate.value.units;
      if (candidate.value.curriculumId !== expected.curriculumId || candidate.value.levelId !== expected.levelId ||
          candidate.value.documentRef.id !== documentId || candidate.value.documentRef.version !== documentVersion ||
          units.length !== 1 || units[0]?.identity.curriculumId !== expected.curriculumId ||
          units[0]?.identity.levelId !== expected.levelId ||
          units[0]?.identity.unitId !== expected.unitId ||
          units[0]?.identity.unitOrder !== expected.unitOrder) {
        throw new CurriculumDocumentServiceError("unit_identity_mismatch");
      }

      const run = await this.store.completeCompilation({
        runId: started.run.id,
        candidate,
      });
      if (!run) throw new CurriculumDocumentServiceError("compiler_failed");
      const compiledUnits = await this.store.listUnitsForCompilation(run.id);
      if (!compiledUnits) throw new CurriculumDocumentServiceError("compiler_failed");
      return { run, units: compiledUnits };
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

  async getCompilation(runId: string) {
    const run = await this.store.findCompilation(runId);
    if (!run) return null;
    const units = await this.store.listUnitsForCompilation(runId);
    return { run, units: units ?? [] };
  }
}

export const curriculumDocumentService = new CurriculumDocumentService(
  curriculumDocumentStore,
  curriculumDocumentStorage,
  new OpenAICurriculumDocumentExtractor(),
);
