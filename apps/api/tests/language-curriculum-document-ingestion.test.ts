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
import { CURRICULUM_COMPILATION_STALE_TIMEOUT_MS, STALE_CURRICULUM_COMPILATION_ERROR_CODE } from "../src/languages/documents/repository.js";
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
    unitId: "A1-U01",
    unitOrder: 1,
    sourceTitle: "Marco maestro A1 parte 1",
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

test("M7 ingestion stores one immutable global source and rejects duplicate normal upload", async () => {
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

  await assert.rejects(service.ingest("user-1", uploadInput()),
    (error: unknown) => error instanceof CurriculumDocumentServiceError && error.code === "identity_conflict");
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
    (error: unknown) => error instanceof CurriculumDocumentServiceError && error.code === "identity_conflict",
  );
  assert.equal(storage.puts, 1);
});

test("M7 compilation consumes persisted text and a ready version cannot compile twice", async () => {
  const { store, extractor, service } = makeService();
  const sourceText = "  Texto exacto para M6\nsegunda línea  \n";
  await service.ingest("user-1", uploadInput({ extractedText: sourceText }));

  const first = await service.compile("A1-MASTER-P01", "1.0.0");
  first.run.startedAt = new Date(first.run.startedAt.getTime() - CURRICULUM_COMPILATION_STALE_TIMEOUT_MS - 1);
  await assert.rejects(service.compile("A1-MASTER-P01", "1.0.0"),
    (error: unknown) => error instanceof CurriculumDocumentServiceError && error.code === "already_processed");

  assert.equal(extractor.inputs.length, 1);
  assert.equal(extractor.inputs[0]?.sourceText, sourceText);
  assert.equal(store.runs.length, 1);
  assert.equal(store.units.length, 1);
  assert.equal(first.units[0]?.status, "review");
  assert.equal(first.run.status, "ready");
});

test("M7 running compilation conflicts and a failed attempt permits retry", async () => {
  const { store, extractor, service } = makeService();
  await service.ingest("user-1", uploadInput());
  const running = await store.beginCompilation({ documentId: "A1-MASTER-P01", documentVersion: "1.0.0", boundaryKey: "test" });
  assert.equal(running.kind, "started");
  await assert.rejects(service.compile("A1-MASTER-P01", "1.0.0"),
    (error: unknown) => error instanceof CurriculumDocumentServiceError && error.code === "compilation_running");
  assert.equal(extractor.inputs.length, 0);
  assert.equal(store.units.length, 0);
  if (running.kind !== "started") throw new Error("Expected a running attempt.");
  await store.failCompilation({ runId: running.run.id, errorCode: "retryable_test_failure", validationHistory: [] });
  const retried = await service.compile("A1-MASTER-P01", "1.0.0");
  assert.equal(retried.run.status, "ready");
  assert.equal(store.runs.length, 2);
  assert.equal(store.runs[0]?.status, "failed");
  assert.equal(store.units.length, 1);
  assert.equal(extractor.inputs.length, 1);
});

test("M7 stale running compilation is recorded as failed and retries without another upload", async () => {
  const { store, storage, extractor, service } = makeService();
  assert.equal(CURRICULUM_COMPILATION_STALE_TIMEOUT_MS, 15 * 60 * 1_000);
  await service.ingest("user-1", uploadInput());
  const abandoned = await store.beginCompilation({ documentId: "A1-MASTER-P01", documentVersion: "1.0.0", boundaryKey: "test" });
  if (abandoned.kind !== "started") throw new Error("Expected a running attempt.");
  abandoned.run.startedAt = new Date(abandoned.run.startedAt.getTime() - CURRICULUM_COMPILATION_STALE_TIMEOUT_MS - 1);

  const retried = await service.compile("A1-MASTER-P01", "1.0.0");
  assert.equal(abandoned.run.status, "failed");
  assert.equal(abandoned.run.errorCode, STALE_CURRICULUM_COMPILATION_ERROR_CODE);
  assert.ok(abandoned.run.completedAt);
  assert.equal(retried.run.status, "ready");
  assert.notEqual(retried.run.id, abandoned.run.id);
  assert.equal(store.runs.length, 2);
  assert.equal(store.units.length, 1);
  assert.equal(storage.puts, 1);
  assert.equal(extractor.inputs.length, 1);
});

