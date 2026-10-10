import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import type { CurriculumDocumentExtractor, MasterDocumentCurriculumInput } from "../src/languages/ai/document-curriculum-extractor.js";
import { CurriculumDocumentService } from "../src/languages/documents/service.js";
import { RealCurriculumDocumentWorkflow } from "../src/languages/documents/real-document-workflow.js";
import type { CurriculumDocumentStorage } from "../src/languages/documents/storage.js";
import { CurriculumUnitReviewService, type CurriculumUnitReviewRecord, type CurriculumUnitReviewStore } from "../src/languages/documents/unit-review.js";
import { InMemoryCurriculumDocumentStore } from "./fixtures/curriculum-document-store.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET = "gui28-test-cookie-secret-with-at-least-thirty-two-characters";

class MemoryStorage implements CurriculumDocumentStorage {
  objects = new Map<string, Uint8Array>();
  puts = 0;
  gets = 0;
  failNextPut = false;
  async put(input: { key: string; body: Uint8Array }) {
    this.puts++;
    if (this.failNextPut) { this.failNextPut = false; throw new Error("injected PUT failure"); }
    this.objects.set(input.key, input.body);
  }
  async get(key: string) { this.gets++; const bytes = this.objects.get(key); if (!bytes) throw new Error("not found"); return bytes; }
}

