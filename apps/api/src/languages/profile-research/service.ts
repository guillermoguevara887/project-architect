import { createHash } from "node:crypto";
import {
  StructuredCandidateBoundaryError,
  type CandidateValidationAttempt,
} from "../ai/structured-candidate-boundary.js";
import {
  languageKnowledgeService,
  type LanguageKnowledgeService,
} from "../knowledge/service.js";
import {
  adaptationResolutionStore,
  type AdaptationResolutionStore,
} from "../resolution/repository.js";
import {
  adaptationResolutionService,
  type AdaptationResolutionService,
} from "../resolution/service.js";
import { buildEnrichedLanguageProfile } from "./contracts.js";
import {
  languageProfileResearcher,
  type LanguageProfileResearcher,
} from "./researcher.js";
import {
  profileResearchStore,
  type ProfileResearchRunRecord,
  type ProfileResearchStore,
} from "./repository.js";

export type ProfileResearchServiceErrorCode =
  | "resolution_run_not_found"
  | "invalid_resolution_stage"
  | "research_tasks_missing"
  | "context_not_found"
  | "research_failed"
  | "profile_enrichment_failed"
  | "profile_persistence_failed"
  | "resume_failed"
  | "persistence_failed"
  | "research_run_not_found";

export class ProfileResearchServiceError extends Error {
  constructor(
    readonly code: ProfileResearchServiceErrorCode,
    readonly detail?: string,
    readonly researchRunId?: string,
  ) {
    super(detail ?? code);
    this.name = "ProfileResearchServiceError";
  }
}

type KnowledgePort = Pick<LanguageKnowledgeService, "registerProfile">;
type ResolutionPort = Pick<AdaptationResolutionService, "resume">;

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function errorDetail(error: unknown) {
  if (error instanceof StructuredCandidateBoundaryError) return error.code;
  if (error instanceof Error) return error.message;
  return "unknown_error";
}

function validationHistory(error: unknown): CandidateValidationAttempt[] {
  return error instanceof StructuredCandidateBoundaryError
    ? error.validationHistory
    : [];
}

