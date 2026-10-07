import { randomUUID } from "node:crypto";
import { CURRICULUM_COMPILATION_STALE_TIMEOUT_MS, STALE_CURRICULUM_COMPILATION_ERROR_CODE, type CurriculumCompilationRunRecord, type CurriculumDocumentRecord, type CurriculumDocumentStore, type CurriculumDocumentVersionRecord, type CurriculumDocumentWithVersion, type CurriculumUnitRecord, type ReserveCurriculumDocumentVersionInput, type ReserveCurriculumDocumentVersionResult } from "../../src/languages/documents/repository.js";

const now = () => new Date("2026-09-03T05:00:00.000Z");
export class InMemoryCurriculumDocumentStore implements CurriculumDocumentStore {
  documents: CurriculumDocumentRecord[] = [];
  versions: CurriculumDocumentVersionRecord[] = [];
  runs: CurriculumCompilationRunRecord[] = [];
  units: CurriculumUnitRecord[] = [];

  async listDocuments() { return [...this.documents].sort((a, b) => a.levelId.localeCompare(b.levelId) || a.unitOrder - b.unitOrder); }
  async listVersions(documentId: string) {
    const doc = this.documents.find((d) => d.documentId === documentId);
    return doc ? this.versions.filter((v) => v.documentRecordId === doc.id) : null;
  }
  async findVersion(documentId: string, documentVersion: string): Promise<CurriculumDocumentWithVersion | null> {
    const document = this.documents.find((d) => d.documentId === documentId);
    const version = document && this.versions.find((v) => v.documentRecordId === document.id && v.documentVersion === documentVersion);
    return document && version ? { document, version } : null;
  }
  async reserveVersion(input: ReserveCurriculumDocumentVersionInput): Promise<ReserveCurriculumDocumentVersionResult> {
    const occupied = this.documents.find((d) => d.curriculumId === input.curriculumId && d.levelId === input.levelId && d.unitOrder === input.unitOrder);
    if (occupied) {
      const version = this.versions.find((v) => v.documentRecordId === occupied.id && v.documentVersion === input.documentVersion);
      if (occupied.documentId !== input.documentId || occupied.unitId !== input.unitId || !version || version.storageStatus === "ready") return { kind: "identity_conflict" };
      const same = version.contentSha256 === input.contentSha256 && version.sourceTitle === input.sourceTitle && version.sourceLanguageHint === input.sourceLanguageHint && version.sourceFormat === input.sourceFormat && version.originalFilename === input.originalFilename && version.mediaType === input.mediaType && version.storageKey === input.storageKey && version.byteSize === input.byteSize;
      return same ? { kind: "existing", document: occupied, version } : { kind: "version_conflict" };
    }
    const next = Math.max(0, ...this.documents.filter((d) => d.curriculumId === input.curriculumId && d.levelId === input.levelId).map((d) => d.unitOrder)) + 1;
    if (input.unitOrder !== next || this.documents.some((d) => d.documentId === input.documentId)) return { kind: "identity_conflict" };
    const document: CurriculumDocumentRecord = { id: randomUUID(), uploadedByUserId: input.uploadedByUserId, documentId: input.documentId, curriculumId: input.curriculumId, levelId: input.levelId, unitId: input.unitId, unitOrder: input.unitOrder, createdAt: now(), updatedAt: now() };
    this.documents.push(document);
    const version: CurriculumDocumentVersionRecord = { id: randomUUID(), documentRecordId: document.id, documentVersion: input.documentVersion, sourceTitle: input.sourceTitle, sourceLanguageHint: input.sourceLanguageHint, sourceFormat: input.sourceFormat, originalFilename: input.originalFilename, mediaType: input.mediaType, storageKey: input.storageKey, contentSha256: input.contentSha256, byteSize: input.byteSize, storageStatus: "pending", extractedText: null, extractedTextSha256: null, extractionStatus: "pending", extractionMethod: null, createdAt: now(), updatedAt: now() };
    this.versions.push(version);
    return { kind: "reserved", document, version };
  }
  async markStorageReadyUnderVersionBarrier(input: { versionId: string; put: () => Promise<void> }) {
    const version = this.versions.find((v) => v.id === input.versionId);
    if (!version) return null;
    if (version.storageStatus !== "ready") { await input.put(); version.storageStatus = "ready"; }
    return version;
  }
  async markStorageFailed(versionId: string) {
    const version = this.versions.find((v) => v.id === versionId);
    if (!version || version.storageStatus === "ready") return null;
    version.storageStatus = "failed"; return version;
  }
  async markExtractionFailed(versionId: string) {
    const version = this.versions.find((v) => v.id === versionId);
    if (!version || version.extractionStatus === "ready") return null;
    version.extractionStatus = "failed"; return version;
  }
  async attachExtractedText(input: { documentId: string; documentVersion: string; extractedText: string; extractedTextSha256: string; extractionMethod: string }) {
    const found = await this.findVersion(input.documentId, input.documentVersion);
    if (!found) return { kind: "not_found" } as const;
    const version = found.version;
    if (version.storageStatus !== "ready") return { kind: "storage_not_ready" } as const;
    if (version.extractionStatus === "ready") return version.extractedTextSha256 === input.extractedTextSha256 ? { kind: "existing", version } as const : { kind: "text_conflict" } as const;
    version.extractedText = input.extractedText; version.extractedTextSha256 = input.extractedTextSha256; version.extractionStatus = "ready"; version.extractionMethod = input.extractionMethod;
    return { kind: "updated", version } as const;
  }
  async beginCompilation(input: { documentId: string; documentVersion: string; boundaryKey: string }) {
    const found = await this.findVersion(input.documentId, input.documentVersion);
    if (!found) return { kind: "not_found" } as const;
    if (found.version.storageStatus !== "ready" || found.version.extractionStatus !== "ready" || !found.version.extractedText) return { kind: "not_extractable" } as const;
    const active = this.runs.find((run) => run.documentVersionId === found.version.id && (run.status === "running" || run.status === "ready"));
    if (active?.status === "ready") return { kind: "already_ready" } as const;
    if (active?.status === "running") {
      if (now().getTime() - active.startedAt.getTime() < CURRICULUM_COMPILATION_STALE_TIMEOUT_MS) return { kind: "already_running" } as const;
      active.status = "failed";
      active.completedAt = now();
      active.errorCode = STALE_CURRICULUM_COMPILATION_ERROR_CODE;
    }
    const run: CurriculumCompilationRunRecord = { id: randomUUID(), documentVersionId: found.version.id, boundaryKey: input.boundaryKey, status: "running", attempts: null, validationHistory: null, errorCode: null, startedAt: now(), completedAt: null };
    this.runs.push(run); return { kind: "started", run } as const;
  }
  async completeCompilation(input: Parameters<CurriculumDocumentStore["completeCompilation"]>[0]) {
    const run = await this.findCompilation(input.runId);
    if (!run || run.status !== "running") return null;
    for (const spec of input.candidate.value.units) this.units.push({ id: randomUUID(), compilationRunId: run.id, unitId: spec.identity.unitId, specVersion: spec.specVersion, unitOrder: spec.identity.unitOrder, status: spec.status, spec, createdAt: now() });
    run.status = "ready"; run.attempts = input.candidate.attempts; run.validationHistory = input.candidate.validationHistory; run.completedAt = now(); return run;
  }
  async failCompilation(input: Parameters<CurriculumDocumentStore["failCompilation"]>[0]) {
    const run = await this.findCompilation(input.runId);
    if (!run || run.status !== "running") return null;
    run.status = "failed"; run.errorCode = input.errorCode; run.validationHistory = input.validationHistory; run.completedAt = now(); return run;
  }
  async findCompilation(runId: string) { return this.runs.find((r) => r.id === runId) ?? null; }
  async latestCompilation(versionId: string) { return [...this.runs].reverse().find((r) => r.documentVersionId === versionId) ?? null; }
  async listUnitsForCompilation(runId: string) { return (await this.findCompilation(runId)) ? this.units.filter((u) => u.compilationRunId === runId).sort((a, b) => a.unitOrder - b.unitOrder) : null; }
}
