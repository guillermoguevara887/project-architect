import assert from "node:assert/strict";
import test from "node:test";
import {
  compileInitialAdaptationPlan,
  type AdaptationPlan,
} from "../src/languages/adaptation/adaptation-plan.js";
import {
  OpenAIAdaptationDecisionProposer,
  validateAdaptationDecisionCandidate,
  type AdaptationDecisionCandidate,
  type AdaptationDecisionProposalInput,
} from "../src/languages/ai/adaptation-decision-proposer.js";
import { StructuredCandidateBoundaryError } from "../src/languages/ai/structured-candidate-boundary.js";
import type { LanguageDecision } from "../src/languages/decisions/language-decision-registry.js";
import { germanM5DecisionRegistryFixture } from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

function initialGermanPlan(): AdaptationPlan {
  const result = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
  assert.ok(result.plan, JSON.stringify(result.validation.issues, null, 2));
  return result.plan;
}

function provisionalWritingDecision(): LanguageDecision {
  const source = germanM5DecisionRegistryFixture.decisions.find(
    (decision) => decision.identity.decisionId === "writing.beginner_strategy",
  );
  assert.ok(source);
  const decision = structuredClone(source);
  decision.identity.status = "provisional";
  decision.evidence.externalEvidenceRefs = [];
  decision.evidence.confidence = "medium";
  decision.evidence.reviewStatus = "machine_synthesized";
  decision.evidence.reasoningSummary =
    "Machine-synthesized proposal grounded only in the reviewed German LanguageProfile.";
  decision.lifecycle.createdFrom = {
    sourceType: "profile_reasoning",
    sourceRefs: [...decision.languageBasis.featureRefs],
  };
  delete decision.lifecycle.supersedes;
  return decision;
}

function proposalInput(): AdaptationDecisionProposalInput {
  return {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
    adaptationPlan: initialGermanPlan(),
    researchTaskRef: "research.literacy",
  };
}

function validProposalCandidate(
  input = proposalInput(),
): AdaptationDecisionCandidate {
  return {
    adaptationPlanRef: {
      id: input.adaptationPlan.identity.adaptationPlanId,
      version: input.adaptationPlan.version,
    },
    registryRef: {
      id: input.registry.identity.registryId,
      version: input.registry.version,
    },
    researchTaskRef: input.researchTaskRef,
    disposition: "proposed",
    proposals: [
      {
        operation: "create",
        requirementRefs: ["AR01"],
        decision: provisionalWritingDecision(),
      },
    ],
  };
}

test("M6 decision candidate grounds a provisional German writing strategy in M2/M3 contracts", () => {
  const input = proposalInput();
  const candidate = validProposalCandidate(input);
  const result = validateAdaptationDecisionCandidate(candidate, input);

  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("M6 decision boundary never allows a model to self-validate a decision", () => {
  const input = proposalInput();
  const candidate = validProposalCandidate(input);
  candidate.proposals[0]!.decision.identity.status = "validated";
  candidate.proposals[0]!.decision.evidence.reviewStatus = "cross_checked";

  const result = validateAdaptationDecisionCandidate(candidate, input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "AI_DECISION_NOT_PROVISIONAL"));
  assert.ok(
    result.issues.some((issue) => issue.code === "AI_DECISION_REVIEW_STATUS_INVALID"),
  );
});

test("M6 registry reasoning cannot claim external evidence", () => {
  const input = proposalInput();
  const candidate = validProposalCandidate(input);
  candidate.proposals[0]!.decision.evidence.externalEvidenceRefs = ["invented.source"];

  const result = validateAdaptationDecisionCandidate(candidate, input);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "REGISTRY_REASONING_USES_EXTERNAL_EVIDENCE",
    ),
  );
});

test("M6 decision candidate may explicitly escalate when profile evidence is insufficient", () => {
  const input = proposalInput();
  const candidate: AdaptationDecisionCandidate = {
    adaptationPlanRef: {
      id: input.adaptationPlan.identity.adaptationPlanId,
      version: input.adaptationPlan.version,
    },
    registryRef: {
      id: input.registry.identity.registryId,
      version: input.registry.version,
    },
    researchTaskRef: input.researchTaskRef,
    disposition: "needs_upstream_research",
    blockingReason: "The supplied profile does not support a safe productive subset.",
    proposals: [],
  };

  const result = validateAdaptationDecisionCandidate(candidate, input);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("M6 decision proposer repairs invalid model status using validator feedback", async () => {
  const input = proposalInput();
  const requests: string[] = [];
  let attempt = 0;
  const proposer = new OpenAIAdaptationDecisionProposer(
    async (request) => {
      requests.push(request.input);
      attempt += 1;
      const candidate = validProposalCandidate(input);
      if (attempt === 1) candidate.proposals[0]!.decision.identity.status = "validated";
      return { status: "completed", output_parsed: candidate };
    },
    "decision-test-model",
    2,
  );

  const result = await proposer.propose(input);
  assert.equal(result.attempts, 2);
  assert.equal(requests.length, 2);
  assert.match(requests[1] ?? "", /AI_DECISION_NOT_PROVISIONAL/);
  assert.equal(result.value.proposals[0]?.decision.identity.status, "provisional");
});

test("M6 refuses to call the reasoning model for an external-research task", async () => {
  const input = proposalInput();
  const changedPlan = structuredClone(input.adaptationPlan);
  const task = changedPlan.researchPlan.find(
    (entry) => entry.researchTaskId === input.researchTaskRef,
  );
  assert.ok(task);
  task.researchNecessity = "external_research";
  input.adaptationPlan = changedPlan;

  let called = false;
  const proposer = new OpenAIAdaptationDecisionProposer(
    async () => {
      called = true;
      return { status: "completed", output_parsed: validProposalCandidate(input) };
    },
    "decision-test-model",
  );

  await assert.rejects(
    () => proposer.propose(input),
    (error: unknown) => {
      assert.ok(error instanceof StructuredCandidateBoundaryError);
      assert.equal(error.code, "invalid_input");
      return true;
    },
  );
  assert.equal(called, false);
});