export class ProfileResearchService {
  constructor(
    private readonly resolutionStore: AdaptationResolutionStore = adaptationResolutionStore,
    private readonly researcher: LanguageProfileResearcher = languageProfileResearcher,
    private readonly knowledge: KnowledgePort = languageKnowledgeService,
    private readonly resolution: ResolutionPort = adaptationResolutionService,
    private readonly store: ProfileResearchStore = profileResearchStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async researchBlockedRun(input: { userId: string; resolutionRunId: string }) {
    const resolutionRun = await this.resolutionStore.findRunForUser(
      input.userId,
      input.resolutionRunId,
    );
    if (!resolutionRun) {
      throw new ProfileResearchServiceError("resolution_run_not_found");
    }
    if (
      resolutionRun.stage !== "awaiting_profile_research" &&
      resolutionRun.stage !== "awaiting_external_research"
    ) {
      throw new ProfileResearchServiceError(
        "invalid_resolution_stage",
        resolutionRun.stage,
      );
    }
    const researchTaskRefs = [...new Set(resolutionRun.blockedResearchTaskRefs)].sort();
    if (researchTaskRefs.length === 0) {
      throw new ProfileResearchServiceError("research_tasks_missing");
    }

    const context = await this.resolutionStore.loadContext({
      userId: input.userId,
      curriculumUnitRecordId: resolutionRun.curriculumUnitRecordId,
      profileRecordId: resolutionRun.profileRecordId,
      registryRecordId: resolutionRun.registryRecordId,
    });
    if (!context) throw new ProfileResearchServiceError("context_not_found");

    let research;
    try {
      research = await this.researcher.research({
        curriculum: context.curriculum,
        languageProfile: context.languageProfile,
        adaptationPlan: resolutionRun.adaptationPlan,
        researchTaskRefs,
      });
    } catch (error) {
      const record = await this.persistRun({
        userId: input.userId,
        resolutionRunId: resolutionRun.id,
        baseProfileRecordId: context.profileRecordId,
        researchTaskRefs,
        stage: "failed",
        candidate: null,
        observedUrls: [],
        providerModel: null,
        validationHistory: validationHistory(error),
        detail: `research_failed:${errorDetail(error)}`,
      });
      throw new ProfileResearchServiceError(
        "research_failed",
        errorDetail(error),
        record.id,
      );
    }

    if (research.value.disposition === "needs_review") {
      const record = await this.persistRun({
        userId: input.userId,
        resolutionRunId: resolutionRun.id,
        baseProfileRecordId: context.profileRecordId,
        researchTaskRefs,
        stage: "needs_review",
        candidate: research.value,
        observedUrls: research.observedUrls,
        providerModel: research.providerModel,
        validationHistory: research.validationHistory,
        detail: research.value.blockingReason ?? "research_requires_review",
      });
      return { researchRun: record, enrichedProfile: null, resumedResolutionRun: null };
    }

    let enrichedProfile;
    try {
      enrichedProfile = buildEnrichedLanguageProfile({
        baseProfile: context.languageProfile,
        candidate: research.value,
        accessedAt: this.now().toISOString(),
      });
    } catch (error) {
      const record = await this.persistRun({
        userId: input.userId,
        resolutionRunId: resolutionRun.id,
        baseProfileRecordId: context.profileRecordId,
        researchTaskRefs,
        stage: "failed",
        candidate: research.value,
        observedUrls: research.observedUrls,
        providerModel: research.providerModel,
        validationHistory: research.validationHistory,
        detail: `profile_enrichment_failed:${errorDetail(error)}`,
      });
      throw new ProfileResearchServiceError(
        "profile_enrichment_failed",
        errorDetail(error),
        record.id,
      );
    }

    const profileRecord = await this.knowledge.registerProfile(
      input.userId,
      enrichedProfile,
    );
    if (!profileRecord) {
      const record = await this.persistRun({
        userId: input.userId,
        resolutionRunId: resolutionRun.id,
        baseProfileRecordId: context.profileRecordId,
        researchTaskRefs,
        stage: "failed",
        candidate: research.value,
        observedUrls: research.observedUrls,
        providerModel: research.providerModel,
        validationHistory: research.validationHistory,
        detail: "profile_persistence_failed",
      });
      throw new ProfileResearchServiceError(
        "profile_persistence_failed",
        undefined,
        record.id,
      );
    }

    let resumedResolutionRun;
    try {
      resumedResolutionRun = await this.resolution.resume({
        userId: input.userId,
        runId: resolutionRun.id,
        profileRecordId: profileRecord.id,
      });
    } catch (error) {
      const record = await this.persistRun({
        userId: input.userId,
        resolutionRunId: resolutionRun.id,
        baseProfileRecordId: context.profileRecordId,
        enrichedProfileRecordId: profileRecord.id,
        researchTaskRefs,
        stage: "completed",
        candidate: research.value,
        observedUrls: research.observedUrls,
        providerModel: research.providerModel,
        validationHistory: research.validationHistory,
        detail: `profile_enriched_resume_failed:${errorDetail(error)}`,
      });
      throw new ProfileResearchServiceError("resume_failed", errorDetail(error), record.id);
    }

    const record = await this.persistRun({
      userId: input.userId,
      resolutionRunId: resolutionRun.id,
      resumedResolutionRunId: resumedResolutionRun.id,
      baseProfileRecordId: context.profileRecordId,
      enrichedProfileRecordId: profileRecord.id,
      researchTaskRefs,
      stage: "completed",
      candidate: research.value,
      observedUrls: research.observedUrls,
      providerModel: research.providerModel,
      validationHistory: research.validationHistory,
      detail: "profile_enriched_and_resolution_resumed",
    });

    return {
      researchRun: record,
      enrichedProfile: profileRecord,
      resumedResolutionRun,
    };
  }

  async getRun(userId: string, researchRunId: string) {
    const run = await this.store.findRunForUser(userId, researchRunId);
    if (!run) throw new ProfileResearchServiceError("research_run_not_found");
    return run;
  }

  private async persistRun(input: {
    userId: string;
    resolutionRunId: string;
    resumedResolutionRunId?: string | null;
    baseProfileRecordId: string;
    enrichedProfileRecordId?: string | null;
    researchTaskRefs: string[];
    stage: ProfileResearchRunRecord["stage"];
    candidate: ProfileResearchRunRecord["candidate"];
    observedUrls: string[];
    providerModel: string | null;
    validationHistory: CandidateValidationAttempt[];
    detail: string | null;
  }) {
    const payload = {
      adaptationResolutionRunId: input.resolutionRunId,
      resumedResolutionRunId: input.resumedResolutionRunId ?? null,
      baseProfileRecordId: input.baseProfileRecordId,
      enrichedProfileRecordId: input.enrichedProfileRecordId ?? null,
      stage: input.stage,
      researchTaskRefs: input.researchTaskRefs,
      candidate: input.candidate,
      observedUrls: input.observedUrls,
      providerModel: input.providerModel,
      validationHistory: input.validationHistory,
      detail: input.detail,
    };
    const record = await this.store.createRun({
      id: undefined as never,
      createdAt: undefined as never,
      userId: input.userId,
      adaptationResolutionRunId: input.resolutionRunId,
      resumedResolutionRunId: input.resumedResolutionRunId ?? null,
      baseProfileRecordId: input.baseProfileRecordId,
      enrichedProfileRecordId: input.enrichedProfileRecordId ?? null,
      stage: input.stage,
      researchTaskRefs: input.researchTaskRefs,
      candidate: input.candidate,
      observedUrls: input.observedUrls,
      providerModel: input.providerModel,
      validationHistory: input.validationHistory,
      detail: input.detail,
      contentSha256: sha(payload),
    });
    if (!record) throw new ProfileResearchServiceError("persistence_failed");
    return record;
  }
}

export const profileResearchService = new ProfileResearchService();
