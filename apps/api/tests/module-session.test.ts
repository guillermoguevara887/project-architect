import assert from "node:assert/strict";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import { germanA1U01L05LessonSpecFixture } from "./fixtures/lesson-spec/german-a1-u01-l05.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

const id = "11111111-1111-4111-8111-111111111111";
const endpoints = [
  ["GET", "/architect/projects", "architectProjectStore.listForUser", undefined],
  ["GET", "/journey/ideas", "journeyStore.listIdeas", undefined],
  ["GET", "/exercises", "exerciseStore.listExercises", undefined],
  ["GET", "/languages/projects", "languageStore.listProjects", undefined],
  ["POST", `/languages/projects/${id}/lessons/${id}/audio`, "languageStore.findProjectByIdForUser",
    { version: "original", section: "vocabulary", index: 0 }],
  ["GET", "/languages/curriculum-documents", "curriculumDocumentService.listDocuments", undefined],
  ["POST", "/languages/curriculum-documents/A1/versions/1.0.0/process", "realCurriculumDocumentWorkflow.process", undefined],
  ["POST", `/languages/curriculum-units/${id}/review`, "curriculumUnitReviewService.review",
    { action: "accept", note: "Session control test" }],
  ["POST", "/languages/lesson-generations", "productionLessonGenerationService.generate",
    { lessonSpec: germanA1U01L05LessonSpecFixture }],
  ["POST", `/languages/curriculum-planning-bundles/${id}/generate`, "curriculumOrchestrationService.generatePlanningBundle", undefined],
  ["GET", "/languages/knowledge/profiles", "languageKnowledgeService.listProfiles", undefined],
  ["POST", "/languages/adaptation-resolution-runs", "adaptationResolutionService.start",
    { curriculumUnitRecordId: id, profileRecordId: id, registryRecordId: id }],
  ["POST", `/languages/adaptation-resolution-runs/${id}/profile-research`, "profileResearchService.researchBlockedRun", undefined],
] as const;

test("every module resolver allows current sessions and rejects stale and tampered cookies before business operations", async () => {
  const user: AuthUser = { id, username: "module-user", passwordHash: "unused", role: "user", sessionVersion: 2, createdAt: new Date() };
  const authStore: AuthStore = {
    async findById(userId) { return userId === id ? user : null; },
    async findByUsername() { return user; },
  };
  const businessCalls: string[] = [];
  type Dependencies = NonNullable<Parameters<typeof createServer>[1]>;
  const dependencies = Object.fromEntries([
    "architectProjectStore", "journeyStore", "exerciseStore", "languageStore",
    "languageAudioStore", "curriculumDocumentService", "realCurriculumDocumentWorkflow",
    "curriculumUnitReviewService", "productionLessonGenerationService",
    "curriculumOrchestrationService", "languageKnowledgeService",
    "adaptationResolutionService", "profileResearchService",
  ].map((key) => [key, new Proxy({}, {
    get(_target, method) {
      return () => {
        businessCalls.push(`${key}.${String(method)}`);
        // Stop at the business boundary: these tests only exercise session resolution.
        throw new Error("Business operation reached by session control test.");
      };
    },
  })])) as Dependencies;
  const server = createServer({}, { ...dependencies, authStore });
  const stale = createSessionCookie(id, 1).split(";", 1)[0]!;
  const current = createSessionCookie(id, 2).split(";", 1)[0]!;
  const tampered = current.slice(0, -1) + (current.endsWith("A") ? "B" : "A");

  try {
    for (const [method, url, expectedOperation, payload] of endpoints) {
      businessCalls.length = 0;
      for (const cookie of [stale, tampered]) {
        const response = await server.inject({ method, url, payload, headers: { cookie } });
        assert.equal(response.statusCode, 401, `${method} ${url}`);
        assert.deepEqual(businessCalls, [], `${method} ${url} must stop before business operations`);
      }
      await server.inject({ method, url, payload, headers: { cookie: current } });
      const curriculumAdminOnly = url.startsWith("/languages/curriculum-documents") || url.includes("/curriculum-units/");
      assert.deepEqual(businessCalls, curriculumAdminOnly ? [] : [expectedOperation],
        `${method} ${url} must enforce its role boundary before business operations`);
    }
  } finally {
    await server.close();
  }
});
