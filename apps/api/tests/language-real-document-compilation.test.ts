import assert from "node:assert/strict";
import test from "node:test";
import type { AuthStore } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import {
  CurriculumSourceTextExtractionError,
  OpenAICurriculumSourceTextExtractor,
  type CurriculumSourceTextExtractor,
} from "../src/languages/ai/document-source-text-extractor.js";
import type {
  CurriculumDocumentExtractor,
  MasterDocumentCurriculumInput,
} from "../src/languages/ai/document-curriculum-extractor.js";
import { CurriculumDocumentService } from "../src/languages/documents/service.js";
import {
  RealCurriculumDocumentWorkflow,
  RealCurriculumDocumentWorkflowError,
} from "../src/languages/documents/real-document-workflow.js";
import type { CurriculumDocumentStorage } from "../src/languages/documents/storage.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { InMemoryCurriculumDocumentStore } from "./fixtures/curriculum-document-store.js";

class MemoryStorage implements CurriculumDocumentStorage {
  objects = new Map<string, Uint8Array>();

  async put(input: { key: string; contentType: string; body: Uint8Array }) {
    this.objects.set(input.key, input.body);
  }

  async get(key: string) {
    const value = this.objects.get(key);
    if (!value) throw new Error("missing object");
    return value;
  }
}

class CapturingCurriculumExtractor implements CurriculumDocumentExtractor {
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
      validationHistory: [
        { attempt: 1, outcome: "accepted" as const, issues: [] },
      ],
    };
  }
}

class CapturingSourceTextExtractor implements CurriculumSourceTextExtractor {
  calls = 0;
  readonly text =
    "  MARCO MAESTRO A1\nPrimer contacto, identidad y supervivencia comunicativa.  \n";

  async extract() {
    this.calls += 1;
    return { text: this.text, method: "openai_pdf_input" as const };
  }
}

function uploadWithoutText() {
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
    fileBase64: Buffer.from(
      "%PDF-1.7\nreal source bytes for M12 workflow fixture",
      "utf8",
    ).toString("base64"),
  };
}

function makeWorkflow() {
  const store = new InMemoryCurriculumDocumentStore();
  const storage = new MemoryStorage();
  const curriculumExtractor = new CapturingCurriculumExtractor();
  const sourceTextExtractor = new CapturingSourceTextExtractor();
  const service = new CurriculumDocumentService(
    store,
    storage,
    curriculumExtractor,
  );
  const workflow = new RealCurriculumDocumentWorkflow(
    service,
    storage,
    sourceTextExtractor,
  );
  return {
    store,
    storage,
    curriculumExtractor,
    sourceTextExtractor,
    service,
    workflow,
  };
}

test("M12 PDF boundary sends the original PDF as input_file and preserves returned text", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const expectedText =
    "  Texto del documento sin resumen.\nSegunda línea suficientemente larga para validación.  \n";
  const extractor = new OpenAICurriculumSourceTextExtractor(
    async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      return { status: "completed", output_text: expectedText };
    },
    "pdf-test-model",
  );
  const bytes = Buffer.from("%PDF-1.7\nfixture bytes", "utf8");

  const result = await extractor.extract({
    bytes,
    mediaType: "application/pdf",
    filename: "A1.pdf",
  });

  assert.equal(result.text, expectedText);
  assert.equal(result.method, "openai_pdf_input");
  assert.equal(requests.length, 1);
  const request = requests[0] as {
    store: boolean;
    input: Array<{
      content: Array<{ type: string; file_data?: string; filename?: string }>;
    }>;
  };
  assert.equal(request.store, false);
  const file = request.input[0]?.content.find((item) => item.type === "input_file");
  assert.equal(file?.filename, "A1.pdf");
  assert.equal(file?.file_data, bytes.toString("base64"));
});

test("M12 plain text extraction is deterministic and never calls a provider", async () => {
  let called = false;
  const extractor = new OpenAICurriculumSourceTextExtractor(
    async () => {
      called = true;
      throw new Error("provider must not be called");
    },
    "unused-model",
  );
  const text = "Texto plano suficientemente largo para pasar el límite mínimo de M12.";

  const result = await extractor.extract({
    bytes: Buffer.from(text, "utf8"),
    mediaType: "text/plain; charset=utf-8",
    filename: "A1.txt",
  });

  assert.equal(result.text, text);
  assert.equal(result.method, "utf8_plain_text");
  assert.equal(called, false);
});