test("GUI-28 admin boundary, sequential global upload, retry and exact unit compilation", async () => {
  const admin: AuthUser = { id: randomUUID(), username: "admin", passwordHash: "private", role: "superadmin", sessionVersion: 1, createdAt: new Date() };
  const normal: AuthUser = { id: randomUUID(), username: "normal", passwordHash: "private", role: "user", sessionVersion: 1, createdAt: new Date() };
  const admin2: AuthUser = { ...admin, id: randomUUID(), username: "admin2" };
  const users = [admin, normal, admin2];
  const authStore: AuthStore = { async findById(id) { return users.find((user) => user.id === id) ?? null; }, async findByUsername(name) { return users.find((user) => user.username === name) ?? null; } };
  const store = new InMemoryCurriculumDocumentStore();
  const storage = new MemoryStorage();
  let wrongIdentity = false;
  let compilerCalls = 0;
  const compilerInputs: MasterDocumentCurriculumInput[] = [];
  const extractor: CurriculumDocumentExtractor = { async extract(input: MasterDocumentCurriculumInput) {
    compilerCalls++;
    compilerInputs.push(structuredClone(input));
    const unit = structuredClone(a1U01CurriculumFixture);
    unit.status = "review";
    unit.identity.unitOrder = wrongIdentity ? 2 : 1;
    const primary = unit.provenance.sources.find((source) => source.role === "primary");
    if (primary) primary.role = "supporting";
    unit.provenance.sources.unshift({ sourceId: input.documentId, role: "primary", reference: `${input.documentId}@${input.documentVersion}` });
    return { value: { documentRef: { id: input.documentId, version: input.documentVersion }, curriculumId: input.curriculumId, levelId: input.levelId, units: [unit] }, attempts: 1, validationHistory: [{ attempt: 1, outcome: "accepted" as const, issues: [] }] };
  } };
  const documents = new CurriculumDocumentService(store, storage, extractor);
  let extractionFails = false;
  const workflow = new RealCurriculumDocumentWorkflow(documents, storage, { async extract() {
    if (extractionFails) throw new Error("injected extraction failure");
    return { text: "Currículo neutro A1 Unidad 1", method: "openai_pdf_input" as const };
  } });
  let review: CurriculumUnitReviewRecord | null = null;
  const reviews = new CurriculumUnitReviewService({
    async findCandidate(unitId) { const unit = store.units.find((value) => value.id === unitId); return unit ? { sourceUnitRecordId: unit.id, spec: unit.spec } : null; },
    async createReview(input) { if (review) return null; review = { id: randomUUID(), reviewedByUserId: input.reviewedByUserId, sourceUnitRecordId: input.sourceUnitRecordId, action: input.action, reviewNote: input.reviewNote, promotedSpec: input.promotedSpec, promotedSpecSha256: input.promotedSpecSha256, reviewedAt: new Date() }; return review; },
    async findReview() { return review; },
  } satisfies CurriculumUnitReviewStore);
  const server = createServer({ logger: false }, { authStore, curriculumDocumentService: documents, realCurriculumDocumentWorkflow: workflow, curriculumUnitReviewService: reviews });
  const cookie = (user: AuthUser) => createSessionCookie(user.id, user.sessionVersion).split(";", 1)[0]!;
  const payload = { sourceTitle: "Marco maestro neutro A1 — Unidad 1", originalFilename: "a1-u01.pdf", fileBase64: Buffer.from("%PDF-1.7\nGUI28 fixture").toString("base64") };
  const url = "/admin/curriculum-material/A1/units/1";
  try {
    for (const [method, path, body] of [
      ["GET", "/admin/curriculum-material", undefined],
      ["POST", url, payload],
      ["POST", `${url}/process`, undefined],
      ["POST", `/admin/curriculum-material/units/${randomUUID()}/review`, { action: "accept", note: "test" }],
      ["POST", "/languages/curriculum-documents", payload],
      ["POST", "/languages/curriculum-documents/doc/versions/1.0.0/process", undefined],
      ["POST", `/languages/curriculum-units/${randomUUID()}/review`, { action: "accept", note: "test" }],
    ] as const) {
      const denied = await server.inject({ method, url: path, payload: body, headers: { cookie: cookie(normal) } });
      assert.equal(denied.statusCode, 403, `${method} ${path}`);
    }
    assert.equal((await server.inject({ method: "GET", url: "/admin/curriculum-material" })).statusCode, 401);
    const initial = await server.inject({ method: "GET", url: "/admin/curriculum-material", headers: { cookie: cookie(admin) } });
    assert.deepEqual(initial.json().levels.map((level: { levelId: string }) => level.levelId), ["A1", "A2", "B1", "B2", "C1"]);
    assert.equal(initial.json().levels[0].nextUnitId, "A1-U01");
    for (const body of [
      { ...payload, documentId: "invented" },
      { ...payload, unitId: "A1-U99" },
      { ...payload, curriculumId: "invented" },
      { ...payload, storageKey: "invented" },
      { ...payload, documentVersion: "9.9.9" },
      { ...payload, mediaType: "text/plain" },
      { ...payload, extractedText: "bypass" },
      { ...payload, sourceFormat: "docx_extracted_text" },
    ]) {
      const retired = await server.inject({ method: "POST", url: "/languages/curriculum-documents", payload: body, headers: { cookie: cookie(admin) } });
      assert.equal(retired.statusCode, 410);
      assert.equal(retired.json().error, "LEGACY_CURRICULUM_MUTATION_RETIRED");
    }
    for (const [method, path, body] of [
      ["PUT", "/languages/curriculum-documents/invented/versions/9.9.9/extracted-text", { extractedText: "bypass", extractionMethod: "provided" }],
      ["POST", "/languages/curriculum-documents/invented/versions/9.9.9/compile", undefined],
      ["POST", "/languages/curriculum-documents/invented/versions/9.9.9/process", undefined],
      ["POST", `/languages/curriculum-units/${randomUUID()}/review`, { action: "accept", note: "bypass" }],
    ] as const) {
      assert.equal((await server.inject({ method, url: path, payload: body, headers: { cookie: cookie(admin) } })).statusCode, 410);
    }
    assert.equal(store.documents.length, 0);
    assert.equal((await server.inject({ method: "POST", url, payload: { ...payload, curriculumId: "other", unitId: "A1-U99", storageKey: "chosen" }, headers: { cookie: cookie(admin) } })).statusCode, 400);
    assert.equal((await server.inject({ method: "POST", url, payload: { ...payload, fileBase64: Buffer.from("not a PDF").toString("base64") }, headers: { cookie: cookie(admin) } })).statusCode, 415);
    assert.equal((await server.inject({ method: "POST", url: "/admin/curriculum-material/C2/units/1", payload, headers: { cookie: cookie(admin) } })).statusCode, 400);
    assert.equal((await server.inject({ method: "POST", url: "/admin/curriculum-material/A1/units/0", payload, headers: { cookie: cookie(admin) } })).statusCode, 400);
    assert.equal(store.documents.length, 0);
    assert.equal((await server.inject({ method: "POST", url: "/admin/curriculum-material/A1/units/3", payload, headers: { cookie: cookie(admin) } })).statusCode, 409);
    storage.failNextPut = true;
    assert.equal((await server.inject({ method: "POST", url, payload, headers: { cookie: cookie(admin) } })).statusCode, 503);
    assert.equal(store.versions[0]?.storageStatus, "failed");
    const successfulUpload = await server.inject({ method: "POST", url, payload, headers: { cookie: cookie(admin2) } });
    assert.equal(successfulUpload.statusCode, 201);
    assert.deepEqual({ documentId: successfulUpload.json().documentId, unitId: successfulUpload.json().unitId },
      { documentId: "memoos-core-language-A1-U01", unitId: "A1-U01" });
    assert.equal(store.versions[0]?.documentVersion, "1.0.0");
    assert.equal(storage.puts, 2);
    assert.equal(store.documents[0]?.uploadedByUserId, admin.id);
    assert.equal(storage.objects.size, 1);
    assert.match([...storage.objects.keys()][0]!, /^language-curriculum\/[0-9a-f]{64}\/[0-9a-f]{64}$/u);
    assert.equal((await server.inject({ method: "POST", url, payload, headers: { cookie: cookie(admin) } })).statusCode, 409);
    assert.equal((await server.inject({ method: "POST", url: "/admin/curriculum-material/A1/units/3", payload, headers: { cookie: cookie(admin) } })).statusCode, 409);
    const listed = await server.inject({ method: "GET", url: "/admin/curriculum-material/A1", headers: { cookie: cookie(admin) } });
    assert.equal(listed.json().units.length, 1);
    assert.equal(listed.json().nextUnitId, "A1-U02");
    extractionFails = true;
    const extractionFailure = await server.inject({ method: "POST", url: `${url}/process`, headers: { cookie: cookie(admin) } });
    assert.equal(extractionFailure.statusCode, 422);
    assert.equal(store.versions[0]?.extractionStatus, "failed");
    assert.equal(storage.puts, 2);
    extractionFails = false;
    wrongIdentity = true;
    const mismatch = await server.inject({ method: "POST", url: `${url}/process`, headers: { cookie: cookie(admin) } });
    assert.equal(mismatch.statusCode, 422);
    assert.equal(mismatch.json().error, "unit_identity_mismatch");
    assert.deepEqual(compilerInputs.at(-1)?.expectedUnitIdentity, { unitId: "A1-U01", unitOrder: 1 });
    assert.equal(store.runs.at(-1)?.status, "failed");
    assert.equal(storage.puts, 2);
    wrongIdentity = false;
    const processed = await server.inject({ method: "POST", url: `${url}/process`, headers: { cookie: cookie(admin2) } });
    assert.equal(processed.statusCode, 201);
    assert.equal(processed.json().units[0].unitId, "A1-U01");
    assert.deepEqual(compilerInputs.at(-1)?.expectedUnitIdentity, { unitId: "A1-U01", unitOrder: 1 });
    assert.equal(store.runs.at(-1)?.status, "ready");
    assert.equal(storage.puts, 2);
    assert.equal(storage.gets, 2);
    const callsAfterReady = compilerCalls;
    const repeated = await server.inject({ method: "POST", url: `${url}/process`, headers: { cookie: cookie(admin) } });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.json().error, "already_processed");
    assert.equal(compilerCalls, callsAfterReady);
    assert.equal(store.runs.length, 2);
    assert.equal(store.units.length, 1);
    const unitId = processed.json().units[0].id as string;
    const approved = await server.inject({ method: "POST", url: `/admin/curriculum-material/units/${unitId}/review`, payload: { action: "accept", note: "Aprobado" }, headers: { cookie: cookie(admin) } });
    assert.equal(approved.statusCode, 201, approved.body);
    assert.equal(review?.action, "accepted");
    assert.equal(review?.reviewedByUserId, admin.id);
  } finally { await server.close(); }
});
