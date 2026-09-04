import { randomUUID } from "node:crypto";
import type {
  AttachExtractedTextResult,
  BeginCompilationResult,
  CurriculumCompilationRunRecord,
  CurriculumDocumentRecord,
  CurriculumDocumentStore,
  CurriculumDocumentVersionRecord,
  CurriculumDocumentWithVersion,
  CurriculumUnitRecord,
  ReserveCurriculumDocumentVersionInput,
  ReserveCurriculumDocumentVersionResult,
} from "../../src/languages/documents/repository.js";
import type { CandidateValidationAttempt } from "../../src/languages/ai/structured-candidate-boundary.js";
import type { CurriculumDocumentCandidate } from "../../src/languages/ai/document-curriculum-extractor.js";
import type { ValidatedCandidate } from "../../src/languages/ai/structured-candidate-boundary.js";

function now() { return new Date("2026-09-03T05:00:00.000Z"); }

export class InMemoryCurriculumDocumentStore implements CurriculumDocumentStore {
  documents: CurriculumDocumentRecord[] = [];
  versions: CurriculumDocumentVersionRecord[] = [];
  runs: CurriculumCompilationRunRecord[] = [];
  units: CurriculumUnitRecord[] = [];

  async listDocuments(userId: string) {
    return this.documents.filter((document) => document.userId === userId);
  }

  async listVersions(userId: string, documentId: string) {
    const document = this.documents.find((item) => item.userId === userId && item.documentId === documentId);
    if (!document) return null;
    return this.versions.filter((version) => version.documentRecordId === document.id);
  }

  async findVersionForUser(userId: string, documentId: string, documentVersion: string): Promise<CurriculumDocumentWithVersion | null> {
    const document = this.documents.find((item) => item.userId === userId && item.documentId === documentId);
    if (!document) return null;
    const version = this.versions.find((item) => item.documentRecordId === document.id && item.documentVersion === documentVersion);
    return version ? { document, version } : null;
  }

  async reserveVersion(input: ReserveCurriculumDocumentVersionInput): Promise<ReserveCurriculumDocumentVersionResult> {
    let document = this.documents.find((item) => item.userId === input.userId && item.documentId === input.documentId);
    if (document && (document.curriculumId !== input.curriculumId || document.levelId !== input.levelId)) return { kind: "identity_conflict" };
    if (!document) {
      document = { id: randomUUID(), userId: input.userId, documentId: input.documentId, curriculumId: input.curriculumId, levelId: input.levelId, createdAt: now(), updatedAt: now() };
      this.documents.push(document);
    }
    const existing = this.versions.find((item) => item.documentRecordId === document.id && item.documentVersion === input.documentVersion);
    if (existing) {
      const same = existing.contentSha256 === input.contentSha256 && existing.sourceTitle === input.sourceTitle && existing.sourceLanguageHint === input.sourceLanguageHint && existing.sourceFormat === input.sourceFormat && existing.originalFilename === input.originalFilename && existing.mediaType === input.mediaType && existing.storageKey === input.storageKey && existing.byteSize === input.byteSize;
      return same ? { kind: "existing", document, version: existing } : { kind: "version_conflict" };
    }
    const version: CurriculumDocumentVersionRecord = {
      id: randomUUID(), documentRecordId: document.id, documentVersion: input.documentVersion,
      sourceTitle: input.sourceTitle, sourceLanguageHint: input.sourceLanguageHint, sourceFormat: input.sourceFormat,
      originalFilename: input.originalFilename, mediaType: input.mediaType, storageKey: input.storageKey,
      contentSha256: input.contentSha256, byteSize: input.byteSize, storageStatus: "pending",
      extractedText: null, extractedTextSha256: null, extractionStatus: "pending", extractionMethod: null,
      createdAt: now(), updatedAt: now(),
    };
    this.versions.push(version);
    return { kind: "reserved", document, version };
  }

  async markStorageReady(versionId: string) {
    const version = this.versions.find((item) => item.id === versionId);
    if (!version) return null;
    version.storageStatus = "ready";
    return version;
  }

  async markStorageFailed(versionId: string) {
    const version = this.versions.find((item) => item.id === versionId);
    if (!version) return null;
    version.storageStatus = "failed";
    return version;
  }

  async attachExtractedText(input: { userId: string; documentId: string; documentVersion: string; extractedText: string; extractedTextSha256: string; extractionMethod: string }): Promise<AttachExtractedTextResult> {
    const owned = await this.findVersionForUser(input.userId, input.documentId, input.documentVersion);
    if (!owned) return { kind: "not_found" };
    if (owned.version.storageStatus !== "ready") return { kind: "storage_not_ready" };
    if (owned.version.extractionStatus === "ready") return owned.version.extractedTextSha256 === input.extractedTextSha256 ? { kind: "existing", version: owned.version } : { kind: "text_conflict" };
    owned.version.extractedText = input.extractedText;
    owned.version.extractedTextSha256 = input.extractedTextSha256;
    owned.version.extractionStatus = "ready";
    owned.version.extractionMethod = input.extractionMethod;
    return { kind: "updated", version: owned.version };
  }

  async beginCompilation(input: { userId: string; documentId: string; documentVersion: string; boundaryKey: string }): Promise<BeginCompilationResult> {
    const owned = await this.findVersionForUser(input.userId, input.documentId, input.documentVersion);
    if (!owned) return { kind: "not_found" };
    if (owned.version.storageStatus !== "ready" || owned.version.extractionStatus !== "ready" || !owned.version.extractedText) return { kind: "not_extractable" };
    const run: CurriculumCompilationRunRecord = { id: randomUUID(), documentVersionId: owned.version.id, boundaryKey: input.boundaryKey, status: "running", attempts: null, validationHistory: null, errorCode: null, startedAt: now(), completedAt: null };
    this.runs.push(run);
    return { kind: "started", run };
  }

  async completeCompilation(input: { userId: string; runId: string; candidate: ValidatedCandidate<CurriculumDocumentCandidate> }) {
    const run = await this.findCompilationForUser(input.userId, input.runId);
    if (!run || run.status !== "running") return null;
    for (const spec of input.candidate.value.units) {
      this.units.push({ id: randomUUID(), compilationRunId: run.id, unitId: spec.identity.unitId, specVersion: spec.specVersion, unitOrder: spec.identity.unitOrder, status: spec.status, spec, createdAt: now() });
    }
    run.status = "ready";
    run.attempts = input.candidate.attempts;
    run.validationHistory = input.candidate.validationHistory;
    run.completedAt = now();
    return run;
  }

  async failCompilation(input: { userId: string; runId: string; errorCode: string; validationHistory: CandidateValidationAttempt[] }) {
    const run = await this.findCompilationForUser(input.userId, input.runId);
    if (!run || run.status !== "running") return null;
    run.status = "failed";
    run.errorCode = input.errorCode;
    run.validationHistory = input.validationHistory;
    run.completedAt = now();
    return run;
  }

  async findCompilationForUser(userId: string, runId: string) {
    const run = this.runs.find((item) => item.id === runId);
    if (!run) return null;
    const version = this.versions.find((item) => item.id === run.documentVersionId);
    const document = version && this.documents.find((item) => item.id === version.documentRecordId);
    return document?.userId === userId ? run : null;
  }

  async listUnitsForCompilation(userId: string, runId: string) {
    if (!(await this.findCompilationForUser(userId, runId))) return null;
    return this.units.filter((unit) => unit.compilationRunId === runId).sort((a, b) => a.unitOrder - b.unitOrder);
  }
}
