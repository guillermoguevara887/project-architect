import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import type { AuthStore } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import {
  buildEnrichedLanguageProfile,
  validateLanguageProfileResearchCandidate,
  type LanguageProfileResearchCandidate,
} from "../src/languages/profile-research/contracts.js";
import {
  OpenAILanguageProfileResearcher,
  type LanguageProfileResearcher,
} from "../src/languages/profile-research/researcher.js";
import type {
  ProfileResearchRunRecord,
  ProfileResearchStore,
} from "../src/languages/profile-research/repository.js";
import { registerProfileResearchRoutes } from "../src/languages/profile-research/routes.js";
import { ProfileResearchService } from "../src/languages/profile-research/service.js";
import type { KnowledgeProfileRecord } from "../src/languages/knowledge/repository.js";
import type {
  AdaptationResolutionContext,
  AdaptationResolutionRunRecord,
  AdaptationResolutionStore,
} from "../src/languages/resolution/repository.js";
import { compileVersionedAdaptationPlan } from "../src/languages/resolution/adaptation-resolution-runtime.js";
import type { AdaptationResolutionService } from "../src/languages/resolution/service.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UNIT_RECORD_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_RECORD_ID = "33333333-3333-4333-8333-333333333333";
const NEW_PROFILE_RECORD_ID = "77777777-7777-4777-8777-777777777777";
const REGISTRY_RECORD_ID = "44444444-4444-4444-8444-444444444444";
const RESOLUTION_RUN_ID = "88888888-8888-4888-8888-888888888888";
const RESUMED_RUN_ID = "99999999-9999-4999-8999-999999999999";
const URL_A = "https://www.goethe.de/en/spr/ueb/daa.html";
const URL_B = "https://www.deutschland.de/en/topic/life/german-language-and-culture";

function plan() {
  return compileVersionedAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
}

function candidate(): LanguageProfileResearchCandidate {
  const adaptationPlan = plan();
  return {
    baseProfileRef: {
      id: germanLanguageProfileFixture.identity.profileId,
      version: germanLanguageProfileFixture.version,
    },
    adaptationPlanRef: {
      id: adaptationPlan.identity.adaptationPlanId,
      version: adaptationPlan.version,
    },
    researchTaskRefs: ["research.first_contact"],
    disposition: "enriched",
    sources: [
      {
        sourceId: "m14.source.goethe.first_contact",
        sourceType: "reputable_educational",
        authorityClass: "language_institute",
        title: "German language and interaction reference",
        publisherOrAuthor: "Goethe-Institut",
        urlOrReference: URL_A,
        language: "English",
      },
      {
        sourceId: "m14.source.deutschland.first_contact",
        sourceType: "publisher_reference",
        authorityClass: "public_information_portal",
        title: "German language and culture reference",
        publisherOrAuthor: "Deutschland.de",
        urlOrReference: URL_B,
        language: "English",
      },
    ],
    claims: [
      {
        claimId: "de.claim.social.interaction.m14",
        featureRef: "de.social.interaction",
        statement:
          "Neutral-standard first-contact interaction in German is shaped by relationship and setting, so an A1 strategy should preserve contextual register distinctions.",
        evidenceRefs: [
          "m14.source.goethe.first_contact",
          "m14.source.deutschland.first_contact",
        ],
        confidence: "high",
        reviewStatus: "machine_synthesized",
        requirementRefs: ["AR10"],
      },
    ],
  };
}

function validationInput() {
  return {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    adaptationPlan: plan(),
    researchTaskRefs: ["research.first_contact"],
    observedUrls: [URL_A, URL_B],
  };
}

function resolutionContext(): AdaptationResolutionContext {
  return {
    curriculumUnitRecordId: UNIT_RECORD_ID,
    curriculum: structuredClone(a1U01CurriculumFixture),
    profileRecordId: PROFILE_RECORD_ID,
    languageProfile: structuredClone(germanLanguageProfileFixture),
    registryRecordId: REGISTRY_RECORD_ID,
    registry: structuredClone(germanDecisionRegistryFixture),
  };
}

