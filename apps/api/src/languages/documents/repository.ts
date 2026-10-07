import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { dbTimestamp, type DbTimestamp } from "../../db/timestamps.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import type {
  CandidateValidationAttempt,
  ValidatedCandidate,
} from "../ai/structured-candidate-boundary.js";
import type { CurriculumDocumentCandidate } from "../ai/document-curriculum-extractor.js";
import { LANGUAGE_LESSON_PROCESSING_TIMEOUT_MS } from "../repository.js";
import type {
  CurriculumCompilationStatus,
  CurriculumDocumentExtractionStatus,
  CurriculumDocumentSourceFormat,
  CurriculumDocumentStorageStatus,
} from "./contracts.js";

// Compilation can make several structured-provider attempts, like lesson processing.
// Reuse its 15-minute lease rather than the shorter audio-generation window.
export const CURRICULUM_COMPILATION_STALE_TIMEOUT_MS = LANGUAGE_LESSON_PROCESSING_TIMEOUT_MS;
export const STALE_CURRICULUM_COMPILATION_ERROR_CODE = "stale_compilation_timeout";

export type CurriculumDocumentRecord = {
  id: string;
  uploadedByUserId: string | null;
  documentId: string;
  curriculumId: string;
  levelId: string;
  unitId: string;
  unitOrder: number;
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
  uploadedByUserId: string;
  documentId: string;
  documentVersion: string;
  curriculumId: string;
  levelId: string;
  unitId: string;
  unitOrder: number;
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
  | { kind: "not_extractable" }
  | { kind: "already_running" }
  | { kind: "already_ready" };

export interface CurriculumDocumentStore {
  listDocuments(): Promise<CurriculumDocumentRecord[]>;
  listVersions(documentId: string): Promise<CurriculumDocumentVersionRecord[] | null>;
  findVersion(documentId: string, documentVersion: string): Promise<CurriculumDocumentWithVersion | null>;
  reserveVersion(input: ReserveCurriculumDocumentVersionInput): Promise<ReserveCurriculumDocumentVersionResult>;
  markStorageReadyUnderVersionBarrier(input: { versionId: string; put: () => Promise<void> }): Promise<CurriculumDocumentVersionRecord | null>;
  markStorageFailed(versionId: string): Promise<CurriculumDocumentVersionRecord | null>;
  markExtractionFailed(versionId: string): Promise<CurriculumDocumentVersionRecord | null>;
  attachExtractedText(input: { documentId: string; documentVersion: string; extractedText: string; extractedTextSha256: string; extractionMethod: string }): Promise<AttachExtractedTextResult>;
  beginCompilation(input: { documentId: string; documentVersion: string; boundaryKey: string }): Promise<BeginCompilationResult>;
  completeCompilation(input: { runId: string; candidate: ValidatedCandidate<CurriculumDocumentCandidate> }): Promise<CurriculumCompilationRunRecord | null>;
  failCompilation(input: { runId: string; errorCode: string; validationHistory: CandidateValidationAttempt[] }): Promise<CurriculumCompilationRunRecord | null>;
  findCompilation(runId: string): Promise<CurriculumCompilationRunRecord | null>;
  latestCompilation(documentVersionId: string): Promise<CurriculumCompilationRunRecord | null>;
  listUnitsForCompilation(runId: string): Promise<CurriculumUnitRecord[] | null>;
}

type DbDocument = {
  id: string; uploaded_by_user_id: string | null; document_id: string; curriculum_id: string;
  level_id: string; unit_id: string; unit_order: number; created_at: DbTimestamp; updated_at: DbTimestamp;
};
type DbVersion = {
  id: string; document_record_id: string; document_version: string;
  source_title: string; source_language_hint: string | null;
  source_format: CurriculumDocumentSourceFormat; original_filename: string;
  media_type: string; storage_key: string; content_sha256: string; byte_size: number;
  storage_status: CurriculumDocumentStorageStatus; extracted_text: string | null;
  extracted_text_sha256: string | null; extraction_status: CurriculumDocumentExtractionStatus;
  extraction_method: string | null; created_at: DbTimestamp; updated_at: DbTimestamp;
};
type DbRun = {
  id: string; document_version_id: string; boundary_key: string;
  status: CurriculumCompilationStatus; attempts: number | null;
  validation_history: CandidateValidationAttempt[] | null; error_code: string | null;
  started_at: DbTimestamp; completed_at: DbTimestamp | null;
};
type DbUnit = {
  id: string; compilation_run_id: string; unit_id: string; spec_version: string;
  unit_order: number; status: CurriculumUnitSpec["status"]; spec: CurriculumUnitSpec;
  created_at: DbTimestamp;
};

function rows<T>(value: unknown) { return value as T[]; }
function curriculumConstraint(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if ((candidate.code === "23505" || candidate.code === "23514") && typeof candidate.constraint_name === "string") {
      return candidate.constraint_name;
    }
    current = candidate.cause;
  }
  return null;
}
function mapDocument(row: DbDocument): CurriculumDocumentRecord {
  return { id: row.id, uploadedByUserId: row.uploaded_by_user_id, documentId: row.document_id, curriculumId: row.curriculum_id, levelId: row.level_id, unitId: row.unit_id, unitOrder: row.unit_order, createdAt: dbTimestamp(row.created_at), updatedAt: dbTimestamp(row.updated_at) };
}
function mapVersion(row: DbVersion): CurriculumDocumentVersionRecord {
  return { id: row.id, documentRecordId: row.document_record_id, documentVersion: row.document_version, sourceTitle: row.source_title, sourceLanguageHint: row.source_language_hint, sourceFormat: row.source_format, originalFilename: row.original_filename, mediaType: row.media_type, storageKey: row.storage_key, contentSha256: row.content_sha256, byteSize: row.byte_size, storageStatus: row.storage_status, extractedText: row.extracted_text, extractedTextSha256: row.extracted_text_sha256, extractionStatus: row.extraction_status, extractionMethod: row.extraction_method, createdAt: dbTimestamp(row.created_at), updatedAt: dbTimestamp(row.updated_at) };
}
function mapRun(row: DbRun): CurriculumCompilationRunRecord {
  return { id: row.id, documentVersionId: row.document_version_id, boundaryKey: row.boundary_key, status: row.status, attempts: row.attempts, validationHistory: row.validation_history, errorCode: row.error_code, startedAt: dbTimestamp(row.started_at), completedAt: row.completed_at === null ? null : dbTimestamp(row.completed_at) };
}
function mapUnit(row: DbUnit): CurriculumUnitRecord {
  return { id: row.id, compilationRunId: row.compilation_run_id, unitId: row.unit_id, specVersion: row.spec_version, unitOrder: row.unit_order, status: row.status, spec: row.spec, createdAt: dbTimestamp(row.created_at) };
}

