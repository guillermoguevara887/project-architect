import OpenAI from "openai";
import {
  compactValidationFeedback,
  runStructuredCandidateBoundary,
  StructuredCandidateBoundaryError,
  type ValidatedCandidate,
} from "../ai/structured-candidate-boundary.js";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import type { ValidationIssue } from "../curriculum/validation.js";
import type { LanguageProfile } from "../profile/language-profile.js";
import {
  deriveProfileResearchTargets,
  languageProfileResearchCandidateSchema,
  validateLanguageProfileResearchCandidate,
  type LanguageProfileResearchCandidate,
} from "./contracts.js";

export type ProfileResearchInput = {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  adaptationPlan: AdaptationPlan;
  researchTaskRefs: string[];
};

export type ProfileResearchResult = ValidatedCandidate<LanguageProfileResearchCandidate> & {
  observedUrls: string[];
  providerModel: string;
};

type ParsedResearchResponse = {
  status?: string;
  output_parsed?: unknown;
  output_text?: string;
  output?: unknown;
};

type ResearchRequest = {
  model: string;
  instructions: string;
  input: string;
  store: false;
  tools: Array<{ type: "web_search"; search_context_size: "high" }>;
  include: string[];
  text: { format: { type: "json_object" } };
};

export type ProfileResearchRequester = (
  request: ResearchRequest,
) => Promise<ParsedResearchResponse>;

const RESEARCH_INSTRUCTIONS = `
You are the evidence-research boundary for MemoOS language adaptation.
Research only the supplied blocked requirements. Use web search before answering.
The existing LanguageProfile is authoritative for structure and identity: never invent
new featureId values, scripts, mechanisms, curriculum requirements or pedagogical
strategies. Your task is evidence enrichment, not lesson design.

Return one JSON object matching the requested candidate contract. Every source URL
must be a URL you actually used through web search. An automatically usable claim
must cite at least two sources from distinct hostnames. Claims remain
reviewStatus=machine_synthesized; MemoOS, not you, decides whether they become
cross_checked. If the evidence is conflicting, insufficient, or cannot be attached
honestly to an existing featureId, return disposition=needs_review with a reason.
Do not quote long passages. Summarize the supported linguistic fact in your own words.
`.trim();

function parseCandidate(response: ParsedResearchResponse) {
  if (response.status && response.status !== "completed") {
    throw new StructuredCandidateBoundaryError("incomplete_response");
  }
  if (response.output_parsed != null) return response.output_parsed;
  const outputText = response.output_text?.trim();
  if (!outputText) {
    throw new StructuredCandidateBoundaryError("empty_response");
  }
  try {
    return JSON.parse(outputText) as unknown;
  } catch {
    return outputText;
  }
}

function collectObservedUrls(value: unknown, target = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectObservedUrls(entry, target));
    return target;
  }
  if (!value || typeof value !== "object") return target;
  const record = value as Record<string, unknown>;
  if (record.type === "web_search_call" && record.action && typeof record.action === "object") {
    const action = record.action as Record<string, unknown>;
    if (typeof action.url === "string") target.add(action.url);
    if (Array.isArray(action.sources)) {
      for (const source of action.sources) {
        if (
          source &&
          typeof source === "object" &&
          typeof (source as Record<string, unknown>).url === "string"
        ) {
          target.add((source as Record<string, unknown>).url as string);
        }
      }
    }
  }
  if (record.type === "url_citation" && typeof record.url === "string") {
    target.add(record.url);
  }
  Object.values(record).forEach((entry) => collectObservedUrls(entry, target));
  return target;
}