function blockedResolutionRun(): AdaptationResolutionRunRecord {
  return {
    id: RESOLUTION_RUN_ID,
    userId: USER_ID,
    curriculumUnitRecordId: UNIT_RECORD_ID,
    profileRecordId: PROFILE_RECORD_ID,
    registryRecordId: REGISTRY_RECORD_ID,
    previousRunId: null,
    stage: "awaiting_profile_research",
    adaptationPlan: plan(),
    activeResearchTaskRef: null,
    blockedResearchTaskRefs: ["research.first_contact"],
    proposalIds: [],
    detail: "profile_claim_evidence_required_before_registry_reasoning",
    contentSha256: "resolution-sha",
    createdAt: new Date("2026-09-03T18:00:00.000Z"),
  };
}

class MemoryProfileResearchStore implements ProfileResearchStore {
  runs: ProfileResearchRunRecord[] = [];

  async createRun(input: Omit<ProfileResearchRunRecord, "id" | "createdAt">) {
    if (input.userId !== USER_ID) return null;
    const record: ProfileResearchRunRecord = {
      ...structuredClone(input),
      id: randomUUID(),
      createdAt: new Date("2026-09-03T18:05:00.000Z"),
    };
    this.runs.push(record);
    return structuredClone(record);
  }

  async findRunForUser(userId: string, runId: string) {
    const record = this.runs.find((run) => run.userId === userId && run.id === runId);
    return record ? structuredClone(record) : null;
  }
}

function resolutionStore(): AdaptationResolutionStore {
  const run = blockedResolutionRun();
  const context = resolutionContext();
  return {
    async findRunForUser(userId, runId) {
      return userId === USER_ID && runId === RESOLUTION_RUN_ID
        ? structuredClone(run)
        : null;
    },
    async loadContext(input) {
      return input.userId === USER_ID &&
        input.curriculumUnitRecordId === UNIT_RECORD_ID &&
        input.profileRecordId === PROFILE_RECORD_ID &&
        input.registryRecordId === REGISTRY_RECORD_ID
        ? structuredClone(context)
        : null;
    },
    async createRun() {
      throw new Error("M14 test does not create M13 runs through the store directly.");
    },
  };
}

function researcherFake(
  value = candidate(),
): LanguageProfileResearcher {
  return {
    async research() {
      return {
        value: structuredClone(value),
        attempts: 1,
        validationHistory: [
          { attempt: 1, outcome: "accepted" as const, issues: [] },
        ],
        observedUrls: [URL_A, URL_B],
        providerModel: "m14-test-model",
      };
    },
  };
}

function authStoreFake(): AuthStore {
  return {
    async findById(id: string) {
      return id === USER_ID
        ? {
            id: USER_ID,
            email: "m14@example.com",
            passwordHash: "not-used",
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null;
    },
  } as AuthStore;
}

test("M14 accepts only source-triangulated claims tied to blocked existing Profile features", () => {
  const result = validateLanguageProfileResearchCandidate(candidate(), validationInput());
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));

  const invented = candidate();
  invented.sources[1]!.urlOrReference = "https://invented.invalid/evidence";
  const invalid = validateLanguageProfileResearchCandidate(invented, validationInput());
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.code === "PROFILE_RESEARCH_UNOBSERVED_SOURCE"));
});

test("M14 evidence enrichment creates a new review Profile and MemoOS—not the model—cross-checks the claim", () => {
  const enriched = buildEnrichedLanguageProfile({
    baseProfile: germanLanguageProfileFixture,
    candidate: candidate(),
    accessedAt: "2026-09-03T18:00:00.000Z",
  });

  assert.equal(enriched.version, "1.1.0");
  assert.equal(enriched.status, "review");
  const claim = enriched.evidenceRegistry.claims.find(
    (entry) => entry.claimId === "de.claim.social.interaction.m14",
  );
  assert.ok(claim);
  assert.equal(claim.reviewStatus, "cross_checked");
  assert.deepEqual(claim.evidenceRefs.sort(), [
    "m14.source.deutschland.first_contact",
    "m14.source.goethe.first_contact",
  ]);
  assert.equal(enriched.sociolinguisticSystem.interactionalNorms.reviewStatus, "cross_checked");
});

