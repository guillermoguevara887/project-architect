import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  validateAdaptationPlan,
  type AdaptationPlan,
} from "../adaptation/adaptation-plan.js";
import {
  validateCurriculumUnitSpec,
  type CurriculumUnitSpec,
} from "../curriculum/curriculum-unit-spec.js";
import {
  domainIdSchema,
  requiredTextSchema,
  versionedRefSchema,
} from "../curriculum/primitives.js";
import {
  validationIssue,
  validationResult,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";
import {
  languageDecisionSchema,
  validateLanguageDecisionRegistry,
  type LanguageDecision,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import {
  validateLanguageProfile,
  type LanguageProfile,
} from "../profile/language-profile.js";
import {
  compactValidationFeedback,
  runStructuredCandidateBoundary,
  StructuredCandidateBoundaryError,
  type ValidatedCandidate,
} from "./structured-candidate-boundary.js";

const DECISION_PROPOSAL_INSTRUCTIONS = `
Eres el resolvedor pedagógico de gaps lingüísticos de MemoOS.

Recibes contratos ya validados: CurriculumUnitSpec, LanguageProfile,
LanguageDecisionRegistry y un AdaptationPlan. Tu trabajo es proponer decisiones
pedagógicas para UNA researchTask cuya researchNecessity sea registry_reasoning.

Reglas de autoridad:
- Usa EXCLUSIVAMENTE hechos, mechanisms y claims presentes en LanguageProfile y
  decisiones ya presentes en LanguageDecisionRegistry.
- No uses memoria lingüística externa, Internet ni conocimiento no citado por los
  contratos recibidos.
- Si la evidencia estructurada no basta, devuelve disposition="needs_upstream_research"
  con proposals=[] y explica el bloqueo. No rellenes huecos.
- No cambies ni elimines competencias curriculares.
- No conviertas una categoría de la lengua fuente en objetivo universal.
- recognitionRange debe contener todo productiveRange.
- deferredScope nunca puede ser productivo.
- Toda decisión propuesta debe tener status="provisional",
  evidence.reviewStatus="machine_synthesized" y externalEvidenceRefs=[].
- Para decisiones nuevas usa operation="create".
- Para ampliar una decisión existente usa operation="extend" y baseDecisionRef,
  conserva el mismo decisionId y crea una versión semánticamente posterior. No
  marques lifecycle.supersedes todavía: la promoción/versionado definitivo ocurre
  después de revisión.
- El scope debe respetar exactamente decisionScope del AdaptationRequirement.
- La compatibilidad debe usar exactamente languageId, varietyId y curriculumId de
  los contratos recibidos.
- Puedes resolver varios requirements de la misma researchTask con una sola
  decisión sólo si realmente comparten el mismo problema y alcance.
- La IA nunca puede declarar una decisión validated.
- Devuelve sólo la estructura solicitada, sin Markdown ni comentarios externos.
`.trim();

const proposalSchema = z
  .object({
    operation: z.enum(["create", "extend"]),
    requirementRefs: z.array(domainIdSchema).min(1),
    baseDecisionRef: versionedRefSchema.optional(),
    decision: languageDecisionSchema,
  })
  .strict();

export const adaptationDecisionCandidateSchema = z
  .object({
    adaptationPlanRef: versionedRefSchema,
    registryRef: versionedRefSchema,
    researchTaskRef: domainIdSchema,
    disposition: z.enum(["proposed", "needs_upstream_research"]),
    blockingReason: requiredTextSchema.optional(),
    proposals: z.array(proposalSchema).max(16),
  })
  .strict();

export type AdaptationDecisionCandidate = z.infer<
  typeof adaptationDecisionCandidateSchema
>;

export type AdaptationDecisionProposalInput = {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  registry: LanguageDecisionRegistry;
  adaptationPlan: AdaptationPlan;
  researchTaskRef: string;
};

function parseSemver(version: string): [number, number, number] {
  const core = version.split(/[+-]/u, 1)[0] ?? version;
  const [major = "0", minor = "0", patch = "0"] = core.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function compareSemver(left: string, right: string) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function sameRef(
  left: { id: string; version: string },
  right: { id: string; version: string },
) {
  return left.id === right.id && left.version === right.version;
}

function decisionRef(decision: LanguageDecision) {
  return {
    id: decision.identity.decisionId,
    version: decision.identity.decisionVersion,
  };
}

function buildTemporaryRegistry(
  registry: LanguageDecisionRegistry,
  decisions: LanguageDecision[],
): LanguageDecisionRegistry {
  const combined = [...structuredClone(registry.decisions), ...structuredClone(decisions)];
  return {
    ...structuredClone(registry),
    decisions: combined,
    dependencyGraph: {
      nodes: combined.map(decisionRef),
      edges: combined.flatMap((decision) => {
        const from = decisionRef(decision);
        return [
          ...decision.dependencies.requiresDecisionRefs.map((to) => ({
            from,
            to,
            relation: "requires" as const,
          })),
          ...decision.dependencies.benefitsFromDecisionRefs.map((to) => ({
            from,
            to,
            relation: "benefits_from" as const,
          })),
        ];
      }),
    },
    status: "review",
  };
}

function validateInput(input: AdaptationDecisionProposalInput) {
  const issues: ValidationIssue[] = [];
  const append = (prefix: string, result: ValidationResult) => {
    issues.push(
      ...result.issues.map((issue) => ({
        ...issue,
        path: issue.path ? `${prefix}.${issue.path}` : prefix,
      })),
    );
  };

  append("curriculum", validateCurriculumUnitSpec(input.curriculum));
  append("languageProfile", validateLanguageProfile(input.languageProfile));
  append(
    "registry",
    validateLanguageDecisionRegistry(input.registry, {
      languageProfile: input.languageProfile,
    }),
  );
  append(
    "adaptationPlan",
    validateAdaptationPlan(input.adaptationPlan, {
      curriculum: input.curriculum,
      languageProfile: input.languageProfile,
      registry: input.registry,
    }),
  );

  const task = input.adaptationPlan.researchPlan.find(
    (candidate) => candidate.researchTaskId === input.researchTaskRef,
  );
  if (!task) {
    issues.push(
      validationIssue(
        "UNKNOWN_RESEARCH_TASK",
        "researchTaskRef",
        `Research task ${input.researchTaskRef} does not exist in AdaptationPlan.`,
      ),
    );
  } else if (task.researchNecessity !== "registry_reasoning") {
    issues.push(
      validationIssue(
        "RESEARCH_TASK_NOT_REGISTRY_REASONING",
        "researchTaskRef",
        `Research task ${input.researchTaskRef} requires ${task.researchNecessity}, not registry reasoning.`,
      ),
    );
  }

  if (task) {
    const gapById = new Map(
      input.adaptationPlan.gapAnalysis.map((gap) => [gap.gapId, gap] as const),
    );
    for (const gapRef of task.gapRefs) {
      const gap = gapById.get(gapRef);
      if (!gap) {
        issues.push(
          validationIssue(
            "RESEARCH_TASK_GAP_MISSING",
            "researchTaskRef",
            `Research task references missing gap ${gapRef}.`,
          ),
        );
      } else if (gap.researchNecessity !== "registry_reasoning") {
        issues.push(
          validationIssue(
            "GAP_NOT_REGISTRY_REASONING",
            "researchTaskRef",
            `Gap ${gapRef} requires ${gap.researchNecessity} and cannot enter this AI boundary.`,
          ),
        );
      }
    }
  }

  return validationResult(issues);
}

export function validateAdaptationDecisionCandidate(
  candidate: AdaptationDecisionCandidate,
  input: AdaptationDecisionProposalInput,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const plan = input.adaptationPlan;
  const task = plan.researchPlan.find(
    (entry) => entry.researchTaskId === input.researchTaskRef,
  );

  if (!sameRef(candidate.adaptationPlanRef, {
    id: plan.identity.adaptationPlanId,
    version: plan.version,
  })) {
    issues.push(
      validationIssue(
        "ADAPTATION_PLAN_REF_MISMATCH",
        "adaptationPlanRef",
        "Decision candidate is not pinned to the supplied AdaptationPlan version.",
      ),
    );
  }

  if (!sameRef(candidate.registryRef, {
    id: input.registry.identity.registryId,
    version: input.registry.version,
  })) {
    issues.push(
      validationIssue(
        "REGISTRY_REF_MISMATCH",
        "registryRef",
        "Decision candidate is not pinned to the supplied registry version.",
      ),
    );
  }

  if (candidate.researchTaskRef !== input.researchTaskRef) {
    issues.push(
      validationIssue(
        "RESEARCH_TASK_REF_MISMATCH",
        "researchTaskRef",
        "Decision candidate researchTaskRef does not match the request.",
      ),
    );
  }

  if (candidate.disposition === "needs_upstream_research") {
    if (candidate.proposals.length > 0 || !candidate.blockingReason) {
      issues.push(
        validationIssue(
          "INVALID_UPSTREAM_RESEARCH_DISPOSITION",
          "disposition",
          "needs_upstream_research requires proposals=[] and a blockingReason.",
        ),
      );
    }
    return validationResult(issues);
  }

  if (candidate.proposals.length === 0) {
    issues.push(
      validationIssue(
        "PROPOSED_DISPOSITION_WITHOUT_DECISIONS",
        "proposals",
        "disposition=proposed requires at least one decision proposal.",
      ),
    );
    return validationResult(issues);
  }

  if (!task) {
    issues.push(
      validationIssue(
        "UNKNOWN_RESEARCH_TASK",
        "researchTaskRef",
        "Cannot validate proposals without the requested research task.",
      ),
    );
    return validationResult(issues);
  }

  const gapById = new Map(plan.gapAnalysis.map((gap) => [gap.gapId, gap] as const));
  const eligibleRequirementRefs = new Set(
    task.gapRefs
      .map((gapRef) => gapById.get(gapRef)?.requirementRef)
      .filter((ref): ref is string => Boolean(ref)),
  );
  const requirementById = new Map(
    input.curriculum.adaptationRequirements.map((requirement) => [
      requirement.requirementId,
      requirement,
    ] as const),
  );
  const resolutionByRequirement = new Map(
    plan.requirementResolution.map((resolution) => [
      resolution.requirementRef,
      resolution,
    ] as const),
  );
  const covered = new Set<string>();

  candidate.proposals.forEach((proposal, index) => {
    const decision = proposal.decision;
    const proposalPath = `proposals.${index}`;

    if (decision.identity.status !== "provisional") {
      issues.push(
        validationIssue(
          "AI_DECISION_NOT_PROVISIONAL",
          `${proposalPath}.decision.identity.status`,
          "AI-proposed decisions must remain provisional.",
        ),
      );
    }
    if (decision.evidence.reviewStatus !== "machine_synthesized") {
      issues.push(
        validationIssue(
          "AI_DECISION_REVIEW_STATUS_INVALID",
          `${proposalPath}.decision.evidence.reviewStatus`,
          "AI-proposed decisions must remain machine_synthesized until reviewed.",
        ),
      );
    }
    if (decision.evidence.externalEvidenceRefs.length > 0) {
      issues.push(
        validationIssue(
          "REGISTRY_REASONING_USES_EXTERNAL_EVIDENCE",
          `${proposalPath}.decision.evidence.externalEvidenceRefs`,
          "registry_reasoning proposals cannot claim external evidence.",
        ),
      );
    }
    if (decision.lifecycle.createdFrom.sourceType !== "profile_reasoning") {
      issues.push(
        validationIssue(
          "AI_DECISION_SOURCE_TYPE_INVALID",
          `${proposalPath}.decision.lifecycle.createdFrom.sourceType`,
          "registry_reasoning proposals must be created from profile_reasoning.",
        ),
      );
    }
    if (decision.lifecycle.supersedes) {
      issues.push(
        validationIssue(
          "AI_PROPOSAL_CANNOT_SUPERSEDE_YET",
          `${proposalPath}.decision.lifecycle.supersedes`,
          "A provisional proposal cannot supersede a registry decision before promotion.",
        ),
      );
    }

    for (const requirementRef of proposal.requirementRefs) {
      if (!eligibleRequirementRefs.has(requirementRef)) {
        issues.push(
          validationIssue(
            "PROPOSAL_TARGETS_INELIGIBLE_REQUIREMENT",
            `${proposalPath}.requirementRefs`,
            `Requirement ${requirementRef} is outside the selected registry_reasoning task.`,
            { relatedRefs: [requirementRef] },
          ),
        );
        continue;
      }
      covered.add(requirementRef);

      if (!decision.trigger.adaptationRequirementRefs.includes(requirementRef)) {
        issues.push(
          validationIssue(
            "DECISION_TRIGGER_MISSING_REQUIREMENT",
            `${proposalPath}.decision.trigger.adaptationRequirementRefs`,
            `Decision does not declare requirement ${requirementRef} as a trigger.`,
            { relatedRefs: [requirementRef] },
          ),
        );
      }

      const requirement = requirementById.get(requirementRef);
      const resolution = resolutionByRequirement.get(requirementRef);
      if (!requirement || !resolution) continue;

      if (decision.scope.scopeType !== requirement.decisionScope) {
        issues.push(
          validationIssue(
            "DECISION_SCOPE_MISMATCH",
            `${proposalPath}.decision.scope.scopeType`,
            `Decision scope must match ${requirement.decisionScope}.`,
            { relatedRefs: [requirementRef] },
          ),
        );
      }
      if (
        requirement.decisionScope === "level_global" &&
        decision.scope.levelScope !== input.curriculum.identity.levelId
      ) {
        issues.push(
          validationIssue(
            "DECISION_LEVEL_SCOPE_MISMATCH",
            `${proposalPath}.decision.scope.levelScope`,
            "Level-scoped decision must use the current curriculum level.",
          ),
        );
      }
      if (
        requirement.decisionScope === "unit_contextual" &&
        decision.scope.unitScope !== input.curriculum.identity.unitId
      ) {
        issues.push(
          validationIssue(
            "DECISION_UNIT_SCOPE_MISMATCH",
            `${proposalPath}.decision.scope.unitScope`,
            "Unit-scoped decision must use the current curriculum unit.",
          ),
        );
      }

      if (proposal.operation === "create") {
        if (proposal.baseDecisionRef || resolution.resolutionMode !== "resolve") {
          issues.push(
            validationIssue(
              "INVALID_CREATE_OPERATION",
              proposalPath,
              "create is valid only for a resolve gap without baseDecisionRef.",
            ),
          );
        }
      } else {
        if (
          !proposal.baseDecisionRef ||
          resolution.resolutionMode !== "extend" ||
          !resolution.decisionRef ||
          !sameRef(proposal.baseDecisionRef, resolution.decisionRef)
        ) {
          issues.push(
            validationIssue(
              "INVALID_EXTEND_OPERATION",
              proposalPath,
              "extend must reference the exact base decision selected by AdaptationPlan.",
            ),
          );
        } else {
          if (decision.identity.decisionId !== proposal.baseDecisionRef.id) {
            issues.push(
              validationIssue(
                "EXTENSION_DECISION_ID_MISMATCH",
                `${proposalPath}.decision.identity.decisionId`,
                "An extension must preserve the stable decisionId.",
              ),
            );
          }
          if (
            compareSemver(
              decision.identity.decisionVersion,
              proposal.baseDecisionRef.version,
            ) <= 0
          ) {
            issues.push(
              validationIssue(
                "EXTENSION_VERSION_NOT_NEWER",
                `${proposalPath}.decision.identity.decisionVersion`,
                "An extension must propose a newer decision version.",
              ),
            );
          }
        }
      }
    }

    const firstRequiredBy = decision.trigger.firstRequiredBy;
    if (
      !sameRef(firstRequiredBy.curriculumUnitRef, {
        id: input.curriculum.identity.unitId,
        version: input.curriculum.specVersion,
      }) ||
      !proposal.requirementRefs.includes(firstRequiredBy.requirementRef)
    ) {
      issues.push(
        validationIssue(
          "FIRST_REQUIRED_BY_MISMATCH",
          `${proposalPath}.decision.trigger.firstRequiredBy`,
          "firstRequiredBy must point to this curriculum version and one proposal requirement.",
        ),
      );
    }

    const validFor = decision.compatibility.validFor;
    if (
      validFor.languageId !== input.languageProfile.identity.languageId ||
      validFor.varietyId !== input.languageProfile.identity.varietyId ||
      validFor.curriculumId !== input.curriculum.identity.curriculumId
    ) {
      issues.push(
        validationIssue(
          "DECISION_COMPATIBILITY_CONTEXT_MISMATCH",
          `${proposalPath}.decision.compatibility.validFor`,
          "Decision compatibility must match the supplied language, variety and curriculum.",
        ),
      );
    }
  });

  for (const requirementRef of eligibleRequirementRefs) {
    if (!covered.has(requirementRef)) {
      issues.push(
        validationIssue(
          "RESEARCH_TASK_REQUIREMENT_UNCOVERED",
          "proposals",
          `No proposal covers requirement ${requirementRef}.`,
          { relatedRefs: [requirementRef] },
        ),
      );
    }
  }

  const temporaryRegistry = buildTemporaryRegistry(
    input.registry,
    candidate.proposals.map((proposal) => proposal.decision),
  );
  const registryValidation = validateLanguageDecisionRegistry(temporaryRegistry, {
    languageProfile: input.languageProfile,
  });
  issues.push(
    ...registryValidation.issues.map((issue) => ({
      ...issue,
      path: issue.path ? `proposedRegistry.${issue.path}` : "proposedRegistry",
    })),
  );

  return validationResult(issues);
}

export interface AdaptationDecisionProposer {
  propose(
    input: AdaptationDecisionProposalInput,
  ): Promise<ValidatedCandidate<AdaptationDecisionCandidate>>;
}

type ParsedDecisionResponse = {
  status?: string;
  output_parsed?: unknown;
  output?: unknown;
};

type DecisionResponseRequester = (request: {
  model: string;
  instructions: string;
  input: string;
  store: false;
  text: {
    format: ReturnType<typeof zodTextFormat>;
  };
}) => Promise<ParsedDecisionResponse>;

function responseContainsRefusal(output: unknown) {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!item || typeof item !== "object" || !("content" in item)) return false;
    const content = item.content;
    return (
      Array.isArray(content) &&
      content.some(
        (entry) =>
          Boolean(entry) &&
          typeof entry === "object" &&
          "type" in entry &&
          entry.type === "refusal",
      )
    );
  });
}

