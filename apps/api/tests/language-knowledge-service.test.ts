import assert from "node:assert/strict";
import test from "node:test";
import {
  compileInitialAdaptationPlan,
  type AdaptationPlan,
} from "../src/languages/adaptation/adaptation-plan.js";
import type { AdaptationDecisionCandidate } from "../src/languages/ai/adaptation-decision-proposer.js";
import type { LanguageDecision } from "../src/languages/decisions/language-decision-registry.js";
import {
  LanguageKnowledgeService,
  LanguageKnowledgeServiceError,
} from "../src/languages/knowledge/service.js";
import type {
  DecisionProposalRecord,
  KnowledgeProfileRecord,
  KnowledgeRegistryRecord,
  LanguageKnowledgeStore,
} from "../src/languages/knowledge/repository.js";
import type { DecisionProposal } from "../src/languages/knowledge/promotion.js";
import { germanM5DecisionRegistryFixture } from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_RECORD_ID = "33333333-3333-4333-8333-333333333333";
const REGISTRY_RECORD_ID = "44444444-4444-4444-8444-444444444444";
const PROPOSAL_ID = "55555555-5555-4555-8555-555555555555";

function participantExtensionProposal(): DecisionProposal {
  const source = germanDecisionRegistryFixture.decisions.find(
    (decision) => decision.identity.decisionId === "participant.actor_affected",
  );
  assert.ok(source);
  const decision = structuredClone(source);
  decision.identity.decisionVersion = "1.1.0";
  decision.identity.status = "provisional";
  decision.evidence.externalEvidenceRefs = [];
  decision.evidence.confidence = "medium";
  decision.evidence.reviewStatus = "machine_synthesized";
  decision.lifecycle.createdFrom = {
    sourceType: "profile_reasoning",
    sourceRefs: ["de.claim.case"],
  };
  delete decision.lifecycle.supersedes;
  return {
    operation: "extend",
    requirementRefs: ["AR04"],
    baseDecisionRef: { id: "participant.actor_affected", version: "1.0.0" },
    decision,
  };
}

function initialGermanPlan(): AdaptationPlan {
  const compilation = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
  assert.ok(compilation.plan, JSON.stringify(compilation.validation.issues, null, 2));
  return compilation.plan;
}

function provisionalWritingDecision(): LanguageDecision {
  const source = germanM5DecisionRegistryFixture.decisions.find(
    (decision) => decision.identity.decisionId === "writing.beginner_strategy",
  );
  assert.ok(source);
  const decision = structuredClone(source);
  decision.identity.status = "provisional";
  decision.evidence.externalEvidenceRefs = [];
  decision.evidence.confidence = "medium";
  decision.evidence.reviewStatus = "machine_synthesized";
  decision.lifecycle.createdFrom = {
    sourceType: "profile_reasoning",
    sourceRefs: [...decision.languageBasis.featureRefs],
  };
  delete decision.lifecycle.supersedes;
  return decision;
}

class MemoryKnowledgeStore implements LanguageKnowledgeStore {
  profiles: KnowledgeProfileRecord[] = [
    {
      id: PROFILE_RECORD_ID,
      userId: USER_ID,
      profile: structuredClone(germanLanguageProfileFixture),
      contentSha256: "a".repeat(64),
      createdAt: new Date("2026-09-03T12:00:00Z"),
    },
  ];

  registries: KnowledgeRegistryRecord[] = [
    {
      id: REGISTRY_RECORD_ID,
      userId: USER_ID,
      profileRecordId: PROFILE_RECORD_ID,
      registry: structuredClone(germanDecisionRegistryFixture),
      contentSha256: "b".repeat(64),
      createdAt: new Date("2026-09-03T12:01:00Z"),
    },
  ];

  proposals: DecisionProposalRecord[] = [];

  async createProfile(input: Parameters<LanguageKnowledgeStore["createProfile"]>[0]) {
    const record: KnowledgeProfileRecord = {
      id: PROFILE_RECORD_ID,
      userId: input.userId,
      profile: structuredClone(input.profile),
      contentSha256: input.contentSha256,
      createdAt: new Date(),
    };
    this.profiles.push(record);
    return record;
  }

  async findProfile(userId: string, profileRecordId: string) {
    return this.profiles.find((item) => item.userId === userId && item.id === profileRecordId) ?? null;
  }

