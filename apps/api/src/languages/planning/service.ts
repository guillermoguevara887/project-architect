import type { PlanningBundleRecord } from "../orchestration/repository.js";
import {
  curriculumOrchestrationService,
  type CurriculumOrchestrationService,
} from "../orchestration/service.js";
import {
  adaptedCurriculumPlanner,
  type AdaptedCurriculumPlanner,
  type AdaptedCurriculumPlannerInput,
  type AdaptedCurriculumPlannerResult,
} from "./adapted-curriculum-planner.js";

export type AdaptedCurriculumPlanningResult = {
  planning: AdaptedCurriculumPlannerResult;
  planningBundle: PlanningBundleRecord;
};

type TrustedBundleRegistrar = Pick<
  CurriculumOrchestrationService,
  "registerTrustedPlanningBundle"
>;

export class AdaptedCurriculumPlanningService {
  constructor(
    private readonly planner: AdaptedCurriculumPlanner,
    private readonly orchestration: TrustedBundleRegistrar,
  ) {}

  async planAndRegister(
    userId: string,
    curriculumUnitRecordId: string,
    input: AdaptedCurriculumPlannerInput,
  ): Promise<AdaptedCurriculumPlanningResult> {
    const planning = await this.planner.plan(input);
    const planningBundle = await this.orchestration.registerTrustedPlanningBundle(
      userId,
      curriculumUnitRecordId,
      planning.bundle,
    );
    return { planning, planningBundle };
  }
}

export const adaptedCurriculumPlanningService = new AdaptedCurriculumPlanningService(
  adaptedCurriculumPlanner,
  curriculumOrchestrationService,
);
