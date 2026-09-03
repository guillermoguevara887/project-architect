import { createHash, randomUUID } from "node:crypto";
import {
  StructuredCandidateBoundaryError,
  type CandidateValidationAttempt,
} from "../ai/structured-candidate-boundary.js";
import {
  lessonSpecSchema,
  type LessonSpec,
} from "../lessons/lesson-spec.js";
import {
  generatedLessonSchema,
  validateLessonSpecForGeneration,
  type GeneratedLesson,
} from "./generated-lesson.js";
import {
  productionLessonGenerator,
  type ProductionLessonGenerator,
} from "./lesson-generator.js";
import {
  productionLessonGenerationStore,
  type LessonGenerationWithOutput,
  type ProductionLessonGenerationStore,
} from "./repository.js";

export const PRODUCTION_LESSON_GENERATOR_KEY = "lesson-spec-generation-v1";

export type ProductionLessonGeneratorDescriptor = {
  provider: string;
  model: string | null;
};

export type ProductionLessonGenerationServiceErrorCode =
  | "invalid_lesson_spec"
  | "generation_failed"
  | "not_found";

export class ProductionLessonGenerationServiceError extends Error {
  constructor(
    readonly code: ProductionLessonGenerationServiceErrorCode,
    readonly detail?: string,
    readonly validationHistory: CandidateValidationAttempt[] = [],
  ) {
    super(`Production lesson generation failed: ${code}`);
    this.name = "ProductionLessonGenerationServiceError";
  }
}

function contentSha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function defaultGeneratorDescriptor(): ProductionLessonGeneratorDescriptor {
  return {
    provider: "openai",
    model:
      process.env.OPENAI_LANGUAGE_GENERATION_MODEL ??
      process.env.OPENAI_LANGUAGE_MODEL ??
      null,
  };
}

function invalidLessonHistory(lesson: unknown): CandidateValidationAttempt[] {
  const result = validateLessonSpecForGeneration(lesson);
  return [
    {
      attempt: 0,
      outcome: "invalid_candidate",
      issues: result.issues,
    },
  ];
}

export class ProductionLessonGenerationService {
  constructor(
    private readonly store: ProductionLessonGenerationStore,
    private readonly generator: ProductionLessonGenerator,
    private readonly descriptor: ProductionLessonGeneratorDescriptor,
  ) {}

  async generate(
    userId: string,
    rawLessonSpec: unknown,
  ): Promise<LessonGenerationWithOutput> {
    const validation = validateLessonSpecForGeneration(rawLessonSpec);
    if (!validation.valid) {
      throw new ProductionLessonGenerationServiceError(
        "invalid_lesson_spec",
        "lesson_spec_validation_failed",
        invalidLessonHistory(rawLessonSpec),
      );
    }

    const lessonSpec = lessonSpecSchema.parse(rawLessonSpec);
    const run = await this.store.begin({
      userId,
      lessonSpec,
      generatorKey: PRODUCTION_LESSON_GENERATOR_KEY,
      provider: this.descriptor.provider,
      model: this.descriptor.model,
    });

    try {
      const candidate = await this.generator.generate(lessonSpec);
      const generatedLesson = this.sealGeneratedLesson(
        run.id,
        lessonSpec,
        candidate.value,
      );
      const completed = await this.store.complete({
        userId,
        runId: run.id,
        candidate,
        generatedLesson,
        contentSha256: contentSha256(generatedLesson),
      });
      if (!completed || !completed.lesson) {
        throw new ProductionLessonGenerationServiceError(
          "generation_failed",
          "persistence_failed",
        );
      }
      return completed;
    } catch (error) {
      const boundaryError =
        error instanceof StructuredCandidateBoundaryError ? error : null;
      const serviceError =
        error instanceof ProductionLessonGenerationServiceError ? error : null;
      const detail =
        boundaryError?.code ?? serviceError?.detail ?? "unexpected_generation_error";
      const validationHistory =
        boundaryError?.validationHistory ?? serviceError?.validationHistory ?? [];

      await this.store.fail({
        userId,
        runId: run.id,
        errorCode: detail,
        validationHistory,
      });

      if (serviceError) throw serviceError;
      throw new ProductionLessonGenerationServiceError(
        "generation_failed",
        detail,
        validationHistory,
      );
    }
  }

  async get(userId: string, runId: string) {
    const result = await this.store.findForUser(userId, runId);
    if (!result) {
      throw new ProductionLessonGenerationServiceError("not_found");
    }
    return result;
  }

  private sealGeneratedLesson(
    generationRunId: string,
    lessonSpec: LessonSpec,
    content: GeneratedLesson["content"],
  ): GeneratedLesson {
    return generatedLessonSchema.parse({
      identity: {
        generatedLessonId: randomUUID(),
        generationRunId,
        lessonSpecRef: {
          id: lessonSpec.identity.lessonSpecId,
          version: lessonSpec.version,
        },
        languageId: lessonSpec.identity.languageId,
        varietyId: lessonSpec.identity.varietyId,
        levelId: lessonSpec.identity.levelId,
        unitId: lessonSpec.identity.unitId,
        routeNodeRef: lessonSpec.identity.routeNodeRef,
      },
      content,
      version: "1.0.0",
      status: "accepted",
    });
  }
}

export const productionLessonGenerationService =
  new ProductionLessonGenerationService(
    productionLessonGenerationStore,
    productionLessonGenerator,
    defaultGeneratorDescriptor(),
  );
