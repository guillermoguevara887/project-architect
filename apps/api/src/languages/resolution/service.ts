import { createHash } from "node:crypto";
import {
  OpenAIAdaptationDecisionProposer,
  StructuredCandidateBoundaryError,
  type AdaptationDecisionCandidate,
  type AdaptationDecisionProposer,
} from "../ai/adaptation-decision-proposer.js";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import {
  languageKnowledgeService,
  type LanguageKnowledgeService,
} from "../knowledge/service.js";
import {
  compileVersionedAdaptationPlan,
  finalizeResolvedAdaptationPlan,
  selectAdaptationResolutionAction,
} from "./adaptation-resolution-runtime.js";
import {
  adaptationResolutionStore,
  type AdaptationResolutionContext,
  type AdaptationResolutionRunRecord,
  type AdaptationResolutionStore,
} from "./repository.js";

export type AdaptationResolutionServiceErrorCode =
  | "context_not_found"
  | "adaptation_compilation_failed"
  | "decision_proposal_failed"
  | "decision_review_pending"
  | "resume_requires_updated_knowledge"
  | "proposal_not_found"
  | "persistence_failed"
  | "resolution_run_not_found";

export class AdaptationResolutionServiceError extends Error {
  constructor(
    readonly code: AdaptationResolutionServiceErrorCode,
    readonly detail?: string,
    readonly resolutionRunId?: string,
  ) {
    super(detail ?? code);
    this.name = "AdaptationResolutionServiceError";
  }
}

type ProposalRecord = {
  id: string;
  status: "pending_review" | "accepted" | "rejected";
  promotedRegistryRecordId: string | null;
};

type KnowledgePort = Pick<
  LanguageKnowledgeService,
  "persistDecisionCandidate"
> & {
  getProposal(userId: string, proposalId: string): Promise<ProposalRecord>;
};

