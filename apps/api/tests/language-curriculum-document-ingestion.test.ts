import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import { dbTimestamp } from "../src/db/timestamps.js";
import type {
  CurriculumDocumentExtractor,
  MasterDocumentCurriculumInput,
} from "../src/languages/ai/document-curriculum-extractor.js";
import { StructuredCandidateBoundaryError } from "../src/languages/ai/structured-candidate-boundary.js";
import { CurriculumDocumentService, CurriculumDocumentServiceError } from "../src/languages/documents/service.js";
import { curriculumDocumentStorageKey, type CurriculumDocumentStorage } from "../src/languages/documents/storage.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { InMemoryCurriculumDocumentStore } from "./fixtures/curriculum-document-store.js";

class MemoryStorage implements CurriculumDocumentStorage {
  objects = new Map<string, Uint8Array>();
  puts = 0;

  async put(input: { key: string; contentType: string; body: Uint8Array }) {
    this.puts += 1;
    this.objects.set(input.key, input.body);
  }

  async get(key: string) {
    const value = this.objects.get(key);
    if (!value) throw new Error("missing object");
    return value;
  }
}

class CapturingExtractor implements CurriculumDocumentExtractor {
  inputs: MasterDocumentCurriculumInput[] = [];

  async extract(input: MasterDocumentCurriculumInput) {
    this.inputs.push(structuredClone(input));
    const unit = structuredClone(a1U01CurriculumFixture);
    unit.status = "review";
    unit.provenance.sources = [
      {
        sourceId: input.documentId,
        role: "primary",
        reference: `${input.documentId}@${input.documentVersion}`,
      },
    ];
    return {
      value: {
        documentRef: { id: input.documentId, version: input.documentVersion },
        curriculumId: input.curriculumId,
        levelId: input.levelId,
        units: [unit],
      },
      attempts: 1,
      validationHistory: [{ attempt: 1, outcome: "accepted" as const, issues: [] }],
    };
  }
}

function uploadInput(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "A1-MASTER-P01",
    documentVersion: "1.0.0",
    curriculumId: "memoos-core-language",
    levelId: "A1",
    sourceTitle: "Marco maestro A1 parte 1",
    sourceLanguageHint: "de",
    sourceFormat: "pdf_extracted_text" as const,
    originalFilename: "A1_master_1.pdf",
    mediaType: "application/pdf",
    fileBase64: Buffer.from("%PDF-1.7 fake curriculum source", "utf8").toString("base64"),
    extractedText: "  Encabezado original\nHallo Welt.  \n",
    extractionMethod: "fixture_extraction",
    ...overrides,
  };
}

function makeService() {
  const store = new InMemoryCurriculumDocumentStore();
  const storage = new MemoryStorage();
  const extractor = new CapturingExtractor();
  return { store, storage, extractor, service: new CurriculumDocumentService(store, storage, extractor) };
}

test("M7 ingestion stores one immutable source version and preserves exact extracted text", async () => {
  const { store, storage, service } = makeService();
  const first = await service.ingest("user-1", uploadInput());

  assert.equal(first.version.storageStatus, "ready");
  assert.equal(first.version.extractionStatus, "ready");
  assert.equal(first.version.extractedText, "  Encabezado original\nHallo Welt.  \n");
  assert.equal(first.version.contentSha256.length, 64);
  assert.equal(first.version.extractedTextSha256?.length, 64);
  assert.equal(storage.puts, 1);
  assert.equal(store.documents.length, 1);
  assert.equal(store.versions.length, 1);

  const second = await service.ingest("user-1", uploadInput());
  assert.equal(second.version.id, first.version.id);
  assert.equal(storage.puts, 1, "ready immutable versions must not be uploaded twice");
});

test("M7 rejects different bytes under the same semantic document version", async () => {
  const { storage, service } = makeService();
  await service.ingest("user-1", uploadInput());

  await assert.rejects(
    service.ingest(
      "user-1",
      uploadInput({ fileBase64: Buffer.from("different PDF", "utf8").toString("base64") }),
    ),
    (error: unknown) => error instanceof CurriculumDocumentServiceError && error.code === "version_conflict",
  );
  assert.equal(storage.puts, 1);
});

test("M7 compilation consumes persisted text and recompilation appends history", async () => {
  const { store, extractor, service } = makeService();
  const sourceText = "  Texto exacto para M6\nsegunda línea  \n";
  await service.ingest("user-1", uploadInput({ extractedText: sourceText }));

  const first = await service.compile("user-1", "A1-MASTER-P01", "1.0.0");
  const second = await service.compile("user-1", "A1-MASTER-P01", "1.0.0");

  assert.equal(extractor.inputs.length, 2);
  assert.equal(extractor.inputs[0]?.sourceText, sourceText);
  assert.notEqual(first.run.id, second.run.id);
  assert.equal(store.runs.length, 2);
  assert.equal(store.units.length, 2);
  assert.equal(first.units[0]?.status, "review");
  assert.equal(second.units[0]?.status, "review");
  assert.equal(first.run.status, "ready");
  assert.equal(second.run.status, "ready");
});