  async listProfiles(userId: string, languageId?: string, varietyId?: string) {
    return this.profiles.filter(
      (item) =>
        item.userId === userId &&
        (!languageId || item.profile.identity.languageId === languageId) &&
        (!varietyId || item.profile.identity.varietyId === varietyId),
    );
  }

  async createRegistry(input: Parameters<LanguageKnowledgeStore["createRegistry"]>[0]) {
    const profile = await this.findProfile(input.userId, input.profileRecordId);
    if (!profile) return null;
    const record: KnowledgeRegistryRecord = {
      id: `registry-${this.registries.length + 1}`,
      userId: input.userId,
      profileRecordId: input.profileRecordId,
      registry: structuredClone(input.registry),
      contentSha256: input.contentSha256,
      createdAt: new Date(),
    };
    this.registries.push(record);
    return record;
  }

  async findRegistry(userId: string, registryRecordId: string) {
    return this.registries.find((item) => item.userId === userId && item.id === registryRecordId) ?? null;
  }

  async listRegistries(userId: string, languageId?: string, varietyId?: string) {
    return this.registries.filter(
      (item) =>
        item.userId === userId &&
        (!languageId || item.registry.identity.languageId === languageId) &&
        (!varietyId || item.registry.identity.varietyId === varietyId),
    );
  }

  async createProposal(input: Parameters<LanguageKnowledgeStore["createProposal"]>[0]) {
    if (!(await this.findProfile(input.userId, input.profileRecordId))) return null;
    if (!(await this.findRegistry(input.userId, input.baseRegistryRecordId))) return null;
    const existing = this.proposals.find(
      (item) =>
        item.userId === input.userId &&
        item.baseRegistryRecordId === input.baseRegistryRecordId &&
        item.proposal.decision.identity.decisionId === input.proposal.decision.identity.decisionId &&
        item.proposal.decision.identity.decisionVersion === input.proposal.decision.identity.decisionVersion &&
        item.proposalSha256 === input.proposalSha256,
    );
    if (existing) return existing;
    const record: DecisionProposalRecord = {
      id: this.proposals.length === 0 ? PROPOSAL_ID : `proposal-${this.proposals.length + 1}`,
      userId: input.userId,
      profileRecordId: input.profileRecordId,
      baseRegistryRecordId: input.baseRegistryRecordId,
      adaptationPlanRef: structuredClone(input.adaptationPlanRef),
      researchTaskRef: input.researchTaskRef,
      proposal: structuredClone(input.proposal),
      proposalSha256: input.proposalSha256,
      status: "pending_review",
      reviewNote: null,
      reviewEvidenceStatus: null,
      reviewConfidence: null,
      promotedRegistryRecordId: null,
      createdAt: new Date(),
      reviewedAt: null,
    };
    this.proposals.push(record);
    return record;
  }

  async findProposal(userId: string, proposalId: string) {
    return this.proposals.find((item) => item.userId === userId && item.id === proposalId) ?? null;
  }

  async listProposals(userId: string, status?: DecisionProposalRecord["status"]) {
    return this.proposals.filter(
      (item) => item.userId === userId && (!status || item.status === status),
    );
  }

  async rejectProposal(input: Parameters<LanguageKnowledgeStore["rejectProposal"]>[0]) {
    const record = await this.findProposal(input.userId, input.proposalId);
    if (!record || record.status !== "pending_review") return null;
    record.status = "rejected";
    record.reviewNote = input.note;
    record.reviewedAt = new Date();
    return record;
  }

  async acceptProposal(input: Parameters<LanguageKnowledgeStore["acceptProposal"]>[0]) {
    const proposal = await this.findProposal(input.userId, input.proposalId);
    if (!proposal || proposal.status !== "pending_review") return null;
    const registry: KnowledgeRegistryRecord = {
      id: `registry-promoted-${this.registries.length + 1}`,
      userId: input.userId,
      profileRecordId: input.profileRecordId,
      registry: structuredClone(input.registry),
      contentSha256: input.contentSha256,
      createdAt: new Date(),
    };
    this.registries.push(registry);
    proposal.status = "accepted";
    proposal.reviewNote = input.note;
    proposal.reviewEvidenceStatus = input.evidenceReviewStatus;
    proposal.reviewConfidence = input.confidence;
    proposal.promotedRegistryRecordId = registry.id;
    proposal.reviewedAt = new Date();
    return { proposal, registry };
  }
}