function sha(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function errorDetail(error: unknown) {
  if (error instanceof StructuredCandidateBoundaryError) return error.code;
  if (error instanceof Error) return error.message;
  return "unknown_error";
}

export class AdaptationResolutionService {
  constructor(
    private readonly store: AdaptationResolutionStore = adaptationResolutionStore,
    private readonly proposer: AdaptationDecisionProposer =
      new OpenAIAdaptationDecisionProposer(),
    private readonly knowledge: KnowledgePort = languageKnowledgeService,
  ) {}

  async start(input: {
    userId: string;
    curriculumUnitRecordId: string;
    profileRecordId: string;
    registryRecordId: string;
  }) {
    const context = await this.store.loadContext(input);
    if (!context) {
      throw new AdaptationResolutionServiceError("context_not_found");
    }
    return this.evaluate(input.userId, context, null);
  }

  async resume(input: {
    userId: string;
    runId: string;
    profileRecordId?: string;
    registryRecordId?: string;
  }) {
    const previous = await this.store.findRunForUser(input.userId, input.runId);
    if (!previous) {
      throw new AdaptationResolutionServiceError("resolution_run_not_found");
    }
    if (previous.stage === "ready_for_planning") return previous;

    let profileRecordId = input.profileRecordId ?? previous.profileRecordId;
    let registryRecordId = input.registryRecordId ?? previous.registryRecordId;

    if (previous.stage === "awaiting_decision_review") {
      const proposalId = previous.proposalIds[0];
      if (!proposalId) {
        throw new AdaptationResolutionServiceError(
          "proposal_not_found",
          "resolution_run_has_no_proposal",
          previous.id,
        );
      }
      const proposal = await this.knowledge.getProposal(input.userId, proposalId);
      if (proposal.status === "pending_review") {
        throw new AdaptationResolutionServiceError(
          "decision_review_pending",
          proposalId,
          previous.id,
        );
      }
      if (proposal.status === "rejected") {
        const context = await this.store.loadContext({
          userId: input.userId,
          curriculumUnitRecordId: previous.curriculumUnitRecordId,
          profileRecordId,
          registryRecordId,
        });
        if (!context) throw new AdaptationResolutionServiceError("context_not_found");
        return this.persistRun({
          userId: input.userId,
          context,
          previousRunId: previous.id,
          stage: "awaiting_upstream_research",
          adaptationPlan: previous.adaptationPlan,
          detail: `proposal_rejected:${proposalId}`,
        });
      }
      if (!proposal.promotedRegistryRecordId) {
        throw new AdaptationResolutionServiceError(
          "proposal_not_found",
          "accepted_proposal_missing_promoted_registry",
          previous.id,
        );
      }
      registryRecordId = proposal.promotedRegistryRecordId;
    } else if (
      profileRecordId === previous.profileRecordId &&
      registryRecordId === previous.registryRecordId
    ) {
      throw new AdaptationResolutionServiceError(
        "resume_requires_updated_knowledge",
        previous.stage,
        previous.id,
      );
    }

    const context = await this.store.loadContext({
      userId: input.userId,
      curriculumUnitRecordId: previous.curriculumUnitRecordId,
      profileRecordId,
      registryRecordId,
    });
    if (!context) {
      throw new AdaptationResolutionServiceError("context_not_found");
    }
    return this.evaluate(input.userId, context, previous.id);
  }

  getRun(userId: string, runId: string) {
    return this.store.findRunForUser(userId, runId);
  }

  private async evaluate(
    userId: string,
    context: AdaptationResolutionContext,
    previousRunId: string | null,
  ): Promise<AdaptationResolutionRunRecord> {
    let plan: AdaptationPlan;
    try {
      plan = compileVersionedAdaptationPlan({
        curriculum: context.curriculum,
        languageProfile: context.languageProfile,
        registry: context.registry,
      });
    } catch (error) {
      throw new AdaptationResolutionServiceError(
        "adaptation_compilation_failed",
        errorDetail(error),
      );
    }

    const action = selectAdaptationResolutionAction(plan);
    if (action.stage === "ready_for_planning") {
      let ready: AdaptationPlan;
      try {
        ready = finalizeResolvedAdaptationPlan({
          curriculum: context.curriculum,
          languageProfile: context.languageProfile,
          registry: context.registry,
          plan,
        });
      } catch (error) {
        throw new AdaptationResolutionServiceError(
          "adaptation_compilation_failed",
          errorDetail(error),
        );
      }
      return this.persistRun({
        userId,
        context,
        previousRunId,
        stage: "ready_for_planning",
        adaptationPlan: ready,
      });
    }

    if (action.stage === "awaiting_external_research") {
      return this.persistRun({
        userId,
        context,
        previousRunId,
        stage: action.stage,
        adaptationPlan: plan,
        blockedResearchTaskRefs: action.researchTaskRefs,
        detail: "external_research_required",
      });
    }

    if (action.stage === "awaiting_profile_research") {
      return this.persistRun({
        userId,
        context,
        previousRunId,
        stage: action.stage,
        adaptationPlan: plan,
        blockedResearchTaskRefs: action.researchTaskRefs,
        detail: "language_profile_update_required",
      });
    }

    let candidate: AdaptationDecisionCandidate;
    try {
      const proposed = await this.proposer.propose({
        curriculum: context.curriculum,
        languageProfile: context.languageProfile,
        registry: context.registry,
        adaptationPlan: plan,
        researchTaskRef: action.researchTaskRef,
      });
      candidate = proposed.value;
    } catch (error) {
      const failed = await this.persistRun({
        userId,
        context,
        previousRunId,
        stage: "failed",
        adaptationPlan: plan,
        activeResearchTaskRef: action.researchTaskRef,
        detail: `decision_proposer_failed:${errorDetail(error)}`,
      });
      throw new AdaptationResolutionServiceError(
        "decision_proposal_failed",
        errorDetail(error),
        failed.id,
      );
    }

    if (candidate.disposition === "needs_upstream_research") {
      return this.persistRun({
        userId,
        context,
        previousRunId,
        stage: "awaiting_upstream_research",
        adaptationPlan: plan,
        activeResearchTaskRef: action.researchTaskRef,
        detail: candidate.blockingReason ?? "decision_proposer_requested_upstream_research",
      });
    }

    if (candidate.proposals.length !== 1) {
      return this.persistRun({
        userId,
        context,
        previousRunId,
        stage: "awaiting_upstream_research",
        adaptationPlan: plan,
        activeResearchTaskRef: action.researchTaskRef,
        detail: `serial_review_required:${candidate.proposals.length}_proposals`,
      });
    }

    let records: Array<{ id: string }>;
    try {
      records = await this.knowledge.persistDecisionCandidate({
        userId,
        profileRecordId: context.profileRecordId,
        baseRegistryRecordId: context.registryRecordId,
        curriculum: context.curriculum,
        adaptationPlan: plan,
        candidate,
      });
    } catch (error) {
      const failed = await this.persistRun({
        userId,
        context,
        previousRunId,
        stage: "failed",
        adaptationPlan: plan,
        activeResearchTaskRef: action.researchTaskRef,
        detail: `proposal_persistence_failed:${errorDetail(error)}`,
      });
      throw new AdaptationResolutionServiceError(
        "decision_proposal_failed",
        errorDetail(error),
        failed.id,
      );
    }
    if (records.length !== 1 || !records[0]) {
      throw new AdaptationResolutionServiceError(
        "persistence_failed",
        "expected_exactly_one_persisted_proposal",
      );
    }

    return this.persistRun({
      userId,
      context,
      previousRunId,
      stage: "awaiting_decision_review",
      adaptationPlan: plan,
      activeResearchTaskRef: action.researchTaskRef,
      proposalIds: [records[0].id],
      detail: "M11 review required before Registry promotion.",
    });
  }

  private async persistRun(input: {
    userId: string;
    context: AdaptationResolutionContext;
    previousRunId: string | null;
    stage: AdaptationResolutionRunRecord["stage"];
    adaptationPlan: AdaptationPlan;
    activeResearchTaskRef?: string | null;
    blockedResearchTaskRefs?: string[];
    proposalIds?: string[];
    detail?: string | null;
  }) {
    const payload = {
      curriculumUnitRecordId: input.context.curriculumUnitRecordId,
      profileRecordId: input.context.profileRecordId,
      registryRecordId: input.context.registryRecordId,
      previousRunId: input.previousRunId,
      stage: input.stage,
      adaptationPlan: input.adaptationPlan,
      activeResearchTaskRef: input.activeResearchTaskRef ?? null,
      blockedResearchTaskRefs: input.blockedResearchTaskRefs ?? [],
      proposalIds: input.proposalIds ?? [],
      detail: input.detail ?? null,
    };
    const record = await this.store.createRun({
      userId: input.userId,
      context: input.context,
      previousRunId: input.previousRunId,
      stage: input.stage,
      adaptationPlan: input.adaptationPlan,
      activeResearchTaskRef: input.activeResearchTaskRef,
      blockedResearchTaskRefs: input.blockedResearchTaskRefs,
      proposalIds: input.proposalIds,
      detail: input.detail,
      contentSha256: sha(payload),
    });
    if (!record) {
      throw new AdaptationResolutionServiceError("persistence_failed");
    }
    return record;
  }
}

export const adaptationResolutionService = new AdaptationResolutionService();

export type { CurriculumUnitSpec };