test("M12 source extractor rejects unsupported formats instead of guessing", async () => {
  const extractor = new OpenAICurriculumSourceTextExtractor(
    undefined,
    "unused-model",
  );

  await assert.rejects(
    extractor.extract({
      bytes: Buffer.from("not a supported document", "utf8"),
      mediaType: "image/png",
      filename: "scan.png",
    }),
    (error: unknown) =>
      error instanceof CurriculumSourceTextExtractionError &&
      error.code === "unsupported_media_type",
  );
});

test("M12 process extracts once, preserves source text and appends M6 compilations", async () => {
  const {
    store,
    sourceTextExtractor,
    curriculumExtractor,
    service,
    workflow,
  } = makeWorkflow();
  await service.ingest("user-1", uploadWithoutText());

  const first = await workflow.process("user-1", "A1-MASTER-P01", "1.0.0");
  const second = await workflow.process("user-1", "A1-MASTER-P01", "1.0.0");

  assert.equal(first.extractionPerformed, true);
  assert.equal(second.extractionPerformed, false);
  assert.equal(sourceTextExtractor.calls, 1);
  assert.equal(first.version.extractedText, sourceTextExtractor.text);
  assert.equal(first.version.extractionMethod, "openai_pdf_input");
  assert.equal(curriculumExtractor.inputs.length, 2);
  assert.equal(curriculumExtractor.inputs[0]?.sourceText, sourceTextExtractor.text);
  assert.equal(curriculumExtractor.inputs[1]?.sourceText, sourceTextExtractor.text);
  assert.equal(first.compilation.units[0]?.status, "review");
  assert.equal(second.compilation.units[0]?.status, "review");
  assert.notEqual(first.compilation.run.id, second.compilation.run.id);
  assert.equal(store.runs.length, 2);
  assert.equal(store.units.length, 2);
});

test("M12 stops before extraction when stored bytes fail source SHA-256 integrity", async () => {
  const { storage, sourceTextExtractor, curriculumExtractor, service, workflow } =
    makeWorkflow();
  const ingested = await service.ingest("user-1", uploadWithoutText());
  storage.objects.set(
    ingested.version.storageKey,
    Buffer.from("%PDF-1.7\ntampered bytes", "utf8"),
  );

  await assert.rejects(
    workflow.process("user-1", "A1-MASTER-P01", "1.0.0"),
    (error: unknown) =>
      error instanceof RealCurriculumDocumentWorkflowError &&
      error.code === "storage_integrity_error",
  );

  assert.equal(sourceTextExtractor.calls, 0);
  assert.equal(curriculumExtractor.inputs.length, 0);
});

test("M12 authenticated process route performs the real workflow without exposing source text or storage key", async () => {
  const { service, workflow } = makeWorkflow();
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "memo",
    passwordHash: "hash",
    createdAt: new Date(),
  };
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
    {
      authStore,
      curriculumDocumentService: service,
      realCurriculumDocumentWorkflow: workflow,
    },
  );

  const unauthorized = await server.inject({
    method: "POST",
    url: "/languages/curriculum-documents/A1-MASTER-P01/versions/1.0.0/process",
  });
  assert.equal(unauthorized.statusCode, 401);

  const cookie = createSessionCookie(user.id).split(";", 1)[0];
  const uploaded = await server.inject({
    method: "POST",
    url: "/languages/curriculum-documents",
    headers: { cookie: cookie ?? "" },
    payload: uploadWithoutText(),
  });
  assert.equal(uploaded.statusCode, 201);
  assert.equal(uploaded.json().version.extractionStatus, "pending");

  const processed = await server.inject({
    method: "POST",
    url: "/languages/curriculum-documents/A1-MASTER-P01/versions/1.0.0/process",
    headers: { cookie: cookie ?? "" },
  });
  assert.equal(processed.statusCode, 201);
  const body = processed.json();
  assert.equal(body.extractionPerformed, true);
  assert.equal(body.version.extractionStatus, "ready");
  assert.equal(body.units[0].status, "review");
  assert.equal("storageKey" in body.version, false);
  assert.equal("extractedText" in body.version, false);

  await server.close();
});
