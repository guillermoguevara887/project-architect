import type { RealCurriculumDocumentWorkflow } from "../documents/real-document-workflow.js";
import {
  curriculumUnitReviewService,
  type CurriculumUnitReviewService,
} from "../documents/unit-review.js";
import {
  adaptedCurriculumPlanningService,
  type AdaptedCurriculumPlanningService,
} from "../planning/service.js";
import {
  profileResearchService,
  type ProfileResearchService,
} from "../profile-research/service.js";
import {
  adaptationResolutionStore,
  type AdaptationResolutionStore,
} from "../resolution/repository.js";
import {
  adaptationResolutionService,
  type AdaptationResolutionService,
} from "../resolution/service.js";
import {
  curriculumOrchestrationService,
  type CurriculumOrchestrationService,
} from "../orchestration/service.js";
import { realCurriculumDocumentWorkflow } from "../documents/real-document-workflow.js";

export type RealA1PilotInput = {
  userId: string;
  documentId: string;
  documentVersion: string;
  expectedUnitId: string;
  profileRecordId: string;
  registryRecordId: string;
  explanationLanguage: string;
  maxResearchCycles?: number;
};

export type RealA1PilotResult =
  | {
      status: "awaiting_curriculum_review";
      curriculumUnitRecordId: string;
      sourceSpecVersion: string;
    }
  | {
      status: "curriculum_rejected";
      curriculumUnitRecordId: string;
      reviewNote: string;
    }
  | {
      status: "awaiting_decision_review";
      curriculumUnitRecordId: string;
      resolutionRunId: string;
      proposalIds: string[];
    }
  | {
      status: "awaiting_manual_research";
      curriculumUnitRecordId: string;
      resolutionRunId: string;
      detail: string | null;
    }
  | {
      status: "completed";
      curriculumUnitRecordId: string;
      canonicalCurriculumVersion: string;
      resolutionRunId: string;
      planningBundleId: string;
      orchestrationRunId: string;
      generatedLessonCount: number;
    };

export class RealA1PilotError extends Error {
  constructor(
    readonly code:
      | "unit_not_found"
      | "unit_ambiguous"
      | "canonical_context_not_found"
      | "research_cycle_limit_exceeded",
    readonly detail?: string,
  ) {
    super(detail ?? code);
    this.name = "RealA1PilotError";
  }
}

type DocumentWorkflowPort = Pick<RealCurriculumDocumentWorkflow, "process">;
type CurriculumReviewPort = Pick<CurriculumUnitReviewService, "getReview">;
type ResolutionPort = Pick<AdaptationResolutionService, "start">;
type ProfileResearchPort = Pick<ProfileResearchService, "researchBlockedRun">;
type PlanningPort = Pick<AdaptedCurriculumPlanningService, "planAndRegister">;
type OrchestrationPort = Pick<CurriculumOrchestrationService, "generatePlanningBundle">;

export class RealA1PilotRunner {
  constructor(
    private readonly documents: DocumentWorkflowPort = realCurriculumDocumentWorkflow,
    private readonly curriculumReview: CurriculumReviewPort = curriculumUnitReviewService,
    private readonly resolution: ResolutionPort = adaptationResolutionService,
    private readonly resolutionStore: AdaptationResolutionStore = adaptationResolutionStore,
    private readonly profileResearch: ProfileResearchPort = profileResearchService,
    private readonly planning: PlanningPort = adaptedCurriculumPlanningService,
    private readonly orchestration: OrchestrationPort = curriculumOrchestrationService,
  ) {}

  async run(input: RealA1PilotInput): Promise<RealA1PilotResult> {
    const processed = await this.documents.process(
      input.userId,
      input.documentId,
      input.documentVersion,
    );
    const matchingUnits = processed.compilation.units.filter(
      (unit) => unit.unitId === input.expectedUnitId,
    );
    if (matchingUnits.length === 0) {
      throw new RealA1PilotError("unit_not_found", input.expectedUnitId);
    }
    if (matchingUnits.length > 1) {
      throw new RealA1PilotError("unit_ambiguous", input.expectedUnitId);
    }
    const unit = matchingUnits[0]!;

    const review = await this.curriculumReview.getReview(input.userId, unit.id);
    if (!review) {
      return {
        status: "awaiting_curriculum_review",
        curriculumUnitRecordId: unit.id,
        sourceSpecVersion: unit.specVersion,
      };
    }
    if (review.action === "rejected" || !review.promotedSpec) {
      return {
        status: "curriculum_rejected",
        curriculumUnitRecordId: unit.id,
        reviewNote: review.reviewNote,
      };
    }

    let resolutionRun = await this.resolution.start({
      userId: input.userId,
      curriculumUnitRecordId: unit.id,
      profileRecordId: input.profileRecordId,
      registryRecordId: input.registryRecordId,
    });

    const maxResearchCycles = input.maxResearchCycles ?? 8;
    let researchCycles = 0;
    while (
      resolutionRun.stage === "awaiting_profile_research" ||
      resolutionRun.stage === "awaiting_external_research"
    ) {
      if (researchCycles >= maxResearchCycles) {
        throw new RealA1PilotError(
          "research_cycle_limit_exceeded",
          resolutionRun.id,
        );
      }
      researchCycles += 1;
      const research = await this.profileResearch.researchBlockedRun({
        userId: input.userId,
        resolutionRunId: resolutionRun.id,
      });
      if (!research.resumedResolutionRun) {
        return {
          status: "awaiting_manual_research",
          curriculumUnitRecordId: unit.id,
          resolutionRunId: resolutionRun.id,
          detail: research.researchRun.detail,
        };
      }
      resolutionRun = research.resumedResolutionRun;
    }

    if (resolutionRun.stage === "awaiting_decision_review") {
      return {
        status: "awaiting_decision_review",
        curriculumUnitRecordId: unit.id,
        resolutionRunId: resolutionRun.id,
        proposalIds: [...resolutionRun.proposalIds],
      };
    }
    if (resolutionRun.stage !== "ready_for_planning") {
      return {
        status: "awaiting_manual_research",
        curriculumUnitRecordId: unit.id,
        resolutionRunId: resolutionRun.id,
        detail: resolutionRun.detail,
      };
    }

    const context = await this.resolutionStore.loadContext({
      userId: input.userId,
      curriculumUnitRecordId: unit.id,
      profileRecordId: resolutionRun.profileRecordId,
      registryRecordId: resolutionRun.registryRecordId,
    });
    if (!context) {
      throw new RealA1PilotError("canonical_context_not_found", resolutionRun.id);
    }

    const planned = await this.planning.planAndRegister(
      input.userId,
      unit.id,
      {
        curriculum: context.curriculum,
        languageProfile: context.languageProfile,
        registry: context.registry,
        adaptationPlan: resolutionRun.adaptationPlan,
        explanationLanguage: input.explanationLanguage,
      },
    );
    const generated = await this.orchestration.generatePlanningBundle(
      input.userId,
      planned.planningBundle.id,
    );

    return {
      status: "completed",
      curriculumUnitRecordId: unit.id,
      canonicalCurriculumVersion: context.curriculum.specVersion,
      resolutionRunId: resolutionRun.id,
      planningBundleId: planned.planningBundle.id,
      orchestrationRunId: generated.id,
      generatedLessonCount: generated.generationRunIds.length,
    };
  }
}

export const realA1PilotRunner = new RealA1PilotRunner();