function buildResearchInput(
  input: ProfileResearchInput,
  previousIssues: ValidationIssue[],
) {
  const targets = deriveProfileResearchTargets({
    ...input,
    researchTaskRefs: input.researchTaskRefs,
  });
  const taskSet = new Set(input.researchTaskRefs);
  const tasks = input.adaptationPlan.researchPlan.filter((task) =>
    taskSet.has(task.researchTaskId),
  );
  const gapRefs = new Set(tasks.flatMap((task) => task.gapRefs));
  const gaps = input.adaptationPlan.gapAnalysis.filter((gap) => gapRefs.has(gap.gapId));
  const requirementRefs = new Set(targets.map((target) => target.requirementRef));
  const requirements = input.curriculum.adaptationRequirements.filter((requirement) =>
    requirementRefs.has(requirement.requirementId),
  );
  const feedback = compactValidationFeedback(previousIssues);

  return [
    "LANGUAGE / VARIETY:",
    JSON.stringify(input.languageProfile.identity),
    "\nBASE PROFILE REF:",
    JSON.stringify({
      id: input.languageProfile.identity.profileId,
      version: input.languageProfile.version,
    }),
    "\nADAPTATION PLAN REF:",
    JSON.stringify({
      id: input.adaptationPlan.identity.adaptationPlanId,
      version: input.adaptationPlan.version,
    }),
    "\nBLOCKED RESEARCH TASKS:",
    JSON.stringify(tasks),
    "\nBLOCKED GAPS:",
    JSON.stringify(gaps),
    "\nAUTHORITATIVE REQUIREMENTS:",
    JSON.stringify(requirements),
    "\nALLOWED TARGET FEATURES BY REQUIREMENT:",
    JSON.stringify(targets),
    "\nEXISTING PROFILE EVIDENCE REGISTRY (do not duplicate IDs):",
    JSON.stringify(input.languageProfile.evidenceRegistry),
    "\nOUTPUT CONTRACT NOTES:",
    JSON.stringify({
      baseProfileRef: "exact base profile ref",
      adaptationPlanRef: "exact plan ref",
      researchTaskRefs: input.researchTaskRefs,
      disposition: "enriched | needs_review",
      sources: "2+ observed web URLs for enrichment",
      claims:
        "claimId, existing featureRef, concise statement, 2+ evidenceRefs, confidence medium|high, reviewStatus machine_synthesized, requirementRefs",
    }),
    feedback.length > 0
      ? `\nVALIDATION ERRORS FROM THE PREVIOUS ATTEMPT. Correct them without inventing evidence:\n${feedback.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface LanguageProfileResearcher {
  research(input: ProfileResearchInput): Promise<ProfileResearchResult>;
}

export class OpenAILanguageProfileResearcher implements LanguageProfileResearcher {
  constructor(
    private readonly requester?: ProfileResearchRequester,
    private readonly configuredModel?: string,
    private readonly maxAttempts = 2,
  ) {}

  async research(input: ProfileResearchInput): Promise<ProfileResearchResult> {
    if (input.researchTaskRefs.length === 0) {
      throw new StructuredCandidateBoundaryError("invalid_input");
    }
    let lastObservedUrls: string[] = [];
    const model =
      this.configuredModel ??
      process.env.OPENAI_LANGUAGE_PROFILE_RESEARCH_MODEL ??
      process.env.OPENAI_LANGUAGE_DECISION_MODEL;
    if (!model) throw new StructuredCandidateBoundaryError("not_configured");

    const validated = await runStructuredCandidateBoundary({
      schema: languageProfileResearchCandidateSchema,
      maxAttempts: this.maxAttempts,
      semanticValidator: (candidate) =>
        validateLanguageProfileResearchCandidate(candidate, {
          ...input,
          observedUrls: lastObservedUrls,
        }),
      generate: async ({ previousIssues }) => {
        try {
          const response = await this.request(model, input, previousIssues);
          lastObservedUrls = [...collectObservedUrls(response.output)].sort();
          return parseCandidate(response);
        } catch (error) {
          if (error instanceof StructuredCandidateBoundaryError) throw error;
          throw new StructuredCandidateBoundaryError("provider_error");
        }
      },
    });

    return {
      ...validated,
      observedUrls: lastObservedUrls,
      providerModel: model,
    };
  }

  private async request(
    model: string,
    input: ProfileResearchInput,
    previousIssues: ValidationIssue[],
  ) {
    const request: ResearchRequest = {
      model,
      instructions: RESEARCH_INSTRUCTIONS,
      input: buildResearchInput(input, previousIssues),
      store: false,
      tools: [{ type: "web_search", search_context_size: "high" }],
      include: ["web_search_call.action.sources"],
      text: { format: { type: "json_object" } },
    };
    if (this.requester) return this.requester(request);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new StructuredCandidateBoundaryError("not_configured");
    const client = new OpenAI({ apiKey });
    return client.responses.create(request as never);
  }
}

export const languageProfileResearcher = new OpenAILanguageProfileResearcher();