test("M14 OpenAI boundary requires web search and validates URLs exposed by the tool call", async () => {
  let capturedTools: unknown;
  let capturedInclude: unknown;
  const researcher = new OpenAILanguageProfileResearcher(
    async (request) => {
      capturedTools = request.tools;
      capturedInclude = request.include;
      return {
        status: "completed",
        output_text: JSON.stringify(candidate()),
        output: [
          {
            type: "web_search_call",
            action: {
              type: "search",
              sources: [
                { type: "url", url: URL_A },
                { type: "url", url: URL_B },
              ],
            },
          },
        ],
      };
    },
    "m14-test-model",
    1,
  );

  const result = await researcher.research({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    adaptationPlan: plan(),
    researchTaskRefs: ["research.first_contact"],
  });

  assert.deepEqual(capturedTools, [{ type: "web_search", search_context_size: "high" }]);
  assert.deepEqual(capturedInclude, ["web_search_call.action.sources"]);
  assert.deepEqual(result.observedUrls.sort(), [URL_A, URL_B].sort());
  assert.equal(result.value.disposition, "enriched");
});

test("M14 service registers the enriched Profile and automatically resumes the blocked M13 run", async () => {
  const researchStore = new MemoryProfileResearchStore();
  let persistedProfile: KnowledgeProfileRecord | null = null;
  const knowledge = {
    async registerProfile(userId: string, profile: typeof germanLanguageProfileFixture) {
      assert.equal(userId, USER_ID);
      assert.equal(profile.version, "1.1.0");
      const claim = profile.evidenceRegistry.claims.find(
        (entry) => entry.claimId === "de.claim.social.interaction.m14",
      );
      assert.equal(claim?.reviewStatus, "cross_checked");
      persistedProfile = {
        id: NEW_PROFILE_RECORD_ID,
        userId,
        profile: structuredClone(profile),
        contentSha256: "new-profile-sha",
        createdAt: new Date(),
      };
      return persistedProfile;
    },
  };
  let resumeCalls = 0;
  const resolution = {
    async resume(input: { userId: string; runId: string; profileRecordId?: string }) {
      resumeCalls += 1;
      assert.deepEqual(input, {
        userId: USER_ID,
        runId: RESOLUTION_RUN_ID,
        profileRecordId: NEW_PROFILE_RECORD_ID,
      });
      return {
        ...blockedResolutionRun(),
        id: RESUMED_RUN_ID,
        previousRunId: RESOLUTION_RUN_ID,
        profileRecordId: NEW_PROFILE_RECORD_ID,
        stage: "awaiting_decision_review" as const,
        blockedResearchTaskRefs: [],
        activeResearchTaskRef: "research.first_contact",
      };
    },
  } as Pick<AdaptationResolutionService, "resume">;

  const service = new ProfileResearchService(
    resolutionStore(),
    researcherFake(),
    knowledge,
    resolution,
    researchStore,
    () => new Date("2026-09-03T18:00:00.000Z"),
  );
  const result = await service.researchBlockedRun({
    userId: USER_ID,
    resolutionRunId: RESOLUTION_RUN_ID,
  });

  assert.ok(persistedProfile);
  assert.equal(resumeCalls, 1);
  assert.equal(result.researchRun.stage, "completed");
  assert.equal(result.researchRun.enrichedProfileRecordId, NEW_PROFILE_RECORD_ID);
  assert.equal(result.researchRun.resumedResolutionRunId, RESUMED_RUN_ID);
  assert.equal(result.resumedResolutionRun?.stage, "awaiting_decision_review");
});