test("M7 records a failed compilation boundary without inventing units", async () => {
  const store = new InMemoryCurriculumDocumentStore();
  const storage = new MemoryStorage();
  const history = [{ attempt: 1, outcome: "invalid_candidate" as const, issues: [] }];
  const extractor: CurriculumDocumentExtractor = {
    async extract() {
      throw new StructuredCandidateBoundaryError("retry_exhausted", history);
    },
  };
  const service = new CurriculumDocumentService(store, storage, extractor);
  await service.ingest("user-1", uploadInput());

  await assert.rejects(
    service.compile("user-1", "A1-MASTER-P01", "1.0.0"),
    (error: unknown) =>
      error instanceof CurriculumDocumentServiceError &&
      error.code === "compiler_failed" &&
      error.detail === "retry_exhausted",
  );

  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0]?.status, "failed");
  assert.equal(store.runs[0]?.errorCode, "retry_exhausted");
  assert.deepEqual(store.runs[0]?.validationHistory, history);
  assert.equal(store.units.length, 0);
});

test("curriculum storage keys are deterministic and do not expose semantic ids", () => {
  const input = {
    userId: "secret-user-id",
    documentId: "A1-MASTER-P01",
    documentVersion: "1.0.0",
    contentSha256: "a".repeat(64),
  };
  const first = curriculumDocumentStorageKey(input);
  const second = curriculumDocumentStorageKey(input);
  assert.equal(first, second);
  assert.match(first, /^language-curriculum\/[0-9a-f]{64}\/[0-9a-f]{64}$/u);
  assert.equal(first.includes(input.userId), false);
  assert.equal(first.includes(input.documentId), false);
  assert.equal(first.includes(input.documentVersion), false);
});

test("M7 migration is additive and keeps source versions and compilation runs immutable", async () => {
  const migration = await readFile(
    new URL("../drizzle/0019_create_language_curriculum_documents.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "language_curriculum_documents",
    "language_curriculum_document_versions",
    "language_curriculum_compilation_runs",
    "language_curriculum_units",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "u"));
  }
  assert.match(migration, /content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /storage_status IN \('pending', 'ready', 'failed'\)/u);
  assert.match(migration, /status IN \('running', 'ready', 'failed'\)/u);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/iu);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/iu);
});

test("M7 routes require auth and never return storage keys or extracted source text", async () => {
  const { service } = makeService();
  const user = { id: "11111111-1111-4111-8111-111111111111", username: "memo", passwordHash: "hash", createdAt: new Date() };
  const authStore: AuthStore = {
    async findById(userId) { return userId === user.id ? user : null; },
    async findByUsername(username) { return username === user.username ? user : null; },
  };
  const server = createServer({ logger: false }, { authStore, curriculumDocumentService: service });

  const unauthorized = await server.inject({ method: "GET", url: "/languages/curriculum-documents" });
  assert.equal(unauthorized.statusCode, 401);

  const cookie = createSessionCookie(user.id).split(";", 1)[0];
  const uploaded = await server.inject({
    method: "POST",
    url: "/languages/curriculum-documents",
    headers: { cookie: cookie ?? "" },
    payload: uploadInput(),
  });
  assert.equal(uploaded.statusCode, 201);
  const body = uploaded.json();
  assert.equal(body.version.storageStatus, "ready");
  assert.equal("storageKey" in body.version, false);
  assert.equal("extractedText" in body.version, false);

  const compiled = await server.inject({
    method: "POST",
    url: "/languages/curriculum-documents/A1-MASTER-P01/versions/1.0.0/compile",
    headers: { cookie: cookie ?? "" },
  });
  assert.equal(compiled.statusCode, 201);
  assert.equal(compiled.json().units[0].status, "review");

  await server.close();
});

test("M7 routes serialize repository timestamps normalized from SQL strings", async () => {
  const { store, service } = makeService();
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "memo",
    passwordHash: "hash",
    createdAt: new Date(),
  };
  store.documents.push({
    id: "22222222-2222-4222-8222-222222222222",
    userId: user.id,
    documentId: "A1-MASTER-P01",
    curriculumId: "memoos-core-language",
    levelId: "A1",
    createdAt: dbTimestamp("2026-09-05 00:43:56.837552+00"),
    updatedAt: dbTimestamp("2026-09-05 00:44:56.837552+00"),
  });
  const authStore: AuthStore = {
    async findById(userId) {
      return userId === user.id ? user : null;
    },
    async findByUsername(username) {
      return username === user.username ? user : null;
    },
  };
  const server = createServer(
    { logger: false },
    { authStore, curriculumDocumentService: service },
  );
  const cookie = createSessionCookie(user.id).split(";", 1)[0];

  const response = await server.inject({
    method: "GET",
    url: "/languages/curriculum-documents",
    headers: { cookie: cookie ?? "" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().documents[0], {
    id: "22222222-2222-4222-8222-222222222222",
    documentId: "A1-MASTER-P01",
    curriculumId: "memoos-core-language",
    levelId: "A1",
    createdAt: "2026-09-05T00:43:56.837Z",
    updatedAt: "2026-09-05T00:44:56.837Z",
  });

  await server.close();
});
