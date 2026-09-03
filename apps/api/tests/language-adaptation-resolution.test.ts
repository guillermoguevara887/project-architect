import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import {
  validateAdaptationDecisionCandidate,
  type AdaptationDecisionCandidate,
  type AdaptationDecisionProposalInput,
  type AdaptationDecisionProposer,
} from "../src/languages/ai/adaptation-decision-proposer.js";
import type { LanguageDecision } from "../src/languages/decisions/language-decision-registry.js";
import type { LanguageKnowledgeService } from "../src/languages/knowledge/service.js";
import {
  compileVersionedAdaptationPlan,
  finalizeResolvedAdaptationPlan,
  hasPromotableProfileEvidenceForTask,
} from "../src/languages/resolution/adaptation-resolution-runtime.js";
import {
  AdaptationResolutionService,
  AdaptationResolutionServiceError,
} from "../src/languages/resolution/service.js";
import type {
  AdaptationResolutionContext,
  AdaptationResolutionRunRecord,
  AdaptationResolutionStore,
} from "../src/languages/resolution/repository.js";
import {
  germanM5DecisionRegistryFixture,
} from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UNIT_RECORD_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_RECORD_ID = "33333333-3333-4333-8333-333333333333";
const BASE_REGISTRY_RECORD_ID = "44444444-4444-4444-8444-444444444444";
const FULL_REGISTRY_RECORD_ID = "55555555-5555-4555-8555-555555555555";
const PROPOSAL_ID = "66666666-6666-4666-8666-666666666666";

function profileWithFirstContactEvidence() {
  const profile = structuredClone(germanLanguageProfileFixture);
  profile.version = "1.1.0";
  profile.evidenceRegistry.claims.push({
    claimId: "de.claim.social.interaction",
    featureRef: "de.social.interaction",
    statement:
      "The reviewed profile models first-contact interaction norms as adaptation-relevant.",
    evidenceRefs: ["fixture.reference"],
    confidence: "high",
    reviewStatus: "cross_checked",
  });
  return profile;
}

function provisionalFirstContactDecision(): LanguageDecision {
  const source = germanM5DecisionRegistryFixture.decisions.find(
    (decision) => decision.identity.decisionId === "localization.first_contact.de",
  );
  assert.ok(source);
  const decision = structuredClone(source);
  decision.identity.status = "provisional";
  decision.languageBasis.claimRefs = ["de.claim.social.interaction"];
  decision.evidence.profileClaimRefs = ["de.claim.social.interaction"];
  decision.evidence.externalEvidenceRefs = [];
  decision.evidence.confidence = "medium";
  decision.evidence.reviewStatus = "machine_synthesized";
  decision.evidence.reasoningSummary =
    "Machine-synthesized first-contact proposal grounded only in the reviewed LanguageProfile.";
  decision.lifecycle.createdFrom = {
    sourceType: "profile_reasoning",
    sourceRefs: ["de.social.interaction"],
  };
  delete decision.lifecycle.supersedes;
  return decision;
}

function validFirstContactCandidate(
  input: AdaptationDecisionProposalInput,
): AdaptationDecisionCandidate {
  const candidate: AdaptationDecisionCandidate = {
    adaptationPlanRef: {
      id: input.adaptationPlan.identity.adaptationPlanId,
      version: input.adaptationPlan.version,
    },
    registryRef: {
      id: input.registry.identity.registryId,
      version: input.registry.version,
    },
    researchTaskRef: input.researchTaskRef,
    disposition: "proposed",
    proposals: [
      {
        operation: "create",
        requirementRefs: ["AR10"],
        decision: provisionalFirstContactDecision(),
      },
    ],
  };
  const validation = validateAdaptationDecisionCandidate(candidate, input);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues, null, 2));
  return candidate;
}

class MemoryResolutionStore implements AdaptationResolutionStore {
  runs: AdaptationResolutionRunRecord[] = [];
  contexts = new Map<string, AdaptationResolutionContext>();

  addContext(context: AdaptationResolutionContext) {
    this.contexts.set(
      `${context.profileRecordId}:${context.registryRecordId}`,
      structuredClone(context),
    );
  }

