import OpenAI from "openai";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import { validateAdaptationPlan } from "../adaptation/adaptation-plan.js";
import {
  adaptedUnitSpecSchema,
  validateAdaptedUnitSpec,
  type AdaptedUnitSpec,
} from "../adapted/adapted-unit-spec.js";
import { validateAdaptedCurriculumRuntime } from "../adapted/adapted-curriculum-runtime.js";
import {
  StructuredCandidateBoundaryError,
  compactValidationFeedback,
  runStructuredCandidateBoundary,
  type CandidateValidationAttempt,
} from "../ai/structured-candidate-boundary.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import { validateCurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import {
  validationIssue,
  validationResult,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";
import {
  languageDecisionRefKey,
  validateLanguageDecisionRegistry,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import {
  validateLessonSpecForGeneration,
} from "../generation/generated-lesson.js";
import {
  lessonSpecSchema,
  validateLessonSpec,
  type LessonSpec,
} from "../lessons/lesson-spec.js";
import type { TrustedPlanningBundlePayload } from "../orchestration/repository.js";
import {
  lessonRouteSchema,
  validateLessonRoute,
  type LessonRoute,
} from "../routing/lesson-route.js";
import {
  validateLanguageProfile,
  type LanguageProfile,
} from "../profile/language-profile.js";

export type AdaptedCurriculumPlannerInput = {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  registry: LanguageDecisionRegistry;
  adaptationPlan: AdaptationPlan;
  explanationLanguage: string;
};

export type PlanningStage = "adapted_unit" | "lesson_route" | "lesson_spec";

export type PlanningStageRecord = {
  stage: PlanningStage;
  artifactRef: string;
  attempts: number;
  validationHistory: CandidateValidationAttempt[];
};

export type AdaptedCurriculumPlannerResult = {
  bundle: TrustedPlanningBundlePayload;
  stageHistory: PlanningStageRecord[];
};

type ParsedPlannerResponse = {
  status?: string;
  output_parsed?: unknown;
  output_text?: string;
  output?: unknown;
};

type PlannerRequester = (request: {
  stage: PlanningStage;
  model: string;
  instructions: string;
  input: string;
  store: false;
  text: { format: { type: "json_object" } };
}) => Promise<ParsedPlannerResponse>;

const BASE_AUTHORITY = `
Eres un planificador interno del compilador pedagógico de MemoOS.
Trabajas solamente con contratos ya validados que aparecen en la entrada.
No investigues Internet y no uses conocimiento lingüístico externo o memoria implícita.
No elimines competencias, no inventes hechos lingüísticos y no proyectes categorías de otra lengua.
Los IDs y versiones upstream son autoridad; conserva trazabilidad exacta.
El output es sólo un CANDIDATO: status debe ser review y todos los audits deben quedar not_run.
Nunca marques un artefacto canonical ni un audit pass; MemoOS hará eso después de validarlo.
Devuelve exclusivamente JSON válido, sin Markdown.
`.trim();

const ADAPTED_UNIT_INSTRUCTIONS = `${BASE_AUTHORITY}

Construye un AdaptedUnitSpec candidato a partir de CurriculumUnitSpec + LanguageProfile + Registry + AdaptationPlan READY.
Cada capability curricular debe quedar representada y cada paso requerido debe conservarse, fusionarse o transformarse explícitamente.
Toda realización específica de la lengua debe citar decisiones validated del Registry.
recognitionRange debe contener productiveCore; deferredScope nunca puede ser productivo.
La complejidad lingüística puede cambiar scaffolding/granularidad, nunca borrar la misión curricular.`;

const ROUTE_INSTRUCTIONS = `${BASE_AUTHORITY}

Construye un LessonRoute candidato desde el AdaptedUnitSpec ya validado.
Distribuye sólo capabilities, realizations, patterns y pasos autorizados upstream.
Cada adapted step debe aparecer en al menos un nodo no opcional.
Respeta dependencias, reciclaje, carga y assessment; el nodo terminal no introduce nueva estructura central.`;

const LESSON_INSTRUCTIONS = `${BASE_AUTHORITY}

Construye UN LessonSpec candidato para el route node indicado.
Debe cubrir exactamente las capabilities, realizations y production targets del nodo.
No introduzcas patterns o realizations ausentes del AdaptedUnitSpec.
Sólo puedes reciclar LessonSpecs anteriores incluidos en la entrada; nunca el actual ni futuros.
Mantén como máximo un nuevo patrón central productivo y respeta el supportLevel del nodo.
Si el nodo recoge evidencia, incluye assessment evidence; si tiene productionTargets, incluye práctica productiva requerida.
Usa targetLanguage desde LanguageProfile y explanationLanguage exactamente como se proporciona.`;

function parseProviderCandidate(response: ParsedPlannerResponse) {
  if (response.status && response.status !== "completed") {
    throw new StructuredCandidateBoundaryError("incomplete_response");
  }
  if (response.output_parsed != null) return response.output_parsed;
  const outputText = response.output_text?.trim();
  if (!outputText) throw new StructuredCandidateBoundaryError("empty_response");
  try {
    return JSON.parse(outputText) as unknown;
  } catch {
    return outputText;
  }
}

function sameSet(left: string[], right: string[]) {
  return [...new Set(left)].sort().join("|") === [...new Set(right)].sort().join("|");
}

function append(target: ValidationIssue[], prefix: string, result: ValidationResult) {
  target.push(
    ...result.issues.map((issue) => ({
      ...issue,
      path: issue.path ? `${prefix}.${issue.path}` : prefix,
    })),
  );
}

function auditsAreNotRun(value: Record<string, { status: string }>) {
  return Object.values(value).every((audit) => audit.status === "not_run");
}

function passAudits<T extends Record<string, { status: string; findings: string[] }>>(value: T): T {
  return Object.fromEntries(
    Object.keys(value).map((key) => [key, { status: "pass", findings: [] }]),
  ) as T;
}

function inputValidation(input: AdaptedCurriculumPlannerInput) {
  const issues: ValidationIssue[] = [];
  append(issues, "curriculum", validateCurriculumUnitSpec(input.curriculum));
  append(issues, "languageProfile", validateLanguageProfile(input.languageProfile));
  append(
    issues,
    "registry",
    validateLanguageDecisionRegistry(input.registry, { languageProfile: input.languageProfile }),
  );
  append(
    issues,
    "adaptationPlan",
    validateAdaptationPlan(input.adaptationPlan, {
      curriculum: input.curriculum,
      languageProfile: input.languageProfile,
      registry: input.registry,
    }),
  );

  if (
    input.adaptationPlan.status !== "ready" ||
    input.adaptationPlan.readiness.state !== "ready" ||
    input.adaptationPlan.gapAnalysis.length > 0 ||
    !input.adaptationPlan.outputs.routeReady
  ) {
    issues.push(
      validationIssue(
        "PLANNER_UPSTREAM_NOT_READY",
        "adaptationPlan",
        "M10 requires a gap-free, audited AdaptationPlan with readiness=ready and routeReady=true.",
      ),
    );
  }

  if (input.explanationLanguage.trim().length === 0) {
    issues.push(
      validationIssue(
        "EXPLANATION_LANGUAGE_REQUIRED",
        "explanationLanguage",
        "Planner requires an explicit explanation language.",
      ),
    );
  }

  const decisions = new Map(
    input.registry.decisions.map((decision) => [
      languageDecisionRefKey({
        id: decision.identity.decisionId,
        version: decision.identity.decisionVersion,
      }),
      decision,
    ] as const),
  );
  input.adaptationPlan.requirementResolution.forEach((resolution, index) => {
    if (resolution.resolutionMode === "not_applicable") return;
    if (!resolution.decisionRef) {
      issues.push(
        validationIssue(
          "READY_REQUIREMENT_WITHOUT_DECISION",
          `adaptationPlan.requirementResolution.${index}`,
          `Ready requirement ${resolution.requirementRef} must be pinned to a validated decision.`,
        ),
      );
      return;
    }
    const decision = decisions.get(languageDecisionRefKey(resolution.decisionRef));
    if (!decision || decision.identity.status !== "validated") {
      issues.push(
        validationIssue(
          "PLANNER_DECISION_NOT_VALIDATED",
          `adaptationPlan.requirementResolution.${index}.decisionRef`,
          `M10 cannot plan from an unvalidated decision ${languageDecisionRefKey(resolution.decisionRef)}.`,
        ),
      );
    }
  });

  return validationResult(issues);
}

function validateAdaptedCandidate(candidate: AdaptedUnitSpec, input: AdaptedCurriculumPlannerInput) {
  const issues: ValidationIssue[] = [];
  append(
    issues,
    "candidate",
    validateAdaptedUnitSpec(candidate, {
      curriculum: input.curriculum,
      languageProfile: input.languageProfile,
      registry: input.registry,
      adaptationPlan: input.adaptationPlan,
    }),
  );
  if (candidate.status !== "review") {
    issues.push(validationIssue("AI_PLANNER_ARTIFACT_NOT_REVIEW", "status", "Planner candidates must remain review-only."));
  }
  if (!auditsAreNotRun(candidate.validation)) {
    issues.push(validationIssue("AI_PLANNER_SELF_APPROVED_AUDIT", "validation", "Planner candidates cannot mark audits pass or fail."));
  }

  const capabilityRefs = candidate.capabilityRealizations.map((entry) => entry.capabilityRef);
  const expectedCapabilities = input.curriculum.competencies.map((entry) => entry.competencyId);
  if (!sameSet(capabilityRefs, expectedCapabilities)) {
    issues.push(
      validationIssue(
        "ADAPTED_CAPABILITY_SET_MISMATCH",
        "capabilityRealizations",
        "AdaptedUnitSpec must represent the complete curriculum competency set.",
      ),
    );
  }

  const coveredSourceSteps = new Set(
    candidate.adaptedLearningRoute.flatMap((step) => step.sourceStepRefs),
  );
  for (const step of input.curriculum.learningRoute.steps.filter((entry) => entry.required)) {
    if (!coveredSourceSteps.has(step.stepId)) {
      issues.push(
        validationIssue(
          "REQUIRED_CURRICULUM_STEP_DROPPED",
          "adaptedLearningRoute",
          `Required source step ${step.stepId} disappeared during adaptation.`,
          { relatedRefs: [step.stepId] },
        ),
      );
    }
  }

  const decisionByKey = new Map(
    input.registry.decisions.map((decision) => [
      languageDecisionRefKey({ id: decision.identity.decisionId, version: decision.identity.decisionVersion }),
      decision,
    ] as const),
  );
  candidate.languageRealizations.forEach((realization, index) => {
    realization.decisionRefs.forEach((ref, refIndex) => {
      const decision = decisionByKey.get(languageDecisionRefKey(ref));
      if (!decision || decision.identity.status !== "validated") {
        issues.push(
          validationIssue(
            "ADAPTED_REALIZATION_USES_UNVALIDATED_DECISION",
            `languageRealizations.${index}.decisionRefs.${refIndex}`,
            `Realization uses decision ${languageDecisionRefKey(ref)} that is not validated.`,
          ),
        );
      }
    });
  });

  return validationResult(issues);
}

function sealAdaptedUnit(candidate: AdaptedUnitSpec, input: AdaptedCurriculumPlannerInput) {
  const sealed: AdaptedUnitSpec = {
    ...structuredClone(candidate),
    status: "canonical",
    validation: passAudits(candidate.validation),
  };
  const validation = validateAdaptedUnitSpec(sealed, {
    curriculum: input.curriculum,
    languageProfile: input.languageProfile,
    registry: input.registry,
    adaptationPlan: input.adaptationPlan,
  });
  if (!validation.valid) {
    throw new StructuredCandidateBoundaryError("invalid_candidate", [
      { attempt: 0, outcome: "invalid_candidate", issues: validation.issues },
    ]);
  }
  return sealed;
}

function validateRouteCandidate(candidate: LessonRoute, adaptedUnit: AdaptedUnitSpec) {
  const issues: ValidationIssue[] = [];
  append(issues, "candidate", validateLessonRoute(candidate, { adaptedUnit }));
  if (candidate.status !== "review") {
    issues.push(validationIssue("AI_PLANNER_ARTIFACT_NOT_REVIEW", "status", "Planner candidates must remain review-only."));
  }
  if (!auditsAreNotRun(candidate.validation)) {
    issues.push(validationIssue("AI_PLANNER_SELF_APPROVED_AUDIT", "validation", "Planner candidates cannot mark audits pass or fail."));
  }
  const nonOptionalStepRefs = new Set(
    candidate.nodes.filter((node) => !node.optional).flatMap((node) => node.sourceAdaptedStepRefs),
  );
  for (const step of adaptedUnit.adaptedLearningRoute) {
    if (!nonOptionalStepRefs.has(step.adaptedStepId)) {
      issues.push(
        validationIssue(
          "ADAPTED_STEP_WITHOUT_REQUIRED_ROUTE_NODE",
          "nodes",
          `Adapted step ${step.adaptedStepId} must appear in a non-optional route node.`,
          { relatedRefs: [step.adaptedStepId] },
        ),
      );
    }
  }
  return validationResult(issues);
}

function sealRoute(candidate: LessonRoute, adaptedUnit: AdaptedUnitSpec) {
  const sealed: LessonRoute = {
    ...structuredClone(candidate),
    status: "canonical",
    validation: passAudits(candidate.validation),
  };
  const validation = validateLessonRoute(sealed, { adaptedUnit });
  if (!validation.valid) {
    throw new StructuredCandidateBoundaryError("invalid_candidate", [
      { attempt: 0, outcome: "invalid_candidate", issues: validation.issues },
    ]);
  }
  return sealed;
}

function validateLessonCandidate(
  candidate: LessonSpec,
  route: LessonRoute,
  adaptedUnit: AdaptedUnitSpec,
  routeNodeRef: string,
  previousLessons: LessonSpec[],
) {
  const issues: ValidationIssue[] = [];
  append(issues, "candidate", validateLessonSpec(candidate, { route, adaptedUnit }));
  if (candidate.status !== "review") {
    issues.push(validationIssue("AI_PLANNER_ARTIFACT_NOT_REVIEW", "status", "Planner candidates must remain review-only."));
  }
  if (!auditsAreNotRun(candidate.validation)) {
    issues.push(validationIssue("AI_PLANNER_SELF_APPROVED_AUDIT", "validation", "Planner candidates cannot mark audits pass or fail."));
  }
  const node = route.nodes.find((entry) => entry.nodeId === routeNodeRef);
  if (!node || candidate.identity.routeNodeRef !== routeNodeRef) {
    issues.push(validationIssue("LESSON_PLANNER_NODE_MISMATCH", "identity.routeNodeRef", "Lesson candidate does not target the requested route node."));
    return validationResult(issues);
  }
  if (candidate.identity.lessonOrderHint !== node.orderHint) {
    issues.push(validationIssue("LESSON_ORDER_MISMATCH", "identity.lessonOrderHint", "Lesson order must match route node orderHint."));
  }
  if (!sameSet(candidate.curriculumBinding.capabilityRefs, node.capabilityRefs)) {
    issues.push(validationIssue("LESSON_NODE_CAPABILITY_COVERAGE_MISMATCH", "curriculumBinding.capabilityRefs", "Lesson must cover the route node capability set exactly."));
  }
  if (!sameSet(candidate.curriculumBinding.realizationRefs, node.realizationRefs)) {
    issues.push(validationIssue("LESSON_NODE_REALIZATION_COVERAGE_MISMATCH", "curriculumBinding.realizationRefs", "Lesson must cover the route node realization set exactly."));
  }
  if (!sameSet(candidate.productiveTargets.productionTargetRefs, node.productionTargets.map((target) => target.productionTargetId))) {
    issues.push(validationIssue("LESSON_NODE_PRODUCTION_TARGET_MISMATCH", "productiveTargets.productionTargetRefs", "Lesson productionTargetRefs must exactly match the route node."));
  }
  if (node.productionTargets.length > 0 && !candidate.practicePlan.some((practice) => practice.required)) {
    issues.push(validationIssue("PRODUCTIVE_NODE_WITHOUT_REQUIRED_PRACTICE", "practicePlan", "A node with production targets needs required practice."));
  }
  if (node.assessmentRole !== "none" && candidate.assessmentPlan.evidenceItems.length === 0) {
    issues.push(validationIssue("ASSESSMENT_NODE_WITHOUT_EVIDENCE", "assessmentPlan.evidenceItems", "An assessment-bearing node needs evidence items."));
  }
  if (candidate.contentArchitecture.blocks.length < 3) {
    issues.push(validationIssue("LESSON_ARCHITECTURE_TOO_THIN", "contentArchitecture.blocks", "Canonical planning requires at least three purposeful content blocks."));
  }
  if (node.primaryRole === "assessment" && !candidate.contentArchitecture.blocks.some((block) => block.blockType === "assessment")) {
    issues.push(validationIssue("ASSESSMENT_NODE_WITHOUT_ASSESSMENT_BLOCK", "contentArchitecture.blocks", "Assessment nodes need an assessment block."));
  }
  if (node.primaryRole === "literacy" && !candidate.contentArchitecture.blocks.some((block) => block.blockType === "literacy")) {
    issues.push(validationIssue("LITERACY_NODE_WITHOUT_LITERACY_BLOCK", "contentArchitecture.blocks", "Literacy nodes need a literacy block."));
  }

  const previousIds = new Set(previousLessons.map((lesson) => lesson.identity.lessonSpecId));
  candidate.languageInventory.recycledLexicon.forEach((item, index) => {
    if (!previousIds.has(item.sourceLessonRef)) {
      issues.push(
        validationIssue(
          "INVALID_RECYCLING_SOURCE_LESSON",
          `languageInventory.recycledLexicon.${index}.sourceLessonRef`,
          `Recycled lexicon may reference only previously planned lessons; ${item.sourceLessonRef} is not available.`,
        ),
      );
    }
  });
  return validationResult(issues);
}

function sealLesson(candidate: LessonSpec, route: LessonRoute, adaptedUnit: AdaptedUnitSpec) {
  const sealed: LessonSpec = {
    ...structuredClone(candidate),
    status: "canonical",
    validation: passAudits(candidate.validation),
  };
  const validation = validateLessonSpecForGeneration(sealed);
  const contextual = validateLessonSpec(sealed, { route, adaptedUnit });
  const issues = [...validation.issues, ...contextual.issues];
  if (issues.some((issue) => issue.severity === "error")) {
    throw new StructuredCandidateBoundaryError("invalid_candidate", [
      { attempt: 0, outcome: "invalid_candidate", issues },
    ]);
  }
  return sealed;
}

function buildInput(parts: Array<[string, unknown]>, previousIssues: ValidationIssue[]) {
  const feedback = compactValidationFeedback(previousIssues);
  return [
    ...parts.flatMap(([label, value]) => [`${label}:`, JSON.stringify(value)]),
    feedback.length > 0
      ? `ERRORES DEL INTENTO ANTERIOR:\n${feedback.join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
}

export interface AdaptedCurriculumPlanner {
  plan(input: AdaptedCurriculumPlannerInput): Promise<AdaptedCurriculumPlannerResult>;
}

export class OpenAIAdaptedCurriculumPlanner implements AdaptedCurriculumPlanner {
  constructor(
    private readonly requester?: PlannerRequester,
    private readonly configuredModel?: string,
    private readonly maxAttempts = 2,
  ) {}

  async plan(input: AdaptedCurriculumPlannerInput): Promise<AdaptedCurriculumPlannerResult> {
    const initial = inputValidation(input);
    if (!initial.valid) {
      throw new StructuredCandidateBoundaryError("invalid_input", [
        { attempt: 0, outcome: "invalid_candidate", issues: initial.issues },
      ]);
    }

    const stageHistory: PlanningStageRecord[] = [];
    const adaptedCandidate = await runStructuredCandidateBoundary({
      schema: adaptedUnitSpecSchema,
      maxAttempts: this.maxAttempts,
      semanticValidator: (candidate) => validateAdaptedCandidate(candidate, input),
      generate: ({ previousIssues }) => this.generate(
        "adapted_unit",
        ADAPTED_UNIT_INSTRUCTIONS,
        buildInput([
          ["CURRICULUM", input.curriculum],
          ["LANGUAGE_PROFILE", input.languageProfile],
          ["VALIDATED_REGISTRY", input.registry],
          ["READY_ADAPTATION_PLAN", input.adaptationPlan],
        ], previousIssues),
      ),
    });
    stageHistory.push({
      stage: "adapted_unit",
      artifactRef: adaptedCandidate.value.identity.adaptedUnitId,
      attempts: adaptedCandidate.attempts,
      validationHistory: adaptedCandidate.validationHistory,
    });
    const adaptedUnit = sealAdaptedUnit(adaptedCandidate.value, input);

    const routeCandidate = await runStructuredCandidateBoundary({
      schema: lessonRouteSchema,
      maxAttempts: this.maxAttempts,
      semanticValidator: (candidate) => validateRouteCandidate(candidate, adaptedUnit),
      generate: ({ previousIssues }) => this.generate(
        "lesson_route",
        ROUTE_INSTRUCTIONS,
        buildInput([["ADAPTED_UNIT", adaptedUnit]], previousIssues),
      ),
    });
    stageHistory.push({
      stage: "lesson_route",
      artifactRef: routeCandidate.value.identity.routeId,
      attempts: routeCandidate.attempts,
      validationHistory: routeCandidate.validationHistory,
    });
    const route = sealRoute(routeCandidate.value, adaptedUnit);

    const lessons: LessonSpec[] = [];
    for (const node of [...route.nodes].sort((left, right) => left.orderHint - right.orderHint)) {
      const lessonCandidate = await runStructuredCandidateBoundary({
        schema: lessonSpecSchema,
        maxAttempts: this.maxAttempts,
        semanticValidator: (candidate) =>
          validateLessonCandidate(candidate, route, adaptedUnit, node.nodeId, lessons),
        generate: ({ previousIssues }) => this.generate(
          "lesson_spec",
          LESSON_INSTRUCTIONS,
          buildInput([
            ["TARGET_LANGUAGE", input.languageProfile.identity.languageName],
            ["EXPLANATION_LANGUAGE", input.explanationLanguage],
            ["ADAPTED_UNIT", adaptedUnit],
            ["LESSON_ROUTE", route],
            ["TARGET_NODE", node],
            ["PREVIOUS_LESSON_SPECS", lessons],
          ], previousIssues),
        ),
      });
      stageHistory.push({
        stage: "lesson_spec",
        artifactRef: lessonCandidate.value.identity.lessonSpecId,
        attempts: lessonCandidate.attempts,
        validationHistory: lessonCandidate.validationHistory,
      });
      lessons.push(sealLesson(lessonCandidate.value, route, adaptedUnit));
    }

    const runtime = validateAdaptedCurriculumRuntime({
      adaptedUnit,
      route,
      lessonSpecs: lessons,
      upstream: {
        curriculum: input.curriculum,
        languageProfile: input.languageProfile,
        registry: input.registry,
        adaptationPlan: input.adaptationPlan,
      },
      requireCompleteLessonSet: true,
    });
    const generationIssues = lessons.flatMap((lesson, index) =>
      validateLessonSpecForGeneration(lesson).issues.map((issue) => ({
        ...issue,
        path: issue.path ? `lessonSpecs.${index}.${issue.path}` : `lessonSpecs.${index}`,
      })),
    );
    if (!runtime.valid || generationIssues.some((issue) => issue.severity === "error")) {
      throw new StructuredCandidateBoundaryError("invalid_candidate", [
        {
          attempt: 0,
          outcome: "invalid_candidate",
          issues: [...runtime.issues, ...generationIssues],
        },
      ]);
    }

    return {
      bundle: {
        curriculum: structuredClone(input.curriculum),
        languageProfile: structuredClone(input.languageProfile),
        registry: structuredClone(input.registry),
        adaptationPlan: structuredClone(input.adaptationPlan),
        adaptedUnit,
        route,
        lessonSpecs: lessons,
      },
      stageHistory,
    };
  }

  private async generate(stage: PlanningStage, instructions: string, input: string) {
    try {
      const response = await this.request(stage, instructions, input);
      return parseProviderCandidate(response);
    } catch (error) {
      if (error instanceof StructuredCandidateBoundaryError) throw error;
      throw new StructuredCandidateBoundaryError("provider_error");
    }
  }

  private async request(stage: PlanningStage, instructions: string, input: string) {
    const model =
      this.configuredModel ??
      process.env.OPENAI_LANGUAGE_PLANNING_MODEL ??
      process.env.OPENAI_LANGUAGE_MODEL;
    if (!model) throw new StructuredCandidateBoundaryError("not_configured");

    const request = {
      stage,
      model,
      instructions,
      input,
      store: false as const,
      text: { format: { type: "json_object" as const } },
    };
    if (this.requester) return this.requester(request);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new StructuredCandidateBoundaryError("not_configured");
    const client = new OpenAI({ apiKey });
    const { stage: _stage, ...providerRequest } = request;
    return client.responses.create(providerRequest);
  }
}

export const adaptedCurriculumPlanner = new OpenAIAdaptedCurriculumPlanner();
