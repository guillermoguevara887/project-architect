import { createHash } from "node:crypto";
import type { ValidationIssue } from "../curriculum/validation.js";
import {
  validateLessonSpecForGeneration,
} from "../generation/generated-lesson.js";
import {
  ProductionLessonGenerationServiceError,
  productionLessonGenerationService,
  type ProductionLessonGenerationService,
} from "../generation/service.js";
import {
  curriculumOrchestrationStore,
  type CurriculumOrchestrationRunRecord,
  type CurriculumOrchestrationStore,
  type PlanningBundleRecord,
  type TrustedPlanningBundlePayload,
} from "./repository.js";
import { evaluateLanguageOrchestration } from "./orchestration-runtime.js";

export type CurriculumOrchestrationServiceErrorCode =
  | "invalid_planning_bundle"
  | "source_unit_not_found"
  | "planning_bundle_not_found"
  | "orchestration_failed"
  | "orchestration_not_found";

export class CurriculumOrchestrationServiceError extends Error {
  constructor(
    readonly code: CurriculumOrchestrationServiceErrorCode,
    readonly detail?: string,
    readonly issues: ValidationIssue[] = [],
    readonly orchestrationRunId?: string,
  ) {
    super(`Curriculum orchestration failed: ${code}`);
    this.name = "CurriculumOrchestrationServiceError";
  }
}

type LessonGenerationPort = Pick<ProductionLessonGenerationService, "generate">;

function contentSha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export class CurriculumOrchestrationService {
  constructor(
    private readonly store: CurriculumOrchestrationStore,
    private readonly lessonGeneration: LessonGenerationPort,
  ) {}

  async registerTrustedPlanningBundle(
    userId: string,
    curriculumUnitRecordId: string,
    payload: TrustedPlanningBundlePayload,
  ): Promise<PlanningBundleRecord> {
    const orchestration = evaluateLanguageOrchestration(payload);
    const generationIssues = payload.lessonSpecs.flatMap((lesson, index) =>
      validateLessonSpecForGeneration(lesson).issues.map((issue) => ({
        ...issue,
        path: issue.path ? `lessonSpecs.${index}.${issue.path}` : `lessonSpecs.${index}`,
      })),
    );
    const issues = [...orchestration.validation.issues, ...generationIssues];

    if (
      orchestration.stage !== "ready_for_generation" ||
      issues.some((issue) => issue.severity === "error")
    ) {
      throw new CurriculumOrchestrationServiceError(
        "invalid_planning_bundle",
        orchestration.stage,
        issues,
      );
    }

    const record = await this.store.createPlanningBundle({
      userId,
      curriculumUnitRecordId,
      payload,
      contentSha256: contentSha256(payload),
    });
    if (!record) {
      throw new CurriculumOrchestrationServiceError("source_unit_not_found");
    }
    return record;
  }

  async generatePlanningBundle(
    userId: string,
    planningBundleId: string,
  ): Promise<CurriculumOrchestrationRunRecord> {
    const bundle = await this.store.findPlanningBundleForUser(
      userId,
      planningBundleId,
    );
    if (!bundle) {
      throw new CurriculumOrchestrationServiceError("planning_bundle_not_found");
    }

    const lessons = [...bundle.payload.lessonSpecs].sort(
      (left, right) =>
        left.identity.lessonOrderHint - right.identity.lessonOrderHint,
    );
    const run = await this.store.beginRun({
      userId,
      planningBundleId,
      expectedLessonCount: lessons.length,
    });
    if (!run) {
      throw new CurriculumOrchestrationServiceError("planning_bundle_not_found");
    }

    try {
      for (const lesson of lessons) {
        const generated = await this.lessonGeneration.generate(userId, lesson);
        const appended = await this.store.appendGenerationRun({
          userId,
          runId: run.id,
          generationRunId: generated.run.id,
        });
        if (!appended) {
          throw new CurriculumOrchestrationServiceError(
            "orchestration_failed",
            "generation_run_link_failed",
            [],
            run.id,
          );
        }
      }

      const completed = await this.store.completeRun(userId, run.id);
      if (!completed) {
        throw new CurriculumOrchestrationServiceError(
          "orchestration_failed",
          "completion_invariant_failed",
          [],
          run.id,
        );
      }
      return completed;
    } catch (error) {
      const detail =
        error instanceof ProductionLessonGenerationServiceError
          ? error.detail ?? error.code
          : error instanceof CurriculumOrchestrationServiceError
            ? error.detail ?? error.code
            : "unexpected_orchestration_error";
      await this.store.failRun({
        userId,
        runId: run.id,
        errorCode: detail,
      });
      if (error instanceof CurriculumOrchestrationServiceError) throw error;
      throw new CurriculumOrchestrationServiceError(
        "orchestration_failed",
        detail,
        [],
        run.id,
      );
    }
  }

  async getRun(userId: string, runId: string) {
    const run = await this.store.findRunForUser(userId, runId);
    if (!run) {
      throw new CurriculumOrchestrationServiceError("orchestration_not_found");
    }
    return run;
  }
}

export const curriculumOrchestrationService = new CurriculumOrchestrationService(
  curriculumOrchestrationStore,
  productionLessonGenerationService,
);
