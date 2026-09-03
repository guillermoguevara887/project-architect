import type { AdaptationDecisionCandidate } from "../ai/adaptation-decision-proposer.js";
import {
  languageDecisionRefKey,
  validateLanguageDecisionRegistry,
  type LanguageDecision,
  type LanguageDecisionRegistry,
} from "../decisions/language-decision-registry.js";
import {
  validationIssue,
  validationResult,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";
import {
  validateLanguageProfile,
  type LanguageProfile,
} from "../profile/language-profile.js";

export type DecisionProposal = AdaptationDecisionCandidate["proposals"][number];

export type DecisionApproval = {
  action: "accept";
  evidenceReviewStatus: "cross_checked" | "human_reviewed";
  confidence: "medium" | "high";
  note: string;
};

export type DecisionRejection = {
  action: "reject";
  note: string;
};

export type DecisionReview = DecisionApproval | DecisionRejection;

export type DecisionPromotionResult =
  | { outcome: "accepted"; registry: LanguageDecisionRegistry }
  | { outcome: "rejected" };

function bumpMinor(version: string) {
  const core = version.split(/[+-]/u, 1)[0] ?? version;
  const [major = "0", minor = "0"] = core.split(".");
  return `${Number(major)}.${Number(minor) + 1}.0`;
}

function decisionRef(decision: LanguageDecision) {
  return {
    id: decision.identity.decisionId,
    version: decision.identity.decisionVersion,
  };
}

function rebuildDependencyGraph(decisions: LanguageDecision[]) {
  return {
    nodes: decisions.map(decisionRef),
    edges: decisions.flatMap((decision) => {
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
  };
}

function append(
  issues: ValidationIssue[],
  prefix: string,
  result: ValidationResult,
) {
  issues.push(
    ...result.issues.map((issue) => ({
      ...issue,
      path: issue.path ? `${prefix}.${issue.path}` : prefix,
    })),
  );
}

export function validateDecisionProposalForReview(
  proposal: DecisionProposal,
  baseRegistry: LanguageDecisionRegistry,
  profile: LanguageProfile,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  append(issues, "profile", validateLanguageProfile(profile));
  append(
    issues,
    "registry",
    validateLanguageDecisionRegistry(baseRegistry, { languageProfile: profile }),
  );

  const decision = proposal.decision;
  if (decision.identity.status !== "provisional") {
    issues.push(
      validationIssue(
        "REVIEW_PROPOSAL_NOT_PROVISIONAL",
        "decision.identity.status",
        "Only provisional decisions can enter M11 review.",
      ),
    );
  }
  if (decision.evidence.reviewStatus !== "machine_synthesized") {
    issues.push(
      validationIssue(
        "REVIEW_PROPOSAL_ALREADY_REVIEWED",
        "decision.evidence.reviewStatus",
        "M11 accepts machine-synthesized proposals before review.",
      ),
    );
  }
  if (decision.evidence.externalEvidenceRefs.length > 0) {
    issues.push(
      validationIssue(
        "REVIEW_PROPOSAL_CLAIMS_EXTERNAL_EVIDENCE",
        "decision.evidence.externalEvidenceRefs",
        "Registry-reasoning proposals cannot acquire external evidence before a separate research workflow.",
      ),
    );
  }
  if (decision.lifecycle.supersedes) {
    issues.push(
      validationIssue(
        "REVIEW_PROPOSAL_SUPERSEDES_TOO_EARLY",
        "decision.lifecycle.supersedes",
        "Supersession is assigned only when an extension is promoted.",
      ),
    );
  }

  if (proposal.operation === "create") {
    if (proposal.baseDecisionRef) {
      issues.push(
        validationIssue(
          "CREATE_PROPOSAL_HAS_BASE_DECISION",
          "baseDecisionRef",
          "Create proposals cannot reference a base decision.",
        ),
      );
    }
  } else {
    const baseRef = proposal.baseDecisionRef;
    if (!baseRef) {
      issues.push(
        validationIssue(
          "EXTEND_PROPOSAL_MISSING_BASE_DECISION",
          "baseDecisionRef",
          "Extend proposals require an exact base decision reference.",
        ),
      );
    } else {
      const base = baseRegistry.decisions.find(
        (entry) => languageDecisionRefKey(decisionRef(entry)) === languageDecisionRefKey(baseRef),
      );
      if (!base || base.identity.status !== "validated") {
        issues.push(
          validationIssue(
            "EXTEND_PROPOSAL_BASE_NOT_VALIDATED",
            "baseDecisionRef",
            "An extension can be promoted only from an existing validated base decision.",
          ),
        );
      }
      if (decision.identity.decisionId !== baseRef.id) {
        issues.push(
          validationIssue(
            "EXTEND_PROPOSAL_ID_MISMATCH",
            "decision.identity.decisionId",
            "An extension must preserve the stable decisionId.",
          ),
        );
      }
    }
  }

  if (
    baseRegistry.identity.languageId !== profile.identity.languageId ||
    baseRegistry.identity.varietyId !== profile.identity.varietyId
  ) {
    issues.push(
      validationIssue(
        "KNOWLEDGE_IDENTITY_MISMATCH",
        "registry.identity",
        "Profile and registry language/variety must match.",
      ),
    );
  }

  return validationResult(issues);
}

export function reviewDecisionProposal(
  proposal: DecisionProposal,
  baseRegistry: LanguageDecisionRegistry,
  profile: LanguageProfile,
  review: DecisionReview,
): { result: DecisionPromotionResult | null; validation: ValidationResult } {
  const issues = [...validateDecisionProposalForReview(proposal, baseRegistry, profile).issues];
  if (review.note.trim().length === 0) {
    issues.push(
      validationIssue(
        "DECISION_REVIEW_NOTE_REQUIRED",
        "review.note",
        "Decision review requires an audit note.",
      ),
    );
  }
  if (issues.length > 0) return { result: null, validation: validationResult(issues) };
  if (review.action === "reject") {
    return { result: { outcome: "rejected" }, validation: validationResult([]) };
  }

  if (proposal.decision.evidence.profileClaimRefs.length === 0) {
    return {
      result: null,
      validation: validationResult([
        validationIssue(
          "PROMOTION_REQUIRES_PROFILE_EVIDENCE",
          "decision.evidence.profileClaimRefs",
          "Registry-reasoning decisions require at least one grounded LanguageProfile claim before validation.",
        ),
      ]),
    };
  }

  const promoted = structuredClone(proposal.decision);
  promoted.identity.status = "validated";
  promoted.evidence.reviewStatus = review.evidenceReviewStatus;
  promoted.evidence.confidence = review.confidence;

  const decisions = structuredClone(baseRegistry.decisions);
  if (proposal.operation === "extend" && proposal.baseDecisionRef) {
    const baseKey = languageDecisionRefKey(proposal.baseDecisionRef);
    const base = decisions.find(
      (entry) => languageDecisionRefKey(decisionRef(entry)) === baseKey,
    );
    if (!base) {
      return {
        result: null,
        validation: validationResult([
          validationIssue(
            "PROMOTION_BASE_DECISION_DISAPPEARED",
            "baseDecisionRef",
            `Base decision ${baseKey} is no longer present in the registry snapshot.`,
          ),
        ]),
      };
    }
    base.identity.status = "superseded";
    promoted.lifecycle.supersedes = structuredClone(proposal.baseDecisionRef);
  }
  decisions.push(promoted);

  const registry: LanguageDecisionRegistry = {
    ...structuredClone(baseRegistry),
    decisions,
    dependencyGraph: rebuildDependencyGraph(decisions),
    version: bumpMinor(baseRegistry.version),
    status: "canonical",
  };
  const registryValidation = validateLanguageDecisionRegistry(registry, {
    languageProfile: profile,
  });
  if (!registryValidation.valid) {
    return {
      result: null,
      validation: validationResult(
        registryValidation.issues.map((issue) => ({
          ...issue,
          path: issue.path ? `promotedRegistry.${issue.path}` : "promotedRegistry",
        })),
      ),
    };
  }

  return {
    result: { outcome: "accepted", registry },
    validation: validationResult([]),
  };
}