test("M7 concurrent stale retries let only one request reach the compiler", async () => {
  const store = new InMemoryCurriculumDocumentStore();
  const storage = new MemoryStorage();
  const delegate = new CapturingExtractor();
  let entered!: () => void;
  let release!: () => void;
  const compilerEntered = new Promise<void>((resolve) => { entered = resolve; });
  const compilerRelease = new Promise<void>((resolve) => { release = resolve; });
  const extractor: CurriculumDocumentExtractor = {
    async extract(input) {
      entered();
      await compilerRelease;
      return delegate.extract(input);
    },
  };
  const service = new CurriculumDocumentService(store, storage, extractor);
  await service.ingest("user-1", uploadInput());
  const abandoned = await store.beginCompilation({ documentId: "A1-MASTER-P01", documentVersion: "1.0.0", boundaryKey: "test" });
  if (abandoned.kind !== "started") throw new Error("Expected a running attempt.");
  abandoned.run.startedAt = new Date(abandoned.run.startedAt.getTime() - CURRICULUM_COMPILATION_STALE_TIMEOUT_MS - 1);

  const first = service.compile("A1-MASTER-P01", "1.0.0");
  await compilerEntered;
  try {
    await assert.rejects(service.compile("A1-MASTER-P01", "1.0.0"),
      (error: unknown) => error instanceof CurriculumDocumentServiceError && error.code === "compilation_running");
  } finally {
    release();
  }
  assert.equal((await first).run.status, "ready");
  assert.equal(delegate.inputs.length, 1);
  assert.equal(store.runs.length, 2);
  assert.equal(store.units.length, 1);
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
    service.compile("A1-MASTER-P01", "1.0.0"),
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
    curriculumId: "memoos-core-language",
    levelId: "A1",
    unitId: "A1-U01",
    documentId: "A1-MASTER-P01",
    documentVersion: "1.0.0",
    contentSha256: "a".repeat(64),
  };
  const first = curriculumDocumentStorageKey(input);
  const second = curriculumDocumentStorageKey(input);
  assert.equal(first, second);
  assert.match(first, /^language-curriculum\/[0-9a-f]{64}\/[0-9a-f]{64}$/u);
  assert.equal(first.includes(input.unitId), false);
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
  const user = { id: "11111111-1111-4111-8111-111111111111", username: "memo", passwordHash: "hash", role: "superadmin" as const, sessionVersion: 1, createdAt: new Date() };
  const authStore: AuthStore = {
    async findById(userId) { return userId === user.id ? user : null; },
    async findByUsername(username) { return username === user.username ? user : null; },
  };
  const server = createServer({ logger: false }, { authStore, curriculumDocumentService: service });

  const unauthorized = await server.inject({ method: "GET", url: "/languages/curriculum-documents" });
  assert.equal(unauthorized.statusCode, 401);

  const cookie = createSessionCookie(user.id, user.sessionVersion).split(";", 1)[0];
  await service.ingest(user.id, uploadInput());
  const version = await server.inject({ method: "GET", url: "/languages/curriculum-documents/A1-MASTER-P01/versions/1.0.0", headers: { cookie: cookie ?? "" } });
  assert.equal(version.statusCode, 200);
  assert.equal(version.json().version.storageStatus, "ready");
  assert.equal("storageKey" in version.json().version, false);
  assert.equal("extractedText" in version.json().version, false);

  const compiled = await service.compile("A1-MASTER-P01", "1.0.0");
  const compilation = await server.inject({ method: "GET", url: `/languages/curriculum-documents/A1-MASTER-P01/versions/1.0.0/compilations/${compiled.run.id}`, headers: { cookie: cookie ?? "" } });
  assert.equal(compilation.statusCode, 200);
  assert.equal(compilation.json().units[0].status, "review");

  user.sessionVersion += 1;
  const stale = await server.inject({
    method: "GET",
    url: "/languages/curriculum-documents/A1-MASTER-P01/versions/1.0.0",
    headers: { cookie: cookie ?? "" },
  });
  assert.equal(stale.statusCode, 401);
  const refreshed = await server.inject({
    method: "GET", url: "/languages/curriculum-documents",
    headers: { cookie: createSessionCookie(user.id, user.sessionVersion).split(";", 1)[0] ?? "" },
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.json().documents.length, 1);

  await server.close();
});

test("M7 routes serialize repository timestamps normalized from SQL strings", async () => {
  const { store, service } = makeService();
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "memo",
    passwordHash: "hash",
    role: "superadmin" as const,
    sessionVersion: 1,
    createdAt: new Date(),
  };
  store.documents.push({
    id: "22222222-2222-4222-8222-222222222222",
    uploadedByUserId: user.id,
    documentId: "A1-MASTER-P01",
    curriculumId: "memoos-core-language",
    levelId: "A1",
    unitId: "A1-U01",
    unitOrder: 1,
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
  const cookie = createSessionCookie(user.id, user.sessionVersion).split(";", 1)[0];

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
    unitId: "A1-U01",
    unitOrder: 1,
    createdAt: "2026-09-05T00:43:56.837Z",
    updatedAt: "2026-09-05T00:44:56.837Z",
  });

  await server.close();
});