async function findDocument(documentId: string, executor = getDb()) {
  const result = rows<DbDocument>(await executor.execute(sql`SELECT * FROM language_curriculum_documents WHERE document_id=${documentId} LIMIT 1`));
  return result[0] ? mapDocument(result[0]) : null;
}
async function findVersion(documentRecordId: string, documentVersion: string, executor = getDb()) {
  const result = rows<DbVersion>(await executor.execute(sql`SELECT * FROM language_curriculum_document_versions WHERE document_record_id=${documentRecordId} AND document_version=${documentVersion} LIMIT 1`));
  return result[0] ? mapVersion(result[0]) : null;
}

export const curriculumDocumentStore: CurriculumDocumentStore = {
  async listDocuments() {
    return rows<DbDocument>(await getDb().execute(sql`SELECT * FROM language_curriculum_documents ORDER BY level_id, unit_order`)).map(mapDocument);
  },

  async listVersions(documentId) {
    const document = await findDocument(documentId);
    if (!document) return null;
    return rows<DbVersion>(await getDb().execute(sql`SELECT * FROM language_curriculum_document_versions WHERE document_record_id=${document.id} ORDER BY created_at DESC`)).map(mapVersion);
  },

  async findVersion(documentId, documentVersion) {
    const document = await findDocument(documentId);
    if (!document) return null;
    const version = await findVersion(document.id, documentVersion);
    return version ? { document, version } : null;
  },

  async reserveVersion(input) {
    try {
      return await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.curriculumId}), hashtext(${input.levelId}))`);
      const [occupied] = rows<DbDocument>(await tx.execute(sql`SELECT * FROM language_curriculum_documents WHERE curriculum_id=${input.curriculumId} AND level_id=${input.levelId} AND unit_order=${input.unitOrder} LIMIT 1`));
      if (occupied) {
        if (occupied.document_id !== input.documentId || occupied.unit_id !== input.unitId) return { kind: "identity_conflict" };
        const version = await findVersion(occupied.id, input.documentVersion, tx);
        if (!version || version.storageStatus === "ready") return { kind: "identity_conflict" };
        const same = version.contentSha256 === input.contentSha256 && version.sourceTitle === input.sourceTitle && version.sourceLanguageHint === input.sourceLanguageHint && version.sourceFormat === input.sourceFormat && version.originalFilename === input.originalFilename && version.mediaType === input.mediaType && version.byteSize === input.byteSize && version.storageKey === input.storageKey;
        return same ? { kind: "existing", document: mapDocument(occupied), version } : { kind: "version_conflict" };
      }
      const [next] = rows<{ unit_order: number }>(await tx.execute(sql`SELECT COALESCE(MAX(unit_order), 0) + 1 AS unit_order FROM language_curriculum_documents WHERE curriculum_id=${input.curriculumId} AND level_id=${input.levelId}`));
      if (input.unitOrder !== next?.unit_order) return { kind: "identity_conflict" };
      if (await findDocument(input.documentId, tx)) return { kind: "identity_conflict" };
      const inserted = rows<DbDocument>(await tx.execute(sql`INSERT INTO language_curriculum_documents (uploaded_by_user_id, document_id, curriculum_id, level_id, unit_id, unit_order) VALUES (${input.uploadedByUserId}, ${input.documentId}, ${input.curriculumId}, ${input.levelId}, ${input.unitId}, ${input.unitOrder}) RETURNING *`));
      if (!inserted[0]) throw new Error("Curriculum document insert returned no row.");
      const document = mapDocument(inserted[0]);

      const versionRows = rows<DbVersion>(await tx.execute(sql`INSERT INTO language_curriculum_document_versions (document_record_id, document_version, source_title, source_language_hint, source_format, original_filename, media_type, storage_key, content_sha256, byte_size) VALUES (${document.id}, ${input.documentVersion}, ${input.sourceTitle}, ${input.sourceLanguageHint}, ${input.sourceFormat}, ${input.originalFilename}, ${input.mediaType}, ${input.storageKey}, ${input.contentSha256}, ${input.byteSize}) RETURNING *`));
      if (!versionRows[0]) throw new Error("Curriculum document version insert returned no row.");
      return { kind: "reserved", document, version: mapVersion(versionRows[0]) };
      });
    } catch (error) {
      const constraint = curriculumConstraint(error);
      if (constraint?.startsWith("language_curriculum_documents_")) return { kind: "identity_conflict" };
      if (constraint?.startsWith("language_curriculum_document_versions_")) return { kind: "version_conflict" };
      throw error;
    }
  },

  async markStorageReadyUnderVersionBarrier(input) {
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const [version] = rows<DbVersion>(await tx.execute(sql`SELECT * FROM language_curriculum_document_versions WHERE id=${input.versionId} FOR UPDATE`));
      if (!version) return null;
      if (version.storage_status === "ready") return mapVersion(version);

      await input.put();
      const updated = rows<DbVersion>(await tx.execute(sql`
        UPDATE language_curriculum_document_versions
        SET storage_status='ready', updated_at=now()
        WHERE id=${input.versionId}
        RETURNING *
      `));
      return updated[0] ? mapVersion(updated[0]) : null;
    });
  },

  async markStorageFailed(versionId) {
    const updated = rows<DbVersion>(await getDb().execute(sql`UPDATE language_curriculum_document_versions SET storage_status='failed', updated_at=now() WHERE id=${versionId} AND storage_status<>'ready' RETURNING *`));
    return updated[0] ? mapVersion(updated[0]) : null;
  },

  async attachExtractedText(input) {
    const owned = await this.findVersion(input.documentId, input.documentVersion);
    if (!owned) return { kind: "not_found" };
    if (owned.version.storageStatus !== "ready") return { kind: "storage_not_ready" };
    if (owned.version.extractionStatus === "ready") return owned.version.extractedTextSha256 === input.extractedTextSha256 ? { kind: "existing", version: owned.version } : { kind: "text_conflict" };

    const updated = rows<DbVersion>(await getDb().execute(sql`UPDATE language_curriculum_document_versions SET extracted_text=${input.extractedText}, extracted_text_sha256=${input.extractedTextSha256}, extraction_status='ready', extraction_method=${input.extractionMethod}, updated_at=now() WHERE id=${owned.version.id} AND extraction_status<>'ready' RETURNING *`));
    if (updated[0]) return { kind: "updated", version: mapVersion(updated[0]) };

    const current = await this.findVersion(input.documentId, input.documentVersion);
    return current?.version.extractedTextSha256 === input.extractedTextSha256 ? { kind: "existing", version: current.version } : { kind: "text_conflict" };
  },

  async beginCompilation(input) {
    const owned = await this.findVersion(input.documentId, input.documentVersion);
    if (!owned) return { kind: "not_found" };
    return getDb().transaction(async (tx) => {
      // Every claimant locks the same version before inspecting or replacing an active run.
      const [version] = rows<DbVersion>(await tx.execute(sql`
        SELECT * FROM language_curriculum_document_versions
        WHERE id=${owned.version.id} FOR UPDATE
      `));
      if (!version) return { kind: "not_found" } as const;
      if (version.storage_status !== "ready" || version.extraction_status !== "ready" || !version.extracted_text) {
        return { kind: "not_extractable" } as const;
      }

      const [active] = rows<DbRun & { is_stale: boolean }>(await tx.execute(sql`
        SELECT run.*,
          run.started_at <= now() - (${CURRICULUM_COMPILATION_STALE_TIMEOUT_MS}::bigint * interval '1 millisecond') AS is_stale
        FROM language_curriculum_compilation_runs AS run
        WHERE run.document_version_id=${version.id} AND run.status IN ('running', 'ready')
        FOR UPDATE OF run
      `));
      if (active?.status === "ready") return { kind: "already_ready" } as const;
      if (active?.status === "running" && !active.is_stale) return { kind: "already_running" } as const;
      if (active?.status === "running") {
        const [expired] = rows<DbRun>(await tx.execute(sql`
          UPDATE language_curriculum_compilation_runs
          SET status='failed', completed_at=now(), error_code=${STALE_CURRICULUM_COMPILATION_ERROR_CODE}
          WHERE id=${active.id} AND status='running' RETURNING *
        `));
        if (!expired) throw new Error("Stale curriculum compilation could not be expired.");
      }

      const [inserted] = rows<DbRun>(await tx.execute(sql`
        INSERT INTO language_curriculum_compilation_runs (document_version_id, boundary_key)
        VALUES (${version.id}, ${input.boundaryKey})
        ON CONFLICT (document_version_id) WHERE status IN ('running', 'ready') DO NOTHING
        RETURNING *
      `));
      if (inserted) return { kind: "started", run: mapRun(inserted) } as const;
      const [winner] = rows<DbRun>(await tx.execute(sql`
        SELECT * FROM language_curriculum_compilation_runs
        WHERE document_version_id=${version.id} AND status IN ('running', 'ready')
        FOR UPDATE
      `));
      if (winner) return { kind: winner.status === "ready" ? "already_ready" : "already_running" } as const;
      throw new Error("Curriculum compilation conflict could not be resolved.");
    });
  },

  async completeCompilation(input) {
    return getDb().transaction(async (tx) => {
      // Fence a worker that finishes after its stale run was reclaimed.
      const [run] = rows<DbRun>(await tx.execute(sql`
        SELECT * FROM language_curriculum_compilation_runs WHERE id=${input.runId} FOR UPDATE
      `));
      if (!run || run.status !== "running") return null;
      for (const unit of input.candidate.value.units) {
        await tx.execute(sql`INSERT INTO language_curriculum_units (compilation_run_id, unit_id, spec_version, unit_order, status, spec) VALUES (${input.runId}, ${unit.identity.unitId}, ${unit.specVersion}, ${unit.identity.unitOrder}, ${unit.status}, ${JSON.stringify(unit)}::jsonb)`);
      }
      const updated = rows<DbRun>(await tx.execute(sql`UPDATE language_curriculum_compilation_runs SET status='ready', attempts=${input.candidate.attempts}, validation_history=${JSON.stringify(input.candidate.validationHistory)}::jsonb, completed_at=now() WHERE id=${input.runId} AND status='running' RETURNING *`));
      if (!updated[0]) throw new Error("Curriculum compilation could not be completed.");
      return mapRun(updated[0]);
    });
  },

  async failCompilation(input) {
    const owned = await this.findCompilation(input.runId);
    if (!owned || owned.status !== "running") return null;
    const updated = rows<DbRun>(await getDb().execute(sql`UPDATE language_curriculum_compilation_runs SET status='failed', validation_history=${JSON.stringify(input.validationHistory)}::jsonb, error_code=${input.errorCode}, completed_at=now() WHERE id=${input.runId} AND status='running' RETURNING *`));
    return updated[0] ? mapRun(updated[0]) : null;
  },

  async findCompilation(runId) {
    const result = rows<DbRun>(await getDb().execute(sql`SELECT * FROM language_curriculum_compilation_runs WHERE id=${runId} LIMIT 1`));
    return result[0] ? mapRun(result[0]) : null;
  },

  async markExtractionFailed(versionId) {
    const [updated] = rows<DbVersion>(await getDb().execute(sql`UPDATE language_curriculum_document_versions SET extraction_status='failed', updated_at=now() WHERE id=${versionId} AND extraction_status<>'ready' RETURNING *`));
    return updated ? mapVersion(updated) : null;
  },

  async latestCompilation(documentVersionId) {
    const [run] = rows<DbRun>(await getDb().execute(sql`SELECT * FROM language_curriculum_compilation_runs WHERE document_version_id=${documentVersionId} ORDER BY started_at DESC, id DESC LIMIT 1`));
    return run ? mapRun(run) : null;
  },

  async listUnitsForCompilation(runId) {
    if (!(await this.findCompilation(runId))) return null;
    return rows<DbUnit>(await getDb().execute(sql`SELECT * FROM language_curriculum_units WHERE compilation_run_id=${runId} ORDER BY unit_order ASC`)).map(mapUnit);
  },
};