test("M14 preserves ambiguous research for review without changing Profile or resuming M13", async () => {
  const reviewCandidate: LanguageProfileResearchCandidate = {
    ...candidate(),
    disposition: "needs_review",
    blockingReason: "The available sources conflict on the intended register scope.",
    sources: [],
    claims: [],
  };
  const researchStore = new MemoryProfileResearchStore();
  let knowledgeCalls = 0;
  let resumeCalls = 0;
  const service = new ProfileResearchService(
    resolutionStore(),
    researcherFake(reviewCandidate),
    {
      async registerProfile() {
        knowledgeCalls += 1;
        throw new Error("must not be called");
      },
    },
    {
      async resume() {
        resumeCalls += 1;
        throw new Error("must not be called");
      },
    } as Pick<AdaptationResolutionService, "resume">,
    researchStore,
  );

  const result = await service.researchBlockedRun({
    userId: USER_ID,
    resolutionRunId: RESOLUTION_RUN_ID,
  });
  assert.equal(result.researchRun.stage, "needs_review");
  assert.equal(result.researchRun.enrichedProfileRecordId, null);
  assert.equal(result.researchRun.resumedResolutionRunId, null);
  assert.equal(knowledgeCalls, 0);
  assert.equal(resumeCalls, 0);
});

test("M14 routes require authentication and never accept client-authored evidence", async () => {
  const store = new MemoryProfileResearchStore();
  const stored: ProfileResearchRunRecord = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: USER_ID,
    adaptationResolutionRunId: RESOLUTION_RUN_ID,
    resumedResolutionRunId: RESUMED_RUN_ID,
    baseProfileRecordId: PROFILE_RECORD_ID,
    enrichedProfileRecordId: NEW_PROFILE_RECORD_ID,
    stage: "completed",
    researchTaskRefs: ["research.first_contact"],
    candidate: candidate(),
    observedUrls: [URL_A, URL_B],
    providerModel: "m14-test-model",
    validationHistory: [{ attempt: 1, outcome: "accepted", issues: [] }],
    detail: "profile_enriched_and_resolution_resumed",
    contentSha256: "sha",
    createdAt: new Date("2026-09-03T18:05:00.000Z"),
  };
  store.runs.push(stored);
  const fakeService = {
    async researchBlockedRun({ userId, resolutionRunId }: { userId: string; resolutionRunId: string }) {
      assert.equal(userId, USER_ID);
      assert.equal(resolutionRunId, RESOLUTION_RUN_ID);
      return { researchRun: structuredClone(stored), enrichedProfile: null, resumedResolutionRun: null };
    },
    async getRun(userId: string, researchRunId: string) {
      assert.equal(userId, USER_ID);
      assert.equal(researchRunId, stored.id);
      return structuredClone(stored);
    },
  } as ProfileResearchService;
  const server = Fastify();
  registerProfileResearchRoutes(server, {
    authStore: authStoreFake(),
    service: fakeService,
  });

  const unauthenticated = await server.inject({
    method: "POST",
    url: `/languages/adaptation-resolution-runs/${RESOLUTION_RUN_ID}/profile-research`,
    payload: {},
  });
  assert.equal(unauthenticated.statusCode, 401);

  const cookie = createSessionCookie(USER_ID);
  const malicious = await server.inject({
    method: "POST",
    url: `/languages/adaptation-resolution-runs/${RESOLUTION_RUN_ID}/profile-research`,
    headers: { cookie },
    payload: { claims: candidate().claims },
  });
  assert.equal(malicious.statusCode, 400);

  const accepted = await server.inject({
    method: "POST",
    url: `/languages/adaptation-resolution-runs/${RESOLUTION_RUN_ID}/profile-research`,
    headers: { cookie },
    payload: {},
  });
  assert.equal(accepted.statusCode, 201);
  const body = accepted.json() as { run: { enrichedProfileRecordId: string } };
  assert.equal(body.run.enrichedProfileRecordId, NEW_PROFILE_RECORD_ID);

  await server.close();
});

test("M14 migration is additive and links research evidence to M13 lineage", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0024_create_language_profile_research_runs.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE language_profile_research_runs/u);
  assert.match(migration, /adaptation_resolution_run_id uuid NOT NULL/u);
  assert.match(migration, /resumed_resolution_run_id uuid REFERENCES/u);
  assert.match(migration, /enriched_profile_record_id uuid REFERENCES/u);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE language_knowledge_profiles/u);
});