  async loadContext(input: {
    userId: string;
    curriculumUnitRecordId: string;
    profileRecordId: string;
    registryRecordId: string;
  }) {
    if (input.userId !== USER_ID || input.curriculumUnitRecordId !== UNIT_RECORD_ID) {
      return null;
    }
    return structuredClone(
      this.contexts.get(`${input.profileRecordId}:${input.registryRecordId}`) ?? null,
    );
  }

  async createRun(input: {
    userId: string;
    context: AdaptationResolutionContext;
    previousRunId?: string | null;
    stage: AdaptationResolutionRunRecord["stage"];
    adaptationPlan: AdaptationResolutionRunRecord["adaptationPlan"];
    activeResearchTaskRef?: string | null;
    blockedResearchTaskRefs?: string[];
    proposalIds?: string[];
    detail?: string | null;
    contentSha256: string;
  }) {
    if (input.userId !== USER_ID) return null;
    if (
      input.previousRunId &&
      !this.runs.some(
        (run) =>
          run.id === input.previousRunId &&
          run.userId === input.userId &&
          run.curriculumUnitRecordId === input.context.curriculumUnitRecordId,
      )
    ) {
      return null;
    }
    const record: AdaptationResolutionRunRecord = {
      id: randomUUID(),
      userId: input.userId,
      curriculumUnitRecordId: input.context.curriculumUnitRecordId,
      profileRecordId: input.context.profileRecordId,
      registryRecordId: input.context.registryRecordId,
      previousRunId: input.previousRunId ?? null,
      stage: input.stage,
      adaptationPlan: structuredClone(input.adaptationPlan),
      activeResearchTaskRef: input.activeResearchTaskRef ?? null,
      blockedResearchTaskRefs: [...(input.blockedResearchTaskRefs ?? [])],
      proposalIds: [...(input.proposalIds ?? [])],
      detail: input.detail ?? null,
      contentSha256: input.contentSha256,
      createdAt: new Date(),
    };
    this.runs.push(record);
    return structuredClone(record);
  }

  async findRunForUser(userId: string, runId: string) {
    const run = this.runs.find((entry) => entry.id === runId && entry.userId === userId);
    return run ? structuredClone(run) : null;
  }
}

function baseContext(profile = germanLanguageProfileFixture): AdaptationResolutionContext {
  return {
    curriculumUnitRecordId: UNIT_RECORD_ID,
    curriculum: structuredClone(a1U01CurriculumFixture),
    profileRecordId: PROFILE_RECORD_ID,
    languageProfile: structuredClone(profile),
    registryRecordId: BASE_REGISTRY_RECORD_ID,
    registry: structuredClone(germanDecisionRegistryFixture),
  };
}

function fullContext(profile = profileWithFirstContactEvidence()): AdaptationResolutionContext {
  return {
    curriculumUnitRecordId: UNIT_RECORD_ID,
    curriculum: structuredClone(a1U01CurriculumFixture),
    profileRecordId: PROFILE_RECORD_ID,
    languageProfile: structuredClone(profile),
    registryRecordId: FULL_REGISTRY_RECORD_ID,
    registry: structuredClone(germanM5DecisionRegistryFixture),
  };
}

function knowledgeFake() {
  const state = {
    persistCalls: 0,
    proposal: {
      id: PROPOSAL_ID,
      status: "pending_review" as "pending_review" | "accepted" | "rejected",
      promotedRegistryRecordId: null as string | null,
    },
  };
  const service = {
    async persistDecisionCandidate() {
      state.persistCalls += 1;
      return [{ id: PROPOSAL_ID }];
    },
    async getProposal() {
      return structuredClone(state.proposal);
    },
  } as unknown as LanguageKnowledgeService;
  return { state, service };
}

function firstContactProposer(counter: { calls: number }): AdaptationDecisionProposer {
  return {
    async propose(input) {
      counter.calls += 1;
      const candidate = validFirstContactCandidate(input);
      return {
        value: candidate,
        attempts: 1,
        validationHistory: [
          { attempt: 1, outcome: "accepted" as const, issues: [] },
        ],
      };
    },
  };
}

