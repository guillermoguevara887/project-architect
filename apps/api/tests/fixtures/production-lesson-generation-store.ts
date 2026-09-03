import type { LessonSpec } from "../../src/languages/lessons/lesson-spec.js";
import type {
  GeneratedLessonRecord,
  LessonGenerationRunRecord,
  LessonGenerationWithOutput,
  ProductionLessonGenerationStore,
} from "../../src/languages/generation/repository.js";

function uuidFor(counter: number) {
  return `00000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`;
}

export class InMemoryProductionLessonGenerationStore
  implements ProductionLessonGenerationStore
{
  runs: LessonGenerationRunRecord[] = [];
  lessons: GeneratedLessonRecord[] = [];
  private nextId = 1;

  async begin(input: {
    userId: string;
    lessonSpec: LessonSpec;
    generatorKey: string;
    provider: string;
    model: string | null;
  }) {
    const now = new Date();
    const lesson = structuredClone(input.lessonSpec);
    const run: LessonGenerationRunRecord = {
      id: uuidFor(this.nextId++),
      userId: input.userId,
      lessonSpecId: lesson.identity.lessonSpecId,
      lessonSpecVersion: lesson.version,
      languageId: lesson.identity.languageId,
      varietyId: lesson.identity.varietyId,
      levelId: lesson.identity.levelId,
      unitId: lesson.identity.unitId,
      routeNodeRef: lesson.identity.routeNodeRef,
      generationIntent: lesson.generationIntent,
      lessonSpec: lesson,
      generatorKey: input.generatorKey,
      provider: input.provider,
      model: input.model,
      status: "running",
      attempts: null,
      validationHistory: null,
      errorCode: null,
      startedAt: now,
      completedAt: null,
    };
    this.runs.push(run);
    return structuredClone(run);
  }

  async complete(input: Parameters<ProductionLessonGenerationStore["complete"]>[0]) {
    const run = this.runs.find(
      (candidate) =>
        candidate.id === input.runId &&
        candidate.userId === input.userId &&
        candidate.status === "running",
    );
    if (!run) return null;

    run.status = "ready";
    run.attempts = input.candidate.attempts;
    run.validationHistory = structuredClone(input.candidate.validationHistory);
    run.completedAt = new Date();

    const lesson: GeneratedLessonRecord = {
      id: input.generatedLesson.identity.generatedLessonId,
      generationRunId: run.id,
      generatedLesson: structuredClone(input.generatedLesson),
      contentSha256: input.contentSha256,
      createdAt: new Date(),
    };
    this.lessons.push(lesson);
    return {
      run: structuredClone(run),
      lesson: structuredClone(lesson),
    } satisfies LessonGenerationWithOutput;
  }

  async fail(input: Parameters<ProductionLessonGenerationStore["fail"]>[0]) {
    const run = this.runs.find(
      (candidate) =>
        candidate.id === input.runId &&
        candidate.userId === input.userId &&
        candidate.status === "running",
    );
    if (!run) return null;
    run.status = "failed";
    run.errorCode = input.errorCode;
    run.validationHistory = structuredClone(input.validationHistory);
    run.completedAt = new Date();
    return structuredClone(run);
  }

  async findForUser(userId: string, runId: string) {
    const run = this.runs.find(
      (candidate) => candidate.id === runId && candidate.userId === userId,
    );
    if (!run) return null;
    const lesson =
      this.lessons.find((candidate) => candidate.generationRunId === run.id) ??
      null;
    return {
      run: structuredClone(run),
      lesson: lesson ? structuredClone(lesson) : null,
    };
  }
}