test("M11 service promotes an owned pending proposal and refuses a second review", async () => {
  const store = new MemoryKnowledgeStore();
  store.proposals.push({
    id: PROPOSAL_ID,
    userId: USER_ID,
    profileRecordId: PROFILE_RECORD_ID,
    baseRegistryRecordId: REGISTRY_RECORD_ID,
    adaptationPlanRef: { id: "adaptation.A1-U01.de.standard", version: "1.0.0" },
    researchTaskRef: "research.participant",
    proposal: participantExtensionProposal(),
    proposalSha256: "c".repeat(64),
    status: "pending_review",
    reviewNote: null,
    reviewEvidenceStatus: null,
    reviewConfidence: null,
    promotedRegistryRecordId: null,
    createdAt: new Date(),
    reviewedAt: null,
  });
  const service = new LanguageKnowledgeService(store);

  const accepted = await service.reviewProposal(USER_ID, PROPOSAL_ID, {
    action: "accept",
    evidenceReviewStatus: "human_reviewed",
    confidence: "high",
    note: "Reviewed against the German profile and accepted.",
  });

  assert.equal(accepted.proposal.status, "accepted");
  assert.equal(accepted.promotedRegistry?.registry.version, "1.1.0");
  assert.equal(store.registries.length, 2);

  await assert.rejects(
    () => service.reviewProposal(USER_ID, PROPOSAL_ID, {
      action: "reject",
      note: "A second review must not be possible.",
    }),
    (error: unknown) => {
      assert.ok(error instanceof LanguageKnowledgeServiceError);
      assert.equal(error.code, "proposal_already_reviewed");
      return true;
    },
  );
});

test("M11 service ownership hides another user's proposal as not found", async () => {
  const store = new MemoryKnowledgeStore();
  store.proposals.push({
    id: PROPOSAL_ID,
    userId: USER_ID,
    profileRecordId: PROFILE_RECORD_ID,
    baseRegistryRecordId: REGISTRY_RECORD_ID,
    adaptationPlanRef: { id: "adaptation.A1-U01.de.standard", version: "1.0.0" },
    researchTaskRef: "research.participant",
    proposal: participantExtensionProposal(),
    proposalSha256: "d".repeat(64),
    status: "pending_review",
    reviewNote: null,
    reviewEvidenceStatus: null,
    reviewConfidence: null,
    promotedRegistryRecordId: null,
    createdAt: new Date(),
    reviewedAt: null,
  });
  const service = new LanguageKnowledgeService(store);

  await assert.rejects(
    () => service.reviewProposal(OTHER_USER_ID, PROPOSAL_ID, {
      action: "reject",
      note: "Must not see or mutate another user's proposal.",
    }),
    (error: unknown) => {
      assert.ok(error instanceof LanguageKnowledgeServiceError);
      assert.equal(error.code, "proposal_not_found");
      return true;
    },
  );
  assert.equal(store.proposals[0]?.status, "pending_review");
});

test("M11 service revalidates the full M6 candidate before proposal persistence", async () => {
  const store = new MemoryKnowledgeStore();
  const service = new LanguageKnowledgeService(store);
  const plan = initialGermanPlan();
  const candidate: AdaptationDecisionCandidate = {
    adaptationPlanRef: {
      id: plan.identity.adaptationPlanId,
      version: plan.version,
    },
    registryRef: {
      id: germanDecisionRegistryFixture.identity.registryId,
      version: germanDecisionRegistryFixture.version,
    },
    researchTaskRef: "research.literacy",
    disposition: "proposed",
    proposals: [
      {
        operation: "create",
        requirementRefs: ["AR01"],
        decision: provisionalWritingDecision(),
      },
    ],
  };
  candidate.proposals[0]!.requirementRefs = ["AR03"];

  await assert.rejects(
    () => service.persistDecisionCandidate({
      userId: USER_ID,
      profileRecordId: PROFILE_RECORD_ID,
      baseRegistryRecordId: REGISTRY_RECORD_ID,
      curriculum: a1U01CurriculumFixture,
      adaptationPlan: plan,
      candidate,
    }),
    (error: unknown) => {
      assert.ok(error instanceof LanguageKnowledgeServiceError);
      assert.equal(error.code, "invalid_decision_candidate");
      return true;
    },
  );
  assert.equal(store.proposals.length, 0);
});