function parseProviderCandidate(response: ParsedDecisionResponse) {
  if (response.status && response.status !== "completed") {
    throw new StructuredCandidateBoundaryError("incomplete_response");
  }
  if (response.output_parsed == null) {
    throw new StructuredCandidateBoundaryError(
      responseContainsRefusal(response.output) ? "refusal" : "empty_response",
    );
  }
  return response.output_parsed;
}

function buildDecisionInput(
  input: AdaptationDecisionProposalInput,
  previousIssues: ValidationIssue[],
) {
  const task = input.adaptationPlan.researchPlan.find(
    (entry) => entry.researchTaskId === input.researchTaskRef,
  );
  const taskGapRefs = new Set(task?.gapRefs ?? []);
  const relevantGaps = input.adaptationPlan.gapAnalysis.filter((gap) =>
    taskGapRefs.has(gap.gapId),
  );
  const requirementRefs = new Set(relevantGaps.map((gap) => gap.requirementRef));
  const requirements = input.curriculum.adaptationRequirements.filter((requirement) =>
    requirementRefs.has(requirement.requirementId),
  );
  const feedback = compactValidationFeedback(previousIssues);

  return [
    "RESEARCH TASK AUTORITATIVA:",
    JSON.stringify(task),
    "\nGAPS AUTORITATIVOS:",
    JSON.stringify(relevantGaps),
    "\nADAPTATION REQUIREMENTS AUTORITATIVOS:",
    JSON.stringify(requirements),
    "\nLANGUAGE PROFILE VALIDADO (única fuente de hechos lingüísticos):",
    JSON.stringify(input.languageProfile),
    "\nLANGUAGE DECISION REGISTRY EXISTENTE:",
    JSON.stringify(input.registry),
    feedback.length > 0
      ? `\nERRORES DEL INTENTO ANTERIOR. Corrígelos sin inventar evidencia:\n${feedback.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class OpenAIAdaptationDecisionProposer
  implements AdaptationDecisionProposer
{
  constructor(
    private readonly requester?: DecisionResponseRequester,
    private readonly configuredModel?: string,
    private readonly maxAttempts = 2,
  ) {}

  async propose(input: AdaptationDecisionProposalInput) {
    const inputValidation = validateInput(input);
    if (!inputValidation.valid) {
      throw new StructuredCandidateBoundaryError("invalid_input", [
        {
          attempt: 0,
          outcome: "invalid_candidate",
          issues: inputValidation.issues,
        },
      ]);
    }

    return runStructuredCandidateBoundary({
      schema: adaptationDecisionCandidateSchema,
      maxAttempts: this.maxAttempts,
      semanticValidator: (candidate) =>
        validateAdaptationDecisionCandidate(candidate, input),
      generate: async ({ previousIssues }) => {
        try {
          const response = await this.request(input, previousIssues);
          return parseProviderCandidate(response);
        } catch (error) {
          if (error instanceof StructuredCandidateBoundaryError) throw error;
          throw new StructuredCandidateBoundaryError("provider_error");
        }
      },
    });
  }

  private async request(
    input: AdaptationDecisionProposalInput,
    previousIssues: ValidationIssue[],
  ) {
    const model =
      this.configuredModel ?? process.env.OPENAI_LANGUAGE_DECISION_MODEL;
    if (!model) {
      throw new StructuredCandidateBoundaryError("not_configured");
    }

    const request = {
      model,
      instructions: DECISION_PROPOSAL_INSTRUCTIONS,
      input: buildDecisionInput(input, previousIssues),
      store: false as const,
      text: {
        format: zodTextFormat(
          adaptationDecisionCandidateSchema,
          "adaptation_decision_candidate",
        ),
      },
    };

    if (this.requester) return this.requester(request);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new StructuredCandidateBoundaryError("not_configured");
    }

    const client = new OpenAI({ apiKey });
    return client.responses.parse(request);
  }
}