test("M13 finalizes a gap-free Registry snapshot into a READY AdaptationPlan for M10", () => {
  const profile = profileWithFirstContactEvidence();
  const plan = compileVersionedAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: profile,
    registry: germanM5DecisionRegistryFixture,
  });
  assert.equal(plan.gapAnalysis.length, 0);
  assert.equal(plan.version, germanM5DecisionRegistryFixture.version);

  const ready = finalizeResolvedAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: profile,
    registry: germanM5DecisionRegistryFixture,
    plan,
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.readiness.state, "ready");
  assert.equal(ready.outputs.routeReady, true);
  assert.equal(ready.coverageAudit.status, "pass");
  assert.equal(ready.projectionAudit.status, "pass");
  assert.equal(ready.consistencyAudit.status, "pass");
  assert.equal(
    ready.outputs.adaptedUnitSpecRef?.id,
    "adapted.A1-U01.de.standard",
  );
});

test("M13 escalates reviewed Profile coverage with insufficient claim evidence before calling M6", async () => {
  const store = new MemoryResolutionStore();
  store.addContext(baseContext());
  const calls = { calls: 0 };
  const knowledge = knowledgeFake();
  const service = new AdaptationResolutionService(
    store,
    firstContactProposer(calls),
    knowledge.service,
  );

  const run = await service.start({
    userId: USER_ID,
    curriculumUnitRecordId: UNIT_RECORD_ID,
    profileRecordId: PROFILE_RECORD_ID,
    registryRecordId: BASE_REGISTRY_RECORD_ID,
  });

  assert.equal(run.stage, "awaiting_profile_research");
  assert.deepEqual(run.blockedResearchTaskRefs, ["research.first_contact"]);
  assert.match(run.detail ?? "", /profile_claim_evidence_required/);
  assert.equal(calls.calls, 0);
  assert.equal(knowledge.state.persistCalls, 0);
});

test("M13 persists exactly one M6 proposal, waits for M11, then resumes from the promoted Registry", async () => {
  const profile = profileWithFirstContactEvidence();
  const store = new MemoryResolutionStore();
  store.addContext(baseContext(profile));
  store.addContext(fullContext(profile));
  const calls = { calls: 0 };
  const knowledge = knowledgeFake();
  const service = new AdaptationResolutionService(
    store,
    firstContactProposer(calls),
    knowledge.service,
  );

  const first = await service.start({
    userId: USER_ID,
    curriculumUnitRecordId: UNIT_RECORD_ID,
    profileRecordId: PROFILE_RECORD_ID,
    registryRecordId: BASE_REGISTRY_RECORD_ID,
  });
  assert.equal(first.stage, "awaiting_decision_review");
  assert.equal(first.activeResearchTaskRef, "research.first_contact");
  assert.deepEqual(first.proposalIds, [PROPOSAL_ID]);
  assert.equal(calls.calls, 1);
  assert.equal(knowledge.state.persistCalls, 1);

  await assert.rejects(
    service.resume({ userId: USER_ID, runId: first.id }),
    (error: unknown) =>
      error instanceof AdaptationResolutionServiceError &&
      error.code === "decision_review_pending",
  );
  assert.equal(store.runs.length, 1, "pending review must not create a child run");

  knowledge.state.proposal.status = "accepted";
  knowledge.state.proposal.promotedRegistryRecordId = FULL_REGISTRY_RECORD_ID;
  const resumed = await service.resume({ userId: USER_ID, runId: first.id });

  assert.equal(resumed.previousRunId, first.id);
  assert.equal(resumed.registryRecordId, FULL_REGISTRY_RECORD_ID);
  assert.equal(resumed.stage, "ready_for_planning");
  assert.equal(resumed.adaptationPlan.status, "ready");
  assert.equal(resumed.adaptationPlan.outputs.routeReady, true);
  assert.equal(resumed.adaptationPlan.version, germanM5DecisionRegistryFixture.version);
});

