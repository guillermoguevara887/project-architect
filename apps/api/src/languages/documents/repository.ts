import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import type {
  CandidateValidationAttempt,
  ValidatedCandidate,
} from "../ai/structured-candidate-boundary.js";
import type { CurriculumDocumentCandidate } from "../ai/document-curriculum-extractor.js";
import type {
  CurriculumCompilationStatus,
  CurriculumDocumentExtractionStatus,
  CurriculumDocumentSourceFormat,
  CurriculumDocumentStorageStatus,
} from "./contracts.js";

export type CurriculumDocumentRecord = {
  id: string;
  userId: string;
  documentId: string;
  curriculumId: string;
  levelId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CurriculumDocumentVersionRecord = {
  id: string;
  documentRecordId: string;
  documentVersion: string;
  sourceTitle: string;
  sourceLanguageHint: string | null;
  sourceFormat: CurriculumDocumentSourceFormat;
  originalFilename: string;
  mediaType: string;
  storageKey: string;
  contentSha256: string;
  byteSize: number;
  storageStatus: CurriculumDocumentStorageStatus;
  extractedText: string | null;
  extractedTextSha256: string | null;
  extractionStatus: CurriculumDocumentExtractionStatus;
  extractionMethod: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CurriculumCompilationRunRecord = {
  id: string;
  documentVersionId: string;
  boundaryKey: string;
  status: CurriculumCompilationStatus;
  attempts: number | null;
  validationHistory: CandidateValidationAttempt[] | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type CurriculumUnitRecord = {
  id: string;
  compilationRunId: string;
  unitId: string;
  specVersion: string;
  unitOrder: number;
  status: CurriculumUnitSpec["status"];
  spec: CurriculumUnitSpec;
  createdAt: Date;
};

export type CurriculumDocumentWithVersion = {
  document: CurriculumDocumentRecord;
  version: CurriculumDocumentVersionRecord;
};

export type ReserveCurriculumDocumentVersionInput = {
  userId: string;
  documentId: string;
  documentVersion: string;
  curriculumId: string;
  levelId: string;
  sourceTitle: string;
  sourceLanguageHint: string | null;
  sourceFormat: CurriculumDocumentSourceFormat;
  originalFilename: string;
  mediaType: string;
  storageKey: string;
  contentSha256: string;
  byteSize: number;
};

export type ReserveCurriculumDocumentVersionResult =
  | ({ kind: "reserved" } & CurriculumDocumentWithVersion)
  | ({ kind: "existing" } & CurriculumDocumentWithVersion)
  | { kind: "identity_conflict" }
  | { kind: "version_conflict" };

export type AttachExtractedTextResult =
  | { kind: "updated"; version: CurriculumDocumentVersionRecord }
  | { kind: "existing"; version: CurriculumDocumentVersionRecord }
  | { kind: "not_found" }
  | { kind: "text_conflict" }
  | { kind: "storage_not_ready" };

export type BeginCompilationResult =
  | { kind: "started"; run: CurriculumCompilationRunRecord }
  | { kind: "not_found" }
  | { kind: "not_extractable" };

export interface CurriculumDocumentStore {
  listDocuments(userId: string): Promise<CurriculumDocumentRecord[]>;
  listVersions(userId: string, documentId: string): Promise<CurriculumDocumentVersionRecord[] | null>;
  findVersionForUser(userId: string, documentId: string, documentVersion: string): Promise<CurriculumDocumentWithVersion | null>;
  reserveVersion(input: ReserveCurriculumDocumentVersionInput): Promise<ReserveCurriculumDocumentVersionResult>;
  markStorageReady(versionId: string): Promise<CurriculumDocumentVersionRecord | null>;
  markStorageFailed(versionId: string): Promise<CurriculumDocumentVersionRecord | null>;
  attachExtractedText(input: { userId: string; documentId: string; documentVersion: string; extractedText: string; extractedTextSha256: string; extractionMethod: string }): Promise<AttachExtractedTextResult>;
  beginCompilation(input: { userId: string; documentId: string; documentVersion: string; boundaryKey: string }): Promise<BeginCompilationResult>;
  completeCompilation(input: { userId: string; runId: string; candidate: ValidatedCandidate<CurriculumDocumentCandidate> }): Promise<CurriculumCompilationRunRecord | null>;
  failCompilation(input: { userId: string; runId: string; errorCode: string; validationHistory: CandidateValidationAttempt[] }): Promise<CurriculumCompilationRunRecord | null>;
  findCompilationForUser(userId: string, runId: string): Promise<CurriculumCompilationRunRecord | null>;
  listUnitsForCompilation(userId: string, runId: string): Promise<CurriculumUnitRecord[] | null>;
}

type DbDocument = {
  id: string; user_id: string; document_id: string; curriculum_id: string;
  level_id: string; created_at: Date; updated_at: Date;
};
type DbVersion = {
  id: string; document_record_id: string; document_version: string;
  source_title: string; source_language_hint: string | null;
  source_format: CurriculumDocumentSourceFormat; original_filename: string;
  media_type: string; storage_key: string; content_sha256: string; byte_size: number;
  storage_status: CurriculumDocumentStorageStatus; extracted_text: string | null;
  extracted_text_sha256: string | null; extraction_status: CurriculumDocumentExtractionStatus;
  extraction_method: string | null; created_at: Date; updated_at: Date;
};
type DbRun = {
  id: string; document_version_id: string; boundary_key: string;
  status: CurriculumCompilationStatus; attempts: number | null;
  validation_history: CandidateValidationAttempt[] | null; error_code: string | null;
  started_at: Date; completed_at: Date | null;
};
type DbUnit = {
  id: string; compilation_run_id: string; unit_id: string; spec_version: string;
  unit_order: number; status: CurriculumUnitSpec["status"]; spec: CurriculumUnitSpec;
  created_at: Date;
};

function rows<T>(value: unknown) { return value as T[]; }
function mapDocument(row: DbDocument): CurriculumDocumentRecord {
  return { id: row.id, userId: row.user_id, documentId: row.document_id, curriculumId: row.curriculum_id, levelId: row.level_id, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapVersion(row: DbVersion): CurriculumDocumentVersionRecord {
  return { id: row.id, documentRecordId: row.document_record_id, documentVersion: row.document_version, sourceTitle: row.source_title, sourceLanguageHint: row.source_language_hint, sourceFormat: row.source_format, originalFilename: row.original_filename, mediaType: row.media_type, storageKey: row.storage_key, contentSha256: row.content_sha256, byteSize: row.byte_size, storageStatus: row.storage_status, extractedText: row.extracted_text, extractedTextSha256: row.extracted_text_sha256, extractionStatus: row.extraction_status, extractionMethod: row.extraction_method, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapRun(row: DbRun): CurriculumCompilationRunRecord {
  return { id: row.id, documentVersionId: row.document_version_id, boundaryKey: row.boundary_key, status: row.status, attempts: row.attempts, validationHistory: row.validation_history, errorCode: row.error_code, startedAt: row.started_at, completedAt: row.completed_at };
}
function mapUnit(row: DbUnit): CurriculumUnitRecord {
  return { id: row.id, compilationRunId: row.compilation_run_id, unitId: row.unit_id, specVersion: row.spec_version, unitOrder: row.unit_order, status: row.status, spec: row.spec, createdAt: row.created_at };
}

async function findDocument(userId: string, documentId: string, executor = getDb()) {
  const result = rows<DbDocument>(await executor.execute(sql`SELECT * FROM language_curriculum_documents WHERE user_id=${userId} AND document_id=${documentId} LIMIT 1`));
  return result[0] ? mapDocument(result[0]) : null;
}
async function findVersion(documentRecordId: string, documentVersion: string, executor = getDb()) {
  const result = rows<DbVersion>(await executor.execute(sql`SELECT * FROM language_curriculum_document_versions WHERE document_record_id=${documentRecordId} AND document_version=${documentVersion} LIMIT 1`));
  return result[0] ? mapVersion(result[0]) : null;
}

export const curriculumDocumentStore: CurriculumDocumentStore = {
  async listDocuments(userId) {
    return rows<DbDocument>(await getDb().execute(sql`SELECT * FROM language_curriculum_documents WHERE user_id=${userId} ORDER BY created_at DESC`)).map(mapDocument);
  },

  async listVersions(userId, documentId) {
    const document = await findDocument(userId, documentId);
    if (!document) return null;
    return rows<DbVersion>(await getDb().execute(sql`SELECT * FROM language_curriculum_document_versions WHERE document_record_id=${document.id} ORDER BY created_at DESC`)).map(mapVersion);
  },

  async findVersionForUser(userId, documentId, documentVersion) {
    const document = await findDocument(userId, documentId);
    if (!document) return null;
    const version = await findVersion(document.id, documentVersion);
    return version ? { document, version } : null;
  },

  async reserveVersion(input) {
    return getDb().transaction(async (tx) => {
      let document = await findDocument(input.userId, input.documentId, tx);
      if (document && (document.curriculumId !== input.curriculumId || document.levelId !== input.levelId)) return { kind: "identity_conflict" };
      if (!document) {
        const inserted = rows<DbDocument>(await tx.execute(sql`INSERT INTO language_curriculum_documents (user_id, document_id, curriculum_id, level_id) VALUES (${input.userId}, ${input.documentId}, ${input.curriculumId}, ${input.levelId}) RETURNING *`));
        if (!inserted[0]) throw new Error("Curriculum document insert returned no row.");
        document = mapDocument(inserted[0]);
      }

      const existing = await findVersion(document.id, input.documentVersion, tx);
      if (existing) {
        const same = existing.contentSha256 === input.contentSha256 && existing.sourceTitle === input.sourceTitle && existing.sourceLanguageHint === input.sourceLanguageHint && existing.sourceFormat === input.sourceFormat && existing.originalFilename === input.originalFilename && existing.mediaType === input.mediaType && existing.byteSize === input.byteSize && existing.storageKey === input.storageKey;
        return same ? { kind: "existing", document, version: existing } : { kind: "version_conflict" };
      }

      const inserted = rows<DbVersion>(await tx.execute(sql`INSERT INTO language_curriculum_document_versions (document_record_id, document_version, source_title, source_language_hint, source_format, original_filename, media_type, storage_key, content_sha256, byte_size) VALUES (${document.id}, ${input.documentVersion}, ${input.sourceTitle}, ${input.sourceLanguageHint}, ${input.sourceFormat}, ${input.originalFilename}, ${input.mediaType}, ${input.storageKey}, ${input.contentSha256}, ${input.byteSize}) RETURNING *`));
      if (!inserted[0]) throw new Error("Curriculum document version insert returned no row.");
      return { kind: "reserved", document, version: mapVersion(inserted[0]) };
    });
  },

  async markStorageReady(versionId) {
    const updated = rows<DbVersion>(await getDb().execute(sql`UPDATE language_curriculum_document_versions SET storage_status='ready', updated_at=now() WHERE id=${versionId} RETURNING *`));
    return updated[0] ? mapVersion(updated[0]) : null;
  },

  async markStorageFailed(versionId) {
    const updated = rows<DbVersion>(await getDb().execute(sql`UPDATE language_curriculum_document_versions SET storage_status='failed', updated_at=now() WHERE id=${versionId} RETURNING *`));
    return updated[0] ? mapVersion(updated[0]) : null;
  },

  async attachExtractedText(input) {
    const owned = await this.findVersionForUser(input.userId, input.documentId, input.documentVersion);
    if (!owned) return { kind: "not_found" };
    if (owned.version.storageStatus !== "ready") return { kind: "storage_not_ready" };
    if (owned.version.extractionStatus === "ready") return owned.version.extractedTextSha256 === input.extractedTextSha256 ? { kind: "existing", version: owned.version } : { kind: "text_conflict" };

    const updated = rows<DbVersion>(await getDb().execute(sql`UPDATE language_curriculum_document_versions SET extracted_text=${input.extractedText}, extracted_text_sha256=${input.extractedTextSha256}, extraction_status='ready', extraction_method=${input.extractionMethod}, updated_at=now() WHERE id=${owned.version.id} AND extraction_status<>'ready' RETURNING *`));
    if (updated[0]) return { kind: "updated", version: mapVersion(updated[0]) };

    const current = await this.findVersionForUser(input.userId, input.documentId, input.documentVersion);
    return current?.version.extractedTextSha256 === input.extractedTextSha256 ? { kind: "existing", version: current.version } : { kind: "text_conflict" };
  },

  async beginCompilation(input) {
    const owned = await this.findVersionForUser(input.userId, input.documentId, input.documentVersion);
    if (!owned) return { kind: "not_found" };
    if (owned.version.storageStatus !== "ready" || owned.version.extractionStatus !== "ready" || !owned.version.extractedText) return { kind: "not_extractable" };
    const inserted = rows<DbRun>(await getDb().execute(sql`INSERT INTO language_curriculum_compilation_runs (document_version_id, boundary_key) VALUES (${owned.version.id}, ${input.boundaryKey}) RETURNING *`));
    if (!inserted[0]) throw new Error("Compilation run insert returned no row.");
    return { kind: "started", run: mapRun(inserted[0]) };
  },

  async completeCompilation(input) {
    const owned = await this.findCompilationForUser(input.userId, input.runId);
    if (!owned || owned.status !== "running") return null;

    return getDb().transaction(async (tx) => {
      for (const unit of input.candidate.value.units) {
        await tx.execute(sql`INSERT INTO language_curriculum_units (compilation_run_id, unit_id, spec_version, unit_order, status, spec) VALUES (${input.runId}, ${unit.identity.unitId}, ${unit.specVersion}, ${unit.identity.unitOrder}, ${unit.status}, ${JSON.stringify(unit)}::jsonb)`);
      }
      const updated = rows<DbRun>(await tx.execute(sql`UPDATE language_curriculum_compilation_runs SET status='ready', attempts=${input.candidate.attempts}, validation_history=${JSON.stringify(input.candidate.validationHistory)}::jsonb, completed_at=now() WHERE id=${input.runId} AND status='running' RETURNING *`));
      return updated[0] ? mapRun(updated[0]) : null;
    });
  },

  async failCompilation(input) {
    const owned = await this.findCompilationForUser(input.userId, input.runId);
    if (!owned || owned.status !== "running") return null;
    const updated = rows<DbRun>(await getDb().execute(sql`UPDATE language_curriculum_compilation_runs SET status='failed', validation_history=${JSON.stringify(input.validationHistory)}::jsonb, error_code=${input.errorCode}, completed_at=now() WHERE id=${input.runId} AND status='running' RETURNING *`));
    return updated[0] ? mapRun(updated[0]) : null;
  },

  async findCompilationForUser(userId, runId) {
    const result = rows<DbRun>(await getDb().execute(sql`SELECT r.* FROM language_curriculum_compilation_runs r JOIN language_curriculum_document_versions v ON v.id=r.document_version_id JOIN language_curriculum_documents d ON d.id=v.document_record_id WHERE r.id=${runId} AND d.user_id=${userId} LIMIT 1`));
    return result[0] ? mapRun(result[0]) : null;
  },

  async listUnitsForCompilation(userId, runId) {
    if (!(await this.findCompilationForUser(userId, runId))) return null;
    return rows<DbUnit>(await getDb().execute(sql`SELECT * FROM language_curriculum_units WHERE compilation_run_id=${runId} ORDER BY unit_order ASC`)).map(mapUnit);
  },
};
