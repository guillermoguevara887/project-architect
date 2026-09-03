import { createHash } from "node:crypto";
import {
  validateAdaptationDecisionCandidate,
  type AdaptationDecisionCandidate,
} from "../ai/adaptation-decision-proposer.js";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import { languageDecisionRefKey } from "../decisions/language-decision-registry.js";
import {
  validateLanguageDecisionRegistry,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import { validateLanguageProfile, type LanguageProfile } from "../profile/language-profile.js";
import {
  languageKnowledgeStore,
  type DecisionProposalRecord,
  type DecisionProposalStatus,
  type KnowledgeProfileRecord,
  type KnowledgeRegistryRecord,
  type LanguageKnowledgeStore,
} from "./repository.js";
import {
  reviewDecisionProposal,
  validateDecisionProposalForReview,
  type DecisionReview,
} from "./promotion.js";

export type LanguageKnowledgeServiceErrorCode =
  | "invalid_profile"
  | "profile_not_found"
  | "invalid_registry"
  | "registry_not_found"
  | "knowledge_context_mismatch"
  | "invalid_decision_candidate"
  | "proposal_not_found"
  | "proposal_already_reviewed"
  | "promotion_invalid"
  | "persistence_failed";

export class LanguageKnowledgeServiceError extends Error {
  constructor(
    readonly code: LanguageKnowledgeServiceErrorCode,
    readonly detail?: string,
  ) {
    super(detail ?? code);
    this.name = "LanguageKnowledgeServiceError";
  }
}

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function issueSummary(issues: Array<{ code: string; path: string; message: string }>) {
  return issues.slice(0, 8).map((issue) => `${issue.code}@${issue.path}: ${issue.message}`).join(" | ");
}

export class LanguageKnowledgeService {
  constructor(private readonly store: LanguageKnowledgeStore = languageKnowledgeStore) {}

  async registerProfile(userId: string, profile: LanguageProfile) {
    const validation = validateLanguageProfile(profile);
    if (!validation.valid) {
      throw new LanguageKnowledgeServiceError("invalid_profile", issueSummary(validation.issues));
    }
    return this.store.createProfile({ userId, profile, contentSha256: sha(profile) });
  }

  async registerRegistry(userId: string, profileRecordId: string, registry: LanguageDecisionRegistry) {
    const profile = await this.store.findProfile(userId, profileRecordId);
    if (!profile) throw new LanguageKnowledgeServiceError("profile_not_found");
    const validation = validateLanguageDecisionRegistry(registry, { languageProfile: profile.profile });
    if (!validation.valid) {
      throw new LanguageKnowledgeServiceError("invalid_registry", issueSummary(validation.issues));
    }
    const record = await this.store.createRegistry({
      userId,
      profileRecordId,
      registry,
      contentSha256: sha(registry),
    });
    if (!record) throw new LanguageKnowledgeServiceError("persistence_failed", "registry_not_persisted");
    return record;
  }

  async persistDecisionCandidate(input: {
    userId: string;
    profileRecordId: string;
    baseRegistryRecordId: string;
    curriculum: CurriculumUnitSpec;
    adaptationPlan: AdaptationPlan;
    candidate: AdaptationDecisionCandidate;
  }): Promise<DecisionProposalRecord[]> {
    const [profile, registry] = await Promise.all([
      this.store.findProfile(input.userId, input.profileRecordId),
      this.store.findRegistry(input.userId, input.baseRegistryRecordId),
    ]);
    if (!profile) throw new LanguageKnowledgeServiceError("profile_not_found");
    if (!registry) throw new LanguageKnowledgeServiceError("registry_not_found");
    if (registry.profileRecordId !== profile.id) {
      throw new LanguageKnowledgeServiceError("knowledge_context_mismatch", "registry_profile_binding_mismatch");
    }

    const candidateValidation = validateAdaptationDecisionCandidate(input.candidate, {
      curriculum: input.curriculum,
      languageProfile: profile.profile,
      registry: registry.registry,
      adaptationPlan: input.adaptationPlan,
      researchTaskRef: input.candidate.researchTaskRef,
    });
    if (!candidateValidation.valid) {
      throw new LanguageKnowledgeServiceError(
        "invalid_decision_candidate",
        issueSummary(candidateValidation.issues),
      );
    }
    if (input.candidate.disposition === "needs_upstream_research") return [];

    const records: DecisionProposalRecord[] = [];
    for (const proposal of input.candidate.proposals) {
      const validation = validateDecisionProposalForReview(proposal, registry.registry, profile.profile);
      if (!validation.valid) {
        throw new LanguageKnowledgeServiceError("invalid_decision_candidate", issueSummary(validation.issues));
      }
      const record = await this.store.createProposal({
        userId: input.userId,
        profileRecordId: profile.id,
        baseRegistryRecordId: registry.id,
        adaptationPlanRef: {
          id: input.adaptationPlan.identity.adaptationPlanId,
          version: input.adaptationPlan.version,
        },
        researchTaskRef: input.candidate.researchTaskRef,
        proposal,
        proposalSha256: sha(proposal),
      });
      if (!record) throw new LanguageKnowledgeServiceError("persistence_failed", "proposal_not_persisted");
      records.push(record);
    }
    return records;
  }

  listProfiles(userId: string, languageId?: string, varietyId?: string) {
    return this.store.listProfiles(userId, languageId, varietyId);
  }

  listRegistries(userId: string, languageId?: string, varietyId?: string) {
    return this.store.listRegistries(userId, languageId, varietyId);
  }

  listProposals(userId: string, status?: DecisionProposalStatus) {
    return this.store.listProposals(userId, status);
  }

  async getProposal(userId: string, proposalId: string) {
    const proposal = await this.store.findProposal(userId, proposalId);
    if (!proposal) throw new LanguageKnowledgeServiceError("proposal_not_found");
    return proposal;
  }

  async reviewProposal(userId: string, proposalId: string, review: DecisionReview) {
    const proposalRecord = await this.store.findProposal(userId, proposalId);
    if (!proposalRecord) throw new LanguageKnowledgeServiceError("proposal_not_found");
    if (proposalRecord.status !== "pending_review") {
      throw new LanguageKnowledgeServiceError("proposal_already_reviewed", proposalRecord.status);
    }

    const [profile, registry] = await Promise.all([
      this.store.findProfile(userId, proposalRecord.profileRecordId),
      this.store.findRegistry(userId, proposalRecord.baseRegistryRecordId),
    ]);
    if (!profile) throw new LanguageKnowledgeServiceError("profile_not_found");
    if (!registry) throw new LanguageKnowledgeServiceError("registry_not_found");
    if (registry.profileRecordId !== profile.id) {
      throw new LanguageKnowledgeServiceError("knowledge_context_mismatch");
    }

    const promoted = reviewDecisionProposal(
      proposalRecord.proposal,
      registry.registry,
      profile.profile,
      review,
    );
    if (!promoted.validation.valid || !promoted.result) {
      throw new LanguageKnowledgeServiceError(
        "promotion_invalid",
        issueSummary(promoted.validation.issues),
      );
    }

    if (promoted.result.outcome === "rejected") {
      const rejected = await this.store.rejectProposal({
        userId,
        proposalId,
        note: review.note.trim(),
      });
      if (!rejected) throw new LanguageKnowledgeServiceError("proposal_already_reviewed");
      return { proposal: rejected, promotedRegistry: null };
    }

    const decision = promoted.result.registry.decisions.find(
      (entry) =>
        languageDecisionRefKey({
          id: entry.identity.decisionId,
          version: entry.identity.decisionVersion,
        }) ===
        languageDecisionRefKey({
          id: proposalRecord.proposal.decision.identity.decisionId,
          version: proposalRecord.proposal.decision.identity.decisionVersion,
        }),
    );
    if (!decision || decision.identity.status !== "validated") {
      throw new LanguageKnowledgeServiceError("promotion_invalid", "promoted_decision_missing");
    }
    if (review.action !== "accept") {
      throw new LanguageKnowledgeServiceError("promotion_invalid", "review_outcome_mismatch");
    }

    const accepted = await this.store.acceptProposal({
      userId,
      proposalId,
      note: review.note.trim(),
      evidenceReviewStatus: review.evidenceReviewStatus,
      confidence: review.confidence,
      profileRecordId: profile.id,
      registry: promoted.result.registry,
      contentSha256: sha(promoted.result.registry),
    });
    if (!accepted) throw new LanguageKnowledgeServiceError("proposal_already_reviewed");
    return { proposal: accepted.proposal, promotedRegistry: accepted.registry };
  }
}

export const languageKnowledgeService = new LanguageKnowledgeService();

export type { KnowledgeProfileRecord, KnowledgeRegistryRecord };