test("M13 refuses to auto-persist multi-proposal candidates against one Registry snapshot", async () => {
  const profile = profileWithFirstContactEvidence();
  const store = new MemoryResolutionStore();
  store.addContext(baseContext(profile));
  const knowledge = knowledgeFake();
  const proposer: AdaptationDecisionProposer = {
    async propose(input) {
      const candidate = validFirstContactCandidate(input);
      candidate.proposals.push(structuredClone(candidate.proposals[0]!));
      return {
        value: candidate,
        attempts: 1,
        validationHistory: [
          { attempt: 1, outcome: "accepted" as const, issues: [] },
        ],
      };
    },
  };
  const service = new AdaptationResolutionService(store, proposer, knowledge.service);

  const run = await service.start({
    userId: USER_ID,
    curriculumUnitRecordId: UNIT_RECORD_ID,
    profileRecordId: PROFILE_RECORD_ID,
    registryRecordId: BASE_REGISTRY_RECORD_ID,
  });

  assert.equal(run.stage, "awaiting_upstream_research");
  assert.match(run.detail ?? "", /serial_review_required:2_proposals/);
  assert.equal(knowledge.state.persistCalls, 0);
  assert.deepEqual(run.proposalIds, []);
});

test("M13 Profile evidence preflight distinguishes coverage from promotable claims", () => {
  const basePlan = compileVersionedAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
  assert.equal(
    hasPromotableProfileEvidenceForTask({
      curriculum: a1U01CurriculumFixture,
      languageProfile: germanLanguageProfileFixture,
      plan: basePlan,
      researchTaskRef: "research.first_contact",
    }),
    false,
  );

  const profile = profileWithFirstContactEvidence();
  const enrichedPlan = compileVersionedAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: profile,
    registry: germanDecisionRegistryFixture,
  });
  assert.equal(
    hasPromotableProfileEvidenceForTask({
      curriculum: a1U01CurriculumFixture,
      languageProfile: profile,
      plan: enrichedPlan,
      researchTaskRef: "research.first_contact",
    }),
    true,
  );
});

test("M13 migration is additive and preserves append-only resolution lineage", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0023_create_language_adaptation_resolution_runs.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE language_adaptation_resolution_runs/u);
  assert.match(migration, /previous_run_id uuid REFERENCES language_adaptation_resolution_runs\(id\)/u);
  assert.match(migration, /awaiting_decision_review/u);
  assert.match(migration, /awaiting_profile_research/u);
  assert.match(migration, /awaiting_external_research/u);
  assert.match(migration, /ready_for_planning/u);
  assert.match(migration, /content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/iu);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/iu);
});

test("M13 routes require authentication and expose state without Registry/Profile snapshots", async () => {
  const store = new MemoryResolutionStore();
  store.addContext(baseContext());
  const calls = { calls: 0 };
  const knowledge = knowledgeFake();
  const resolutionService = new AdaptationResolutionService(
    store,
    firstContactProposer(calls),
    knowledge.service,
  );
  const user = {
    id: USER_ID,
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
    { authStore, adaptationResolutionService: resolutionService },
  );

  const unauthorized = await server.inject({
    method: "POST",
    url: "/languages/adaptation-resolution-runs",
    payload: {
      curriculumUnitRecordId: UNIT_RECORD_ID,
      profileRecordId: PROFILE_RECORD_ID,
      registryRecordId: BASE_REGISTRY_RECORD_ID,
    },
  });
  assert.equal(unauthorized.statusCode, 401);

  const cookie = createSessionCookie(user.id).split(";", 1)[0] ?? "";
  const started = await server.inject({
    method: "POST",
    url: "/languages/adaptation-resolution-runs",
    headers: { cookie },
    payload: {
      curriculumUnitRecordId: UNIT_RECORD_ID,
      profileRecordId: PROFILE_RECORD_ID,
      registryRecordId: BASE_REGISTRY_RECORD_ID,
    },
  });
  assert.equal(started.statusCode, 201);
  const body = started.json();
  assert.equal(body.run.stage, "awaiting_profile_research");
  assert.equal("languageProfile" in body.run, false);
  assert.equal("registry" in body.run, false);

  const fetched = await server.inject({
    method: "GET",
    url: `/languages/adaptation-resolution-runs/${body.run.id}`,
    headers: { cookie },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().run.contentSha256.length, 64);

  await server.close();
});
