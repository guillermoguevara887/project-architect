import { createHash } from "node:crypto";
import {
  CurriculumSourceTextExtractionError,
  OpenAICurriculumSourceTextExtractor,
  type CurriculumSourceTextExtractor,
} from "../ai/document-source-text-extractor.js";
import {
  curriculumDocumentService,
  type CurriculumCompilationResult,
  type CurriculumDocumentService,
} from "./service.js";
import {
  curriculumDocumentStorage,
  type CurriculumDocumentStorage,
} from "./storage.js";
import type { CurriculumDocumentVersionRecord } from "./repository.js";

export type RealCurriculumDocumentWorkflowErrorCode =
  | "not_found"
  | "storage_not_ready"
  | "storage_error"
  | "storage_integrity_error"
  | "unsupported_media_type"
  | "extraction_failed";

export class RealCurriculumDocumentWorkflowError extends Error {
  constructor(
    readonly code: RealCurriculumDocumentWorkflowErrorCode,
    readonly detail?: string,
  ) {
    super(`Real curriculum document workflow failed: ${code}`);
    this.name = "RealCurriculumDocumentWorkflowError";
  }
}

export type RealCurriculumDocumentProcessingResult = {
  version: CurriculumDocumentVersionRecord;
  extractionPerformed: boolean;
  compilation: CurriculumCompilationResult;
};

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function extractionWorkflowError(error: CurriculumSourceTextExtractionError) {
  if (error.code === "unsupported_media_type") {
    return new RealCurriculumDocumentWorkflowError(
      "unsupported_media_type",
      error.code,
    );
  }
  return new RealCurriculumDocumentWorkflowError("extraction_failed", error.code);
}

export class RealCurriculumDocumentWorkflow {
  constructor(
    private readonly documents: CurriculumDocumentService,
    private readonly storage: CurriculumDocumentStorage,
    private readonly sourceTextExtractor: CurriculumSourceTextExtractor,
  ) {}

  async process(
    userId: string,
    documentId: string,
    documentVersion: string,
  ): Promise<RealCurriculumDocumentProcessingResult> {
    const owned = await this.documents.getVersion(
      userId,
      documentId,
      documentVersion,
    );
    if (!owned) {
      throw new RealCurriculumDocumentWorkflowError("not_found");
    }

    let version = owned.version;
    let extractionPerformed = false;

    if (version.extractionStatus !== "ready" || !version.extractedText) {
      if (version.storageStatus !== "ready") {
        throw new RealCurriculumDocumentWorkflowError("storage_not_ready");
      }

      let bytes: Uint8Array;
      try {
        bytes = await this.storage.get(version.storageKey);
      } catch {
        throw new RealCurriculumDocumentWorkflowError("storage_error");
      }

      if (sha256Bytes(bytes) !== version.contentSha256) {
        throw new RealCurriculumDocumentWorkflowError(
          "storage_integrity_error",
        );
      }

      let extracted;
      try {
        extracted = await this.sourceTextExtractor.extract({
          bytes,
          mediaType: version.mediaType,
          filename: version.originalFilename,
        });
      } catch (error) {
        if (error instanceof CurriculumSourceTextExtractionError) {
          throw extractionWorkflowError(error);
        }
        throw new RealCurriculumDocumentWorkflowError(
          "extraction_failed",
          "unexpected_extractor_error",
        );
      }

      version = await this.documents.attachExtractedText(
        userId,
        documentId,
        documentVersion,
        {
          extractedText: extracted.text,
          extractionMethod: extracted.method,
        },
      );
      extractionPerformed = true;
    }

    const compilation = await this.documents.compile(
      userId,
      documentId,
      documentVersion,
    );

    return { version, extractionPerformed, compilation };
  }
}

export const realCurriculumDocumentWorkflow =
  new RealCurriculumDocumentWorkflow(
    curriculumDocumentService,
    curriculumDocumentStorage,
    new OpenAICurriculumSourceTextExtractor(),
  );
