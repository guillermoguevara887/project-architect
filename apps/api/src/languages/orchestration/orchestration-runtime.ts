import {
  compileInitialAdaptationPlan,
  validateAdaptationPlan,
  type AdaptationPlan,
} from "../adaptation/adaptation-plan.js";
import {
  validateAdaptedCurriculumRuntime,
} from "../adapted/adapted-curriculum-runtime.js";
import type { AdaptedUnitSpec } from "../adapted/adapted-unit-spec.js";
import {
  validateCurriculumUnitSpec,
  type CurriculumUnitSpec,
} from "../curriculum/curriculum-unit-spec.js";
import {
  validationIssue,
  validationResult,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";
import {
  validateLanguageDecisionRegistry,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import type { LessonSpec } from "../lessons/lesson-spec.js";
import {
  validateLanguageProfile,
  type LanguageProfile,
} from "../profile/language-profile.js";
import type { LessonRoute } from "../routing/lesson-route.js";

export type LanguageOrchestrationStage =
  | "blocked_invalid_input"
  | "awaiting_external_research"
  | "awaiting_profile_update"
  | "awaiting_registry_reasoning"
  | "awaiting_decision_review"
  | "awaiting_adaptation_finalization"
  | "awaiting_adapted_curriculum"
  | "ready_for_generation";

export type LanguageOrchestrationNextAction =
  | "fix_input_contracts"
  | "research_language_facts"
  | "update_language_profile"
  | "propose_registry_decisions"
  | "review_provisional_decisions"
  | "finalize_adaptation_plan"
  | "produce_adapted_curriculum"
  | "generate_lessons";

export type LanguageOrchestrationInput = {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  registry: LanguageDecisionRegistry;
  adaptationPlan?: AdaptationPlan;
  adaptedUnit?: AdaptedUnitSpec;
  route?: LessonRoute;
  lessonSpecs?: LessonSpec[];
};

export type LanguageOrchestrationSnapshot = {
  stage: LanguageOrchestrationStage;
  nextAction: LanguageOrchestrationNextAction;
  adaptationPlan: AdaptationPlan | null;
  validation: ValidationResult;
  researchTaskRefs: string[];
  blockingGapRefs: string[];
  readyLessonSpecRefs: Array<{ id: string; version: string }>;
};

function appendIssues(
  target: ValidationIssue[],
  result: ValidationResult,
  prefix: string,
) {
  target.push(
    ...result.issues.map((issue) => ({
      ...issue,
      path: issue.path ? `${prefix}.${issue.path}` : prefix,
    })),
  );
}

function snapshot(input: {
  stage: LanguageOrchestrationStage;
  nextAction: LanguageOrchestrationNextAction;
  adaptationPlan: AdaptationPlan | null;
  issues?: ValidationIssue[];
  researchTaskRefs?: string[];
  blockingGapRefs?: string[];
  lessonSpecs?: LessonSpec[];
}): LanguageOrchestrationSnapshot {
  return {
    stage: input.stage,
    nextAction: input.nextAction,
    adaptationPlan: input.adaptationPlan,
    validation: validationResult(input.issues ?? []),
    researchTaskRefs: input.researchTaskRefs ?? [],
    blockingGapRefs: input.blockingGapRefs ?? [],
    readyLessonSpecRefs: (input.lessonSpecs ?? []).map((lesson) => ({
      id: lesson.identity.lessonSpecId,
      version: lesson.version,
    })),
  };
}

function hasDownstreamArtifacts(input: LanguageOrchestrationInput) {
  return Boolean(input.adaptedUnit || input.route || input.lessonSpecs?.length);
}

function researchStage(plan: AdaptationPlan) {
  const tasks = plan.researchPlan;
  if (tasks.some((task) => task.researchNecessity === "external_research")) {
    return {
      stage: "awaiting_external_research" as const,
      nextAction: "research_language_facts" as const,
      refs: tasks
        .filter((task) => task.researchNecessity === "external_research")
        .map((task) => task.researchTaskId),
    };
  }
  if (tasks.some((task) => task.researchNecessity === "profile_only")) {
    return {
      stage: "awaiting_profile_update" as const,
      nextAction: "update_language_profile" as const,
      refs: tasks
        .filter((task) => task.researchNecessity === "profile_only")
        .map((task) => task.researchTaskId),
    };
  }
  if (tasks.some((task) => task.researchNecessity === "registry_reasoning")) {
    return {
      stage: "awaiting_registry_reasoning" as const,
      nextAction: "propose_registry_decisions" as const,
      refs: tasks
        .filter((task) => task.researchNecessity === "registry_reasoning")
        .map((task) => task.researchTaskId),
    };
  }
  return null;
}

export function evaluateLanguageOrchestration(
  input: LanguageOrchestrationInput,
): LanguageOrchestrationSnapshot {
  const inputIssues: ValidationIssue[] = [];
  appendIssues(inputIssues, validateCurriculumUnitSpec(input.curriculum), "curriculum");
  appendIssues(inputIssues, validateLanguageProfile(input.languageProfile), "languageProfile");
  appendIssues(
    inputIssues,
    validateLanguageDecisionRegistry(input.registry, {
      languageProfile: input.languageProfile,
    }),
    "registry",
  );

  if (inputIssues.some((issue) => issue.severity === "error")) {
    return snapshot({
      stage: "blocked_invalid_input",
      nextAction: "fix_input_contracts",
      adaptationPlan: null,
      issues: inputIssues,
    });
  }

  let plan: AdaptationPlan | null = input.adaptationPlan ?? null;
  if (plan) {
    const validation = validateAdaptationPlan(plan, {
      curriculum: input.curriculum,
      languageProfile: input.languageProfile,
      registry: input.registry,
    });
    if (!validation.valid) {
      return snapshot({
        stage: "blocked_invalid_input",
        nextAction: "fix_input_contracts",
        adaptationPlan: plan,
        issues: validation.issues,
      });
    }
  } else {
    const compiled = compileInitialAdaptationPlan({
      curriculum: input.curriculum,
      languageProfile: input.languageProfile,
      registry: input.registry,
    });
    if (!compiled.plan || !compiled.validation.valid) {
      return snapshot({
        stage: "blocked_invalid_input",
        nextAction: "fix_input_contracts",
        adaptationPlan: null,
        issues: compiled.validation.issues,
      });
    }
    plan = compiled.plan;
  }

  if (plan.gapAnalysis.length > 0) {
    const issues: ValidationIssue[] = [];
    if (hasDownstreamArtifacts(input)) {
      issues.push(
        validationIssue(
          "DOWNSTREAM_ARTIFACTS_BEFORE_ADAPTATION_READY",
          "adaptedUnit",
          "Adapted curriculum artifacts cannot become authoritative while the AdaptationPlan still has open gaps.",
          { relatedRefs: plan.readiness.blockingGapRefs },
        ),
      );
    }
    const research = researchStage(plan);
    if (research) {
      return snapshot({
        stage: research.stage,
        nextAction: research.nextAction,
        adaptationPlan: plan,
        issues,
        researchTaskRefs: research.refs,
        blockingGapRefs: plan.readiness.blockingGapRefs,
      });
    }
    return snapshot({
      stage: "awaiting_decision_review",
      nextAction: "review_provisional_decisions",
      adaptationPlan: plan,
      issues,
      blockingGapRefs: plan.readiness.blockingGapRefs,
    });
  }

  if (
    plan.readiness.state !== "ready" ||
    plan.status !== "ready" ||
    !plan.outputs.routeReady
  ) {
    return snapshot({
      stage: "awaiting_adaptation_finalization",
      nextAction: "finalize_adaptation_plan",
      adaptationPlan: plan,
    });
  }

  if (!input.adaptedUnit || !input.route || !input.lessonSpecs) {
    return snapshot({
      stage: "awaiting_adapted_curriculum",
      nextAction: "produce_adapted_curriculum",
      adaptationPlan: plan,
    });
  }

  const runtimeValidation = validateAdaptedCurriculumRuntime({
    adaptedUnit: input.adaptedUnit,
    route: input.route,
    lessonSpecs: input.lessonSpecs,
    requireCompleteLessonSet: true,
    upstream: {
      curriculum: input.curriculum,
      languageProfile: input.languageProfile,
      registry: input.registry,
      adaptationPlan: plan,
    },
  });
  if (!runtimeValidation.valid) {
    return snapshot({
      stage: "blocked_invalid_input",
      nextAction: "fix_input_contracts",
      adaptationPlan: plan,
      issues: runtimeValidation.issues,
    });
  }

  return snapshot({
    stage: "ready_for_generation",
    nextAction: "generate_lessons",
    adaptationPlan: plan,
    lessonSpecs: input.lessonSpecs,
  });
}
