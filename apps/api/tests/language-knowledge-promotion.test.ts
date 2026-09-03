import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageDecision } from "../src/languages/decisions/language-decision-registry.js";
import {
  reviewDecisionProposal,
  validateDecisionProposalForReview,
  type DecisionProposal,
} from "../src/languages/knowledge/promotion.js";
import { germanM5DecisionRegistryFixture } from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

function participantExtensionProposal(): DecisionProposal {
  const source = germanDecisionRegistryFixture.decisions.find(
    (decision) => decision.identity.decisionId === "participant.actor_affected",
  );
  assert.ok(source);
  const decision = structuredClone(source);
  decision.identity.decisionVersion = "1.1.0";
  decision.identity.status = "provisional";
  decision.resolution.contextConditions.push(
    "The reviewed extension also covers a slightly broader bounded A1 interaction context.",
  );
  decision.evidence.externalEvidenceRefs = [];
  decision.evidence.confidence = "medium";
  decision.evidence.reviewStatus = "machine_synthesized";
  decision.evidence.reasoningSummary =
    "Machine proposal grounded in the existing German profile claim about case and participant roles.";
  decision.lifecycle.createdFrom = {
    sourceType: "profile_reasoning",
    sourceRefs: ["de.claim.case"],
  };
  delete decision.lifecycle.supersedes;
  return {
    operation: "extend",
    requirementRefs: ["AR04"],
    baseDecisionRef: { id: "participant.actor_affected", version: "1.0.0" },
    decision,
  };
}

function writingProposalWithoutProfileClaim(): DecisionProposal {
  const source = germanM5DecisionRegistryFixture.decisions.find(
    (decision) => decision.identity.decisionId === "writing.beginner_strategy",
  );
  assert.ok(source);
  const decision = structuredClone(source);
  decision.identity.status = "provisional";
  decision.evidence.profileClaimRefs = [];
  decision.evidence.externalEvidenceRefs = [];
  decision.evidence.confidence = "medium";
  decision.evidence.reviewStatus = "machine_synthesized";
  decision.lifecycle.createdFrom = {
    sourceType: "profile_reasoning",
    sourceRefs: [...decision.languageBasis.featureRefs],
  };
  delete decision.lifecycle.supersedes;
  return {
    operation: "create",
    requirementRefs: ["AR01"],
    decision,
  };
}

test("M11 accepts a reviewed extension only by creating a new validated registry snapshot", () => {
  const proposal = participantExtensionProposal();
  const review = {
    action: "accept" as const,
    evidenceReviewStatus: "human_reviewed" as const,
    confidence: "high" as const,
    note: "Reviewed against the profile claim and accepted for the broader A1 scope.",
  };

  const result = reviewDecisionProposal(
    proposal,
    germanDecisionRegistryFixture,
    germanLanguageProfileFixture,
    review,
  );

  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues, null, 2));
  assert.equal(result.result?.outcome, "accepted");
  if (!result.result || result.result.outcome !== "accepted") return;

  const registry = result.result.registry;
  assert.equal(registry.version, "1.1.0");
  assert.equal(registry.status, "canonical");
  assert.equal(germanDecisionRegistryFixture.version, "1.0.0");
  assert.equal(
    germanDecisionRegistryFixture.decisions.find(
      (decision) => decision.identity.decisionId === "participant.actor_affected",
    )?.identity.status,
    "validated",
  );

  const oldDecision = registry.decisions.find(
    (decision) =>
      decision.identity.decisionId === "participant.actor_affected" &&
      decision.identity.decisionVersion === "1.0.0",
  );
  const newDecision = registry.decisions.find(
    (decision) =>
      decision.identity.decisionId === "participant.actor_affected" &&
      decision.identity.decisionVersion === "1.1.0",
  );
  assert.equal(oldDecision?.identity.status, "superseded");
  assert.equal(newDecision?.identity.status, "validated");
  assert.deepEqual(newDecision?.lifecycle.supersedes, {
    id: "participant.actor_affected",
    version: "1.0.0",
  });
  assert.equal(newDecision?.evidence.reviewStatus, "human_reviewed");
  assert.equal(newDecision?.evidence.confidence, "high");
});

test("M11 rejection does not mutate or create a registry version", () => {
  const before = structuredClone(germanDecisionRegistryFixture);
  const result = reviewDecisionProposal(
    participantExtensionProposal(),
    germanDecisionRegistryFixture,
    germanLanguageProfileFixture,
    { action: "reject", note: "The proposed scope expansion is not pedagogically justified." },
  );

  assert.equal(result.validation.valid, true);
  assert.deepEqual(result.result, { outcome: "rejected" });
  assert.deepEqual(germanDecisionRegistryFixture, before);
});

test("M11 refuses to validate a registry-reasoning decision without profile claim evidence", () => {
  const result = reviewDecisionProposal(
    writingProposalWithoutProfileClaim(),
    germanDecisionRegistryFixture,
    germanLanguageProfileFixture,
    {
      action: "accept",
      evidenceReviewStatus: "cross_checked",
      confidence: "medium",
      note: "Attempted approval without a grounded profile claim.",
    },
  );

  assert.equal(result.result, null);
  assert.equal(result.validation.valid, false);
  assert.ok(
    result.validation.issues.some(
      (issue) => issue.code === "PROMOTION_REQUIRES_PROFILE_EVIDENCE",
    ),
  );
});

test("M11 review rejects already self-approved or externally embellished proposals", () => {
  const proposal = participantExtensionProposal();
  proposal.decision.identity.status = "validated";
  proposal.decision.evidence.reviewStatus = "cross_checked";
  proposal.decision.evidence.externalEvidenceRefs = ["invented.external.source"];

  const validation = validateDecisionProposalForReview(
    proposal,
    germanDecisionRegistryFixture,
    germanLanguageProfileFixture,
  );

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "REVIEW_PROPOSAL_NOT_PROVISIONAL"));
  assert.ok(validation.issues.some((issue) => issue.code === "REVIEW_PROPOSAL_ALREADY_REVIEWED"));
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "REVIEW_PROPOSAL_CLAIMS_EXTERNAL_EVIDENCE",
    ),
  );
});

test("M11 extension cannot be promoted from a missing or non-validated base", () => {
  const proposal = participantExtensionProposal();
  const base = structuredClone(germanDecisionRegistryFixture);
  const target = base.decisions.find(
    (decision) => decision.identity.decisionId === "participant.actor_affected",
  ) as LanguageDecision | undefined;
  assert.ok(target);
  target.identity.status = "blocked";

  const validation = validateDecisionProposalForReview(
    proposal,
    base,
    germanLanguageProfileFixture,
  );
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "EXTEND_PROPOSAL_BASE_NOT_VALIDATED",
    ),
  );
});
