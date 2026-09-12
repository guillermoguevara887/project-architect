import { z } from "zod";
import { curriculumRequirementDomainSchema, type CurriculumRequirementDomain } from "../curriculum/curriculum-requirement-domain-values.js";
import { domainIdSchema } from "../curriculum/primitives.js";
import { zodIssuesToValidationIssues, type ValidationIssue } from "../curriculum/validation.js";
import { BASELINE_EVIDENCE_POLICY_V2 as baseline, REQUIREMENT_EVIDENCE_INDEPENDENCE_LIMITS as independenceLimits, targetEvidencePolicySchema, type TargetEvidencePolicy } from "./evidence-policy-v2.js";
import {
  evidenceClaimV2Schema, evidenceConflictV2Schema, evidenceSourceV2Schema, sourceEvidenceV2Schema,
  type EvidenceClaimV2, type EvidenceSourceV2,
} from "./evidence-provenance-v2.js";
import { LANGUAGE_PROFILE_V2_SCHEMA_VERSION, languageProfileV2Schema, evidenceClaimReferencesV2Issues, evidenceRegistryReferencesV2Issues } from "./language-profile-v2.js";
import {
  profileKnowledgeSectionsV2Schema, profileKnowledgeSubjectRefSchema,
  profileKnowledgeSlotIdSchema, profileKnowledgeIntegrityIssues, profileSubjectsOverlap,
  type LanguageFeatureV2, type ProfileKnowledgeSubjectRef, type ProfileKnowledgeSlotId,
} from "./profile-knowledge-v2.js";
import {
  REQUIREMENT_EVIDENCE_TARGET_CATALOG as catalog, requirementEvidenceTargetRefSchema,
  type RequirementEvidenceTarget, type RequirementEvidenceTargetGroup,
} from "./requirement-evidence-targets.js";

export const requirementEvidenceReasonSchema = z.enum([
  "profile_not_canonical", "unsupported_schema_version", "profile_contract_invalid",
  "subject_missing", "subject_invalid", "subject_unknown", "subject_relevance_missing",
  "claim_missing", "claim_wrong_target", "claim_wrong_subject", "claim_state_mismatch", "claim_contract_invalid",
  "claim_confidence_insufficient", "claim_review_status_ineligible",
  "source_missing", "source_contract_invalid", "source_authority_insufficient", "source_independence_insufficient",
  "independence_evaluation_limit_exceeded",
  "human_validation_missing", "open_conflict", "not_applicable_unsubstantiated", "target_policy_unsatisfied",
]);
export type RequirementEvidenceReason = z.infer<typeof requirementEvidenceReasonSchema>;
export type RequirementEvidenceStatus = "covered" | "partial" | "missing";
export type RequirementEvidenceMode = "durable" | "preview";
export const requirementEvidenceInputSchema = z.object({
  requirementRef: domainIdSchema,
  domain: curriculumRequirementDomainSchema,
}).strict();
export type RequirementEvidenceInput = z.infer<typeof requirementEvidenceInputSchema>;

export const requirementEvidenceOptionsSchema = z.object({
  mode: z.enum(["durable", "preview"]).optional(),
  // Restrictions, not replacement catalogs or replacement baselines.
  targetPolicies: z.array(z.object({ targetRef: requirementEvidenceTargetRefSchema, policy: targetEvidencePolicySchema }).strict()).optional(),
}).strict().superRefine((options, context) => {
  const ids = (options.targetPolicies ?? []).map((entry) => entry.targetRef.targetId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Duplicate target policy" });
});
export type RequirementEvidenceOptions = z.infer<typeof requirementEvidenceOptionsSchema>;
type Conflict = z.infer<typeof evidenceConflictV2Schema>;
type SourceEvidence = z.infer<typeof sourceEvidenceV2Schema>;
type State = "known" | "unknown" | "not_applicable" | "missing" | "invalid";

export type EffectiveRequirementEvidencePolicy = {
  policyVersion: typeof baseline.policyVersion;
  minimumConfidence: typeof baseline.minimumConfidence;
  allowedReviewStatuses: string[];
  crossCheckedMinimumIndependentSources: number;
  humanReviewedMinimumAuthoritativeSources: number;
  humanReviewedRequiresValidatedClaimSourceRelation: true;
  openConflictBlocksCovered: true;
};
export type RequirementEvidenceSourceAssessment = {
  evidenceRef: string;
  sourceRef: string | null;
  authoritative: boolean;
  humanValidated: boolean;
  reasons: RequirementEvidenceReason[];
};
/** One applicable evaluation; unrelated target/subject pairs are not evaluated. */
export type RequirementEvidenceClaimEvaluation = {
  claimId: string | null;
  targetId: string;
  subjectRef: ProfileKnowledgeSubjectRef;
  accepted: boolean;
  usefulEvidence: boolean;
  reasons: RequirementEvidenceReason[];
  evidence: RequirementEvidenceSourceAssessment[];
  sourceRefs: string[];
  usedSourceRefs: string[];
  independentSourceRefs: string[];
  independenceEvaluation: "evaluated" | "skipped" | "limit_exceeded";
  conflictRefs: string[];
  contractGaps: RequirementEvidenceGap[];
};
/** Unique by claimId within this requirement. Witnesses remain local. */
export type RequirementEvidenceClaimSummary = {
  claimId: string;
  status: "accepted" | "partially_accepted" | "rejected";
  usefulEvidence: boolean;
  reasons: RequirementEvidenceReason[];
  contractGaps: RequirementEvidenceGap[];
  evaluations: RequirementEvidenceClaimEvaluation[];
};
export type RequirementEvidenceGap = {
  reason: RequirementEvidenceReason;
  groupId: string | null;
  targetId: string | null;
  subjectRef: ProfileKnowledgeSubjectRef | null;
  claimRef: string | null;
  sourceRef: string | null;
  evidenceRef: string | null;
  validationIssue?: ValidationIssue;
};
export type RequirementEvidenceSubjectResolution = {
  subjectRef: ProfileKnowledgeSubjectRef;
  state: State;
  status: RequirementEvidenceStatus;
  usefulEvidence: boolean;
  claimEvaluations: RequirementEvidenceClaimEvaluation[];
  sourceRefs: string[];
  conflictRefs: string[];
  gaps: RequirementEvidenceGap[];
};
export type RequirementEvidenceTargetResolution = {
  targetId: string;
  policy: EffectiveRequirementEvidencePolicy;
  status: RequirementEvidenceStatus;
  usefulEvidence: boolean;
  subjects: RequirementEvidenceSubjectResolution[];
  claimEvaluations: RequirementEvidenceClaimEvaluation[];
};
export type RequirementEvidenceGroupResolution = {
  groupId: string;
  requirement: "required" | "optional";
  aggregation: "all" | "any";
  status: RequirementEvidenceStatus;
  targets: RequirementEvidenceTargetResolution[];
};
export type RequirementEvidenceResolution = {
  requirementRef: string;
  domain: CurriculumRequirementDomain;
  profileId: string | null;
  languageId: string | null;
  varietyId: string | null;
  profileVersion: string | null;
  schemaVersion: string | null;
  targetCatalogVersion: typeof catalog.catalogVersion;
  mode: RequirementEvidenceMode;
  durableConsumable: boolean;
  status: RequirementEvidenceStatus;
  groups: RequirementEvidenceGroupResolution[];
  claimEvaluations: RequirementEvidenceClaimEvaluation[];
  acceptedClaims: RequirementEvidenceClaimSummary[];
  rejectedClaims: RequirementEvidenceClaimSummary[];
  sourcesUsed: EvidenceSourceV2[];
  conflicts: Conflict[];
  gaps: RequirementEvidenceGap[];
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const textOrNull = (value: unknown) => typeof value === "string" ? value : null;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const strings = (values: string[]) => [...new Set(values)].sort(compare);
const reasons = (values: RequirementEvidenceReason[]) => strings(values) as RequirementEvidenceReason[];

/** Stable structural keys, independent of property insertion order and locale. */
function key(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(key).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map((name) => `${JSON.stringify(name)}:${key(record(value)[name])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const ordered = <T>(values: T[]): T[] => [...values].sort((a, b) => compare(key(a), key(b)));
const uniqueOrdered = <T>(values: T[]): T[] => [...new Map(ordered(values).map((value) => [key(value), value])).values()];

function effectivePolicy(...restrictions: (TargetEvidencePolicy | undefined)[]): EffectiveRequirementEvidencePolicy {
  let statuses: string[] = [...baseline.eligibleReviewStatuses];
  let independent: number = baseline.crossCheckedMinimumIndependentSources;
  let authoritative: number = baseline.humanReviewedMinimumAuthoritativeSources;
  for (const restriction of restrictions) {
    if (!restriction) continue;
    const policy = targetEvidencePolicySchema.parse(restriction);
    if (policy.allowedReviewStatuses) statuses = statuses.filter((status) => policy.allowedReviewStatuses!.some((allowed) => allowed === status));
    independent = Math.max(independent, policy.crossCheckedMinimumIndependentSources ?? independent);
    authoritative = Math.max(authoritative, policy.humanReviewedMinimumAuthoritativeSources ?? authoritative);
  }
  return {
    policyVersion: baseline.policyVersion, minimumConfidence: baseline.minimumConfidence,
    allowedReviewStatuses: strings(statuses), crossCheckedMinimumIndependentSources: independent,
    humanReviewedMinimumAuthoritativeSources: authoritative,
    humanReviewedRequiresValidatedClaimSourceRelation: baseline.humanReviewedRequiresValidatedClaimSourceRelation,
    openConflictBlocksCovered: baseline.openConflictBlocksCovered,
  };
}

/** Conservative structural independence: sharing entity, work OR lineage disqualifies a pair. */
function independentPair(a: EvidenceSourceV2, b: EvidenceSourceV2) {
  return a.independenceKey.responsibleEntityId !== b.independenceKey.responsibleEntityId &&
    a.independenceKey.workId !== b.independenceKey.workId && a.independenceKey.lineageId !== b.independenceKey.lineageId;
}

/** Find a deterministic sufficient subset, or the largest insufficient subset.
 * A greedy first choice could incorrectly reject two valid independent sources.
 * At n <= 12: <= 4,096 subset states and <= n^2 * 2^n pair checks per search.
 */
function independentSubset(input: EvidenceSourceV2[], needed: number): {
  status: "evaluated" | "limit_exceeded"; sourceRefs: string[];
} {
  // Check before sorting or recursion. No prefix selection or approximate witness.
  if (input.length > independenceLimits.maximumSourcesPerClaim || needed > independenceLimits.maximumRequiredIndependentSources) {
    return { status: "limit_exceeded", sourceRefs: [] };
  }
  const sources = [...input].sort((a, b) => compare(a.sourceId, b.sourceId));
  let best: EvidenceSourceV2[] = [];
  function search(index: number, selected: EvidenceSourceV2[]) {
    if (selected.length > best.length) best = selected;
    if (best.length >= needed || selected.length + sources.length - index <= best.length) return;
    for (let next = index; next < sources.length; next++) {
      const source = sources[next]!;
      if (selected.every((other) => independentPair(source, other))) search(next + 1, [...selected, source]);
      if (best.length >= needed) return;
    }
  }
  search(0, []);
  return { status: "evaluated", sourceRefs: best.map((source) => source.sourceId) };
}

type Knowledge = { state: State; value?: unknown };
function slotKnowledge(profile: Record<string, unknown>, slot: ProfileKnowledgeSlotId): Knowledge {
  const [section, field] = slot.split(".") as [keyof typeof profileKnowledgeSectionsV2Schema.shape, string];
  const raw = record(record(profile.knowledge)[section])[field];
  if (raw === undefined) return { state: "missing" };
  const schema = (profileKnowledgeSectionsV2Schema.shape[section].shape as Record<string, z.ZodTypeAny>)[field]!;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data as Knowledge : { state: "invalid" };
}

type Candidate = { subjectRef: ProfileKnowledgeSubjectRef; knowledge: Knowledge; reasons: RequirementEvidenceReason[] };
function candidates(profile: Record<string, unknown>, target: RequirementEvidenceTarget): Candidate[] {
  const knowledge = slotKnowledge(profile, target.subjectRef.slot);
  const stateReason = { missing: "subject_missing", invalid: "subject_invalid", unknown: "subject_unknown" } as const;
  if (knowledge.state in stateReason) return [{ subjectRef: target.subjectRef, knowledge, reasons: [stateReason[knowledge.state as keyof typeof stateReason]] }];
  if (!target.relevanceRequirement) return [{ subjectRef: target.subjectRef, knowledge, reasons: [] }];
  const result: Candidate[] = [];
  const values = knowledge.state === "known" ? (Array.isArray(knowledge.value) ? knowledge.value : [knowledge.value]) as LanguageFeatureV2[] : [];
  for (const feature of values) {
    if (feature.applicability === "absent") continue;
    if (target.relevanceRequirement.scope === "feature" && feature.relevance.includes(target.relevanceRequirement.relevance)) {
      result.push({ subjectRef: profileKnowledgeSubjectRefSchema.parse({ kind: "feature", slot: target.subjectRef.slot, featureId: feature.featureId }), knowledge, reasons: [] });
    }
    if (target.relevanceRequirement.scope === "feature_mechanism") {
      for (const mechanism of feature.mechanisms) {
        if (mechanism.applicability !== "absent" && mechanism.relevance.includes(target.relevanceRequirement.relevance)) {
          result.push({ subjectRef: profileKnowledgeSubjectRefSchema.parse({ kind: "feature_mechanism", slot: target.subjectRef.slot, featureId: feature.featureId, mechanismId: mechanism.mechanismId }), knowledge, reasons: [] });
        }
      }
    }
  }
  return result.length ? uniqueOrdered(result) : [{ subjectRef: target.subjectRef, knowledge, reasons: ["subject_relevance_missing"] }];
}

function matchesSubject(ref: ProfileKnowledgeSubjectRef, candidate: Candidate): boolean {
  if (key(ref) === key(candidate.subjectRef)) return true;
  if (ref.kind === "section" || candidate.subjectRef.kind === "section" || ref.slot !== candidate.subjectRef.slot) return false;
  // A whole singleton feature and its slot are equivalent. A mechanism or one
  // inventory item never stands in for the full feature/inventory.
  const value = candidate.knowledge.state === "known" ? record(candidate.knowledge.value) : {};
  return typeof value.featureId === "string" && (
    (ref.kind === "feature" && candidate.subjectRef.kind === "slot" && ref.featureId === value.featureId) ||
    (ref.kind === "slot" && candidate.subjectRef.kind === "feature" && candidate.subjectRef.featureId === value.featureId)
  );
}

function overlapping(a: ProfileKnowledgeSubjectRef, b: ProfileKnowledgeSubjectRef): boolean {
  if (a.kind === "section" || b.kind === "section" || a.slot !== b.slot) return false;
  if (a.kind === "slot" || b.kind === "slot") return true;
  if (a.kind === "structural_item" || b.kind === "structural_item") return key(a) === key(b);
  return a.featureId === b.featureId && (a.kind !== "feature_mechanism" || b.kind !== "feature_mechanism" || a.mechanismId === b.mechanismId);
}

type Context = {
  claims: EvidenceClaimV2[];
  invalidClaims: { raw: Record<string, unknown>; contractGaps: RequirementEvidenceGap[] }[];
  claimGaps: Map<EvidenceClaimV2, RequirementEvidenceGap[]>;
  contractGaps: RequirementEvidenceGap[];
  sources: Map<string, EvidenceSourceV2>;
  rawSources: Map<string, Record<string, unknown>>;
  evidence: Map<string, SourceEvidence>;
  conflicts: Conflict[];
};

function relevantConflicts(context: Context, targetId: string, subject: ProfileKnowledgeSubjectRef) {
  return context.conflicts.filter((conflict) => conflict.requirementEvidenceTargetRefs.some((ref) => ref.targetId === targetId) &&
    context.claims.some((claim) => conflict.claimRefs.includes(claim.claimId) &&
      claim.requirementEvidenceTargetRefs.some((ref) => ref.targetId === targetId) && claim.subjectRefs.some((ref) => overlapping(ref, subject))));
}

function assessClaim(claim: EvidenceClaimV2, target: RequirementEvidenceTarget, candidate: Candidate,
  policy: EffectiveRequirementEvidencePolicy, context: Context): RequirementEvidenceClaimEvaluation {
  const rejected: RequirementEvidenceReason[] = [...candidate.reasons];
  const contractGaps = context.claimGaps.get(claim) ?? [];
  if (contractGaps.length) rejected.push("claim_contract_invalid");
  const targetCorrect = claim.requirementEvidenceTargetRefs.some((ref) => ref.targetId === target.targetId && ref.catalogVersion === catalog.catalogVersion);
  const subjectCorrect = claim.subjectRefs.some((ref) => matchesSubject(ref, candidate));
  if (!targetCorrect) rejected.push("claim_wrong_target");
  if (!subjectCorrect) rejected.push("claim_wrong_subject");
  const assertions = (claim.subjectStateAssertions ?? []).filter((entry) => matchesSubject(entry.subjectRef, candidate));
  if (assertions.some((entry) => entry.state !== candidate.knowledge.state)) rejected.push("claim_state_mismatch");
  if (candidate.knowledge.state === "not_applicable" && !assertions.some((entry) => entry.state === "not_applicable" && key(entry.subjectRef) === key(candidate.subjectRef))) {
    rejected.push("not_applicable_unsubstantiated");
  }
  const confidenceValid = claim.confidence === baseline.minimumConfidence || claim.confidence === "high";
  if (!confidenceValid) rejected.push("claim_confidence_insufficient");
  const reviewValid = baseline.eligibleReviewStatuses.some((status) => status === claim.reviewStatus);
  if (!reviewValid) rejected.push("claim_review_status_ineligible");
  if (reviewValid && !policy.allowedReviewStatuses.includes(claim.reviewStatus)) rejected.push("target_policy_unsatisfied");
  const evidence = ordered(claim.evidenceRefs.map((ref): RequirementEvidenceSourceAssessment => {
    const entry = context.evidence.get(ref.evidenceRef);
    const source = entry ? context.sources.get(entry.sourceRef) : undefined;
    const problems: RequirementEvidenceReason[] = [];
    if (!entry || !source) {
      problems.push("source_missing");
      const raw = entry ? context.rawSources.get(entry.sourceRef) : undefined;
      if (raw) {
        problems.push("source_contract_invalid");
        if (!evidenceSourceV2Schema.shape.independenceKey.safeParse(raw.independenceKey).success) problems.push("source_independence_insufficient");
      }
    }
    return {
      evidenceRef: ref.evidenceRef, sourceRef: entry?.sourceRef ?? null,
      authoritative: !!source && baseline.authoritativeSourceClasses.some((authority) => authority === source.authorityClass),
      humanValidated: ref.relationshipValidation.status === "human_validated",
      reasons: reasons(problems),
    };
  }));
  rejected.push(...evidence.flatMap((entry) => entry.reasons));
  const sourceRefs = strings(evidence.flatMap((entry) => entry.sourceRef && context.sources.has(entry.sourceRef) ? [entry.sourceRef] : []));
  const authoritativeRefs = strings(evidence.filter((entry) => entry.authoritative).map((entry) => entry.sourceRef!));
  const humanRefs = strings(evidence.filter((entry) => entry.authoritative && entry.humanValidated).map((entry) => entry.sourceRef!));
  if (claim.reviewStatus === "human_reviewed") {
    if (authoritativeRefs.length < policy.humanReviewedMinimumAuthoritativeSources) rejected.push("source_authority_insufficient");
    if (humanRefs.length < policy.humanReviewedMinimumAuthoritativeSources) rejected.push("human_validation_missing");
    if (humanRefs.length < policy.humanReviewedMinimumAuthoritativeSources && policy.humanReviewedMinimumAuthoritativeSources > baseline.humanReviewedMinimumAuthoritativeSources) rejected.push("target_policy_unsatisfied");
  }
  const conflictRefs = relevantConflicts(context, target.targetId, candidate.subjectRef).filter((conflict) => conflict.resolutionStatus === "unresolved").map((conflict) => conflict.conflictId);
  if (targetCorrect && subjectCorrect && policy.openConflictBlocksCovered && conflictRefs.length) rejected.push("open_conflict");
  // Only an otherwise eligible cross-check can use an independence witness.
  // Preserve earlier rejection reasons; skipped does not assert insufficiency.
  const independence = claim.reviewStatus === "cross_checked" && rejected.length === 0
    ? independentSubset(sourceRefs.map((id) => context.sources.get(id)!), policy.crossCheckedMinimumIndependentSources)
    : { status: "skipped" as const, sourceRefs: [] };
  const independentSourceRefs = independence.sourceRefs;
  if (independence.status === "limit_exceeded") rejected.push("independence_evaluation_limit_exceeded");
  if (independence.status === "evaluated" && independentSourceRefs.length < policy.crossCheckedMinimumIndependentSources) {
    rejected.push("source_independence_insufficient");
    if (policy.crossCheckedMinimumIndependentSources > baseline.crossCheckedMinimumIndependentSources) rejected.push("target_policy_unsatisfied");
  }
  const baseUseful = candidate.reasons.length === 0 && targetCorrect && subjectCorrect && confidenceValid && reviewValid &&
    contractGaps.length === 0 && !evidence.some((entry) => entry.reasons.length > 0) &&
    !rejected.includes("claim_state_mismatch") && !rejected.includes("not_applicable_unsubstantiated") &&
    (claim.reviewStatus === "cross_checked" ? sourceRefs.length > 0 : humanRefs.length > 0);
  const accepted = rejected.length === 0;
  return {
    claimId: claim.claimId, targetId: target.targetId, subjectRef: candidate.subjectRef,
    accepted, usefulEvidence: baseUseful, reasons: reasons(rejected), evidence, sourceRefs,
    usedSourceRefs: accepted ? (claim.reviewStatus === "cross_checked" ? independentSourceRefs : humanRefs.slice(0, policy.humanReviewedMinimumAuthoritativeSources)) : [],
    independentSourceRefs, independenceEvaluation: independence.status, conflictRefs: strings(conflictRefs), contractGaps,
  };
}

function gap(reason: RequirementEvidenceReason, groupId: string | null = null, targetId: string | null = null,
  subjectRef: ProfileKnowledgeSubjectRef | null = null, claimRef: string | null = null,
  sourceRef: string | null = null, evidenceRef: string | null = null): RequirementEvidenceGap {
  return { reason, groupId, targetId, subjectRef, claimRef, sourceRef, evidenceRef };
}

function resolveSubject(groupId: string, target: RequirementEvidenceTarget, candidate: Candidate,
  policy: EffectiveRequirementEvidencePolicy, context: Context): RequirementEvidenceSubjectResolution {
  const related = context.claims.filter((claim) => claim.requirementEvidenceTargetRefs.some((ref) => ref.targetId === target.targetId) &&
    claim.subjectRefs.some((ref) => matchesSubject(ref, candidate)));
  const assessments = related.map((claim) => assessClaim(claim, target, candidate, policy, context));
  const acceptedClaims = ordered(assessments.filter((entry) => entry.accepted));
  const rejectedClaims = ordered(assessments.filter((entry) => !entry.accepted));
  const usefulEvidence = assessments.some((entry) => entry.usefulEvidence);
  const gaps = candidate.reasons.map((reason) => gap(reason, groupId, target.targetId, candidate.subjectRef));
  if (!related.some((claim) => claim.requirementEvidenceTargetRefs.some((ref) => ref.targetId === target.targetId) && claim.subjectRefs.some((ref) => matchesSubject(ref, candidate)))) {
    gaps.push(gap("claim_missing", groupId, target.targetId, candidate.subjectRef));
  }
  if (candidate.knowledge.state === "not_applicable" && !acceptedClaims.length) gaps.push(gap("not_applicable_unsubstantiated", groupId, target.targetId, candidate.subjectRef));
  for (const rejected of rejectedClaims) {
    gaps.push(...rejected.contractGaps.map((entry) => ({ ...entry, groupId, targetId: target.targetId })));
    gaps.push(...rejected.reasons.map((reason) => gap(reason, groupId, target.targetId, candidate.subjectRef, rejected.claimId)));
    for (const evidence of rejected.evidence) gaps.push(...evidence.reasons.map((reason) => gap(reason, groupId, target.targetId, candidate.subjectRef, rejected.claimId, evidence.sourceRef, evidence.evidenceRef)));
  }
  return {
    subjectRef: candidate.subjectRef, state: candidate.knowledge.state,
    status: acceptedClaims.length ? "covered" : usefulEvidence ? "partial" : "missing", usefulEvidence,
    claimEvaluations: ordered(assessments), sourceRefs: strings(acceptedClaims.flatMap((claim) => claim.usedSourceRefs)),
    conflictRefs: strings(relevantConflicts(context, target.targetId, candidate.subjectRef).map((conflict) => conflict.conflictId)),
    gaps: uniqueOrdered(gaps),
  };
}

/** Diagnose declarations that cannot ground this target, in their declared
 * context, never by rejecting the claim against an unclaimed sibling subject.
 * These evaluations are diagnostic only and do not enter subject coverage.
 */
function unmatchedEvaluations(target: RequirementEvidenceTarget, subjects: Candidate[],
  policy: EffectiveRequirementEvidencePolicy, context: Context): RequirementEvidenceClaimEvaluation[] {
  const result: RequirementEvidenceClaimEvaluation[] = [];
  for (const claim of context.claims) {
    if (!claim.requirementEvidenceTargetRefs.some((ref) => ref.targetId === target.targetId)) continue;
    const declared = claim.subjectRefs.filter((ref) => ref.kind !== "section" && ref.slot === target.subjectRef.slot);
    const unmatched = declared.filter((ref) => !subjects.some((subject) => matchesSubject(ref, subject)));
    for (const subjectRef of declared.length ? unmatched : [target.subjectRef]) {
      result.push(assessClaim(claim, target, {
        subjectRef, knowledge: subjects[0]!.knowledge,
        reasons: [...subjects[0]!.reasons, ...(declared.length ? ["claim_wrong_subject" as const] : ["claim_wrong_subject" as const, "claim_wrong_target" as const])],
      }, policy, context));
    }
  }
  for (const { raw: invalid, contractGaps } of context.invalidClaims) {
    if (!array(invalid.requirementEvidenceTargetRefs).some((ref) => record(ref).targetId === target.targetId)) continue;
    const declared = array(invalid.subjectRefs).flatMap((raw) => {
      const ref = profileKnowledgeSubjectRefSchema.safeParse(raw);
      return ref.success && ref.data.kind !== "section" && ref.data.slot === target.subjectRef.slot ? [ref.data] : [];
    });
    const identity = domainIdSchema.safeParse(invalid.claimId);
    for (const subjectRef of declared.length ? declared : [target.subjectRef]) result.push({
      claimId: identity.success ? identity.data : null, targetId: target.targetId, subjectRef,
      accepted: false, usefulEvidence: false, reasons: ["claim_contract_invalid"], evidence: [], sourceRefs: [],
      usedSourceRefs: [], independentSourceRefs: [], conflictRefs: [], independenceEvaluation: "skipped", contractGaps,
    });
  }
  return ordered(result);
}

function summarizeClaims(evaluations: RequirementEvidenceClaimEvaluation[]): RequirementEvidenceClaimSummary[] {
  const byClaim = new Map<string, RequirementEvidenceClaimEvaluation[]>();
  for (const evaluation of evaluations) {
    // Malformed IDs have localized evaluations/gaps, never an invented ID that
    // could collide with another claim's real identity.
    if (evaluation.claimId === null) continue;
    const entries = byClaim.get(evaluation.claimId) ?? [];
    entries.push(evaluation);
    byClaim.set(evaluation.claimId, entries);
  }
  return ordered([...byClaim].map(([claimId, entries]): RequirementEvidenceClaimSummary => {
    const accepted = entries.some((entry) => entry.accepted);
    const rejected = entries.some((entry) => !entry.accepted);
    return {
      claimId, status: accepted ? rejected ? "partially_accepted" : "accepted" : "rejected",
      usefulEvidence: entries.some((entry) => entry.usefulEvidence),
      reasons: reasons(entries.flatMap((entry) => entry.reasons)),
      contractGaps: uniqueOrdered(entries.flatMap((entry) => entry.contractGaps)), evaluations: ordered(entries),
    };
  }));
}

/** Paths refer to this canonical registry order, with IDs retained in each gap. */
function canonicalRegistry(profile: Record<string, unknown>): Record<string, unknown> {
  // ID-bearing knowledge collections are sets. Canonicalize diagnostic offsets
  // without changing ordered linguistic values or the caller's objects.
  const knowledge = { ...record(profile.knowledge) };
  for (const slot of profileKnowledgeSlotIdSchema.options) {
    const [section, field] = slot.split(".") as [string, string];
    const wrapper = record(record(knowledge[section])[field]);
    if (!("value" in wrapper)) continue;
    const canonicalEntry = (raw: unknown) => {
      const entry = record(raw);
      const fields = ["mechanisms", ...(slot === "writingSystem.scripts" ? ["coexistsWith"] : []),
        ...(slot === "writingSystem.transliterationSystems" ? ["targetScriptRefs"] : []),
        ...(slot === "writingSystem.primaryScriptStrategy" ? ["scriptRefs"] : [])];
      const sets = fields.filter((field) => Array.isArray(entry[field]));
      return sets.length ? { ...entry, ...Object.fromEntries(sets.map((field) => [field, ordered(array(entry[field]))])) } : raw;
    };
    const value = Array.isArray(wrapper.value) && (slot === "identity.scriptScope" ||
      wrapper.value.some((entry) => ["featureId", "mechanismId", "scriptId", "systemId"].some((id) => id in record(entry))))
      ? ordered(wrapper.value.map(canonicalEntry)) : canonicalEntry(wrapper.value);
    knowledge[section] = { ...record(knowledge[section]), [field]: { ...wrapper, value } };
  }
  profile = { ...profile, ...(profile.knowledge && typeof profile.knowledge === "object" && !Array.isArray(profile.knowledge) ? { knowledge } : {}) };
  if (!profile.evidenceRegistry || typeof profile.evidenceRegistry !== "object" || Array.isArray(profile.evidenceRegistry)) return profile;
  const registry = { ...record(profile.evidenceRegistry) };
  for (const field of ["sources", "evidence", "claims", "conflicts"]) {
    if (!Array.isArray(registry[field])) continue;
    registry[field] = ordered(array(registry[field]).map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const entry = { ...record(raw) };
      for (const refs of ["subjectRefs", "subjectStateAssertions", "evidenceRefs", "requirementEvidenceTargetRefs", "requirementRefs", "claimRefs"]) {
        if (Array.isArray(entry[refs])) entry[refs] = ordered(entry[refs]);
      }
      return entry;
    }));
  }
  return { ...profile, evidenceRegistry: registry };
}

function contractGap(profile: Record<string, unknown>, issue: z.ZodIssue): RequirementEvidenceGap {
  const [root, collection, index, field, refIndex] = issue.path;
  const entry = root === "evidenceRegistry" && typeof collection === "string" && typeof index === "number"
    ? record(array(record(profile.evidenceRegistry)[collection])[index]) : {};
  const ref = typeof field === "string" && typeof refIndex === "number" ? record(array(entry[field])[refIndex]) : {};
  const subject = profileKnowledgeSubjectRefSchema.safeParse(issue.code === "custom" && issue.params?.subjectRef
    ? issue.params.subjectRef : field === "subjectStateAssertions" ? ref.subjectRef : ref);
  return {
    ...gap(collection === "claims" ? "claim_contract_invalid" : "profile_contract_invalid", null,
      field === "requirementEvidenceTargetRefs" ? textOrNull(ref.targetId) : null,
      subject.success ? subject.data : null, textOrNull(entry.claimId),
      textOrNull(entry.sourceId ?? entry.sourceRef), textOrNull(entry.evidenceId ?? ref.evidenceRef)),
    validationIssue: zodIssuesToValidationIssues(new z.ZodError([issue]))[0]!,
  };
}

/** Attribute necessary ancestors using path segments, not textual slot prefixes.
 * Precise identity subjects retain their existing overlap semantics. Unlocalized
 * errors inside a slot retain the existing slot-level structural validation;
 * they are not promoted to other slots or enclosing section subjects.
 */
function doesValidationIssueAffectSubject(issue: z.ZodIssue, subject: ProfileKnowledgeSubjectRef): boolean {
  if (issue.path[0] !== "knowledge") return false;
  const located = issue.code === "custom" ? profileKnowledgeSubjectRefSchema.safeParse(issue.params?.subjectRef) : null;
  if (located?.success) return profileSubjectsOverlap(subject, located.data);
  const subjectPath = subject.kind === "section"
    ? ["knowledge", subject.section] : ["knowledge", ...subject.slot.split(".")];
  if (issue.path.length <= subjectPath.length) {
    return issue.path.every((segment, index) => segment === subjectPath[index]);
  }
  return subject.kind !== "section" && subjectPath.every((segment, index) => segment === issue.path[index]);
}

function prepare(profile: Record<string, unknown>, profileIssues: z.ZodIssue[]): Context {
  const registry = record(profile.evidenceRegistry);
  const rawSources = new Map<string, Record<string, unknown>>();
  const sources = new Map<string, EvidenceSourceV2>();
  const evidence = new Map<string, SourceEvidence>();
  for (const raw of ordered(array(registry.sources))) {
    const source = record(raw);
    if (typeof source.sourceId === "string") rawSources.set(source.sourceId, source);
    const parsed = evidenceSourceV2Schema.safeParse(raw);
    if (parsed.success) sources.set(parsed.data.sourceId, parsed.data);
  }
  for (const raw of ordered(array(registry.evidence))) {
    const parsed = sourceEvidenceV2Schema.safeParse(raw);
    if (parsed.success) evidence.set(parsed.data.evidenceId, parsed.data);
  }
  const claims: EvidenceClaimV2[] = [];
  const invalidClaims: Context["invalidClaims"] = [];
  const claimGaps: Context["claimGaps"] = new Map();
  const issues = [...profileIssues, ...evidenceRegistryReferencesV2Issues(registry), ...profileKnowledgeIntegrityIssues(profile.knowledge)];
  const evidenceIds = new Set(evidence.keys());
  const claimIndexes = new Map<EvidenceClaimV2, number>();
  for (const [index, raw] of array(registry.claims).entries()) {
    const parsed = evidenceClaimV2Schema.safeParse(raw);
    const errors = parsed.success ? evidenceClaimReferencesV2Issues(parsed.data, profile.knowledge, evidenceIds) : parsed.error.issues;
    const located = errors.map((issue) => ({ ...issue, path: ["evidenceRegistry", "claims", index, ...issue.path] }));
    issues.push(...located);
    if (parsed.success) {
      claims.push(parsed.data);
      claimIndexes.set(parsed.data, index);
    } else invalidClaims.push({ raw: record(raw), contractGaps: located.map((issue) => contractGap(profile, issue)) });
  }
  const contractGaps = uniqueOrdered(issues.map((issue) => contractGap(profile, issue)));
  for (const claim of claims) {
    const evidenceRefs = new Set(claim.evidenceRefs.map((ref) => ref.evidenceRef));
    const sourceRefs = new Set(claim.evidenceRefs.map((ref) => evidence.get(ref.evidenceRef)?.sourceRef));
    const applicable = issues.filter((issue) => {
      const { path } = issue;
      const [root, collection, index] = path;
      if (root === "evidenceRegistry") {
        if (collection === "claims") return index === claimIndexes.get(claim);
        const entry = typeof collection === "string" && typeof index === "number" ? record(array(registry[collection])[index]) : {};
        if (collection === "evidence") return evidenceRefs.has(textOrNull(entry.evidenceId)?.trim() ?? "");
        if (collection === "sources") return sourceRefs.has(textOrNull(entry.sourceId)?.trim() ?? "");
      }
      return claim.subjectRefs.some((ref) => doesValidationIssueAffectSubject(issue, ref));
    });
    claimGaps.set(claim, uniqueOrdered(applicable.map((issue) => ({ ...contractGap(profile, issue), claimRef: claim.claimId }))));
  }
  const conflicts: Conflict[] = [];
  for (const raw of array(registry.conflicts)) {
    const parsed = evidenceConflictV2Schema.safeParse(raw);
    if (parsed.success) conflicts.push({ ...parsed.data, claimRefs: strings(parsed.data.claimRefs), requirementEvidenceTargetRefs: ordered(parsed.data.requirementEvidenceTargetRefs) });
  }
  return { claims, invalidClaims, claimGaps, contractGaps, sources, rawSources, evidence, conflicts: ordered(conflicts) };
}

/** Pure, deterministic boundary. Invalid profiles are diagnosed, never promoted.
 * Invalid requirements/options throw ZodError; no fallback domain or weak policy.
 */
export function resolveRequirementEvidence(
  requirementInput: RequirementEvidenceInput,
  languageProfileV2: unknown,
  optionsInput: RequirementEvidenceOptions = {},
): RequirementEvidenceResolution {
  const requirement = requirementEvidenceInputSchema.parse(requirementInput);
  const options = requirementEvidenceOptionsSchema.parse(optionsInput);
  const mode = options.mode ?? "durable";
  const raw = record(languageProfileV2);
  // Explicitly ignored historical summary; it never enters the evidence engine.
  const { profileCoverage: _historicalSummary, ...withoutSummary } = raw;
  void _historicalSummary;
  const profile = canonicalRegistry(withoutSummary);
  const identity = record(profile.identity);
  const supported = profile.schemaVersion === LANGUAGE_PROFILE_V2_SCHEMA_VERSION;
  const validation = supported ? languageProfileV2Schema.safeParse(profile) : null;
  const supportedProfile = supported ? profile : {};
  const context = prepare(supportedProfile, validation && !validation.success ? validation.error.issues : []);
  const profileGaps: RequirementEvidenceGap[] = [];
  if (!supported) profileGaps.push(gap("unsupported_schema_version"));
  else if (!validation?.success) profileGaps.push(gap("profile_contract_invalid"), ...context.contractGaps);
  if (mode === "durable" && profile.status !== "canonical") profileGaps.push(gap("profile_not_canonical"));
  const groups: RequirementEvidenceGroupResolution[] = catalog.domains.find((entry) => entry.domain === requirement.domain)!.groups.map((group: RequirementEvidenceTargetGroup) => {
    const targets = group.targets.map((target): RequirementEvidenceTargetResolution => {
      const restriction = options.targetPolicies?.find((entry) => entry.targetRef.targetId === target.targetId)?.policy;
      const policy = effectivePolicy(target.policy, restriction);
      const targetCandidates = candidates(supportedProfile, target);
      const subjects = targetCandidates.map((candidate) => resolveSubject(group.groupId, target, candidate, policy, context));
      const claimEvaluations = ordered([...subjects.flatMap((subject) => subject.claimEvaluations), ...unmatchedEvaluations(target, targetCandidates, policy, context)]);
      const usefulEvidence = subjects.some((subject) => subject.usefulEvidence);
      return { targetId: target.targetId, policy, status: subjects.some((subject) => subject.status === "covered") ? "covered" : usefulEvidence ? "partial" : "missing", usefulEvidence, subjects, claimEvaluations };
    });
    const covered = group.aggregation === "all" ? targets.every((target) => target.status === "covered") : targets.some((target) => target.status === "covered");
    return { groupId: group.groupId, requirement: group.requirement, aggregation: group.aggregation, status: covered ? "covered" : targets.some((target) => target.usefulEvidence) ? "partial" : "missing", targets };
  });
  const required = groups.filter((group) => group.requirement === "required");
  const useful = required.some((group) => group.targets.some((target) => target.usefulEvidence));
  const status: RequirementEvidenceStatus = required.every((group) => group.status === "covered") && profileGaps.length === 0 ? "covered" : useful ? "partial" : "missing";
  const subjects = groups.flatMap((group) => group.targets.flatMap((target) => target.subjects));
  const claimEvaluations = ordered(groups.flatMap((group) => group.targets.flatMap((target) => target.claimEvaluations)));
  const summaries = summarizeClaims(claimEvaluations);
  const conflictIds = new Set(subjects.flatMap((subject) => subject.conflictRefs));
  return {
    requirementRef: requirement.requirementRef, domain: requirement.domain,
    profileId: textOrNull(identity.profileId), languageId: textOrNull(identity.languageId), varietyId: textOrNull(identity.varietyId),
    profileVersion: textOrNull(profile.version), schemaVersion: textOrNull(profile.schemaVersion), targetCatalogVersion: catalog.catalogVersion,
    mode, durableConsumable: mode === "durable" && profile.status === "canonical" && status === "covered", status, groups,
    claimEvaluations, acceptedClaims: summaries.filter((claim) => claim.status !== "rejected"), rejectedClaims: summaries.filter((claim) => claim.status === "rejected"),
    sourcesUsed: strings(claimEvaluations.flatMap((claim) => claim.usedSourceRefs)).map((id) => context.sources.get(id)!),
    conflicts: context.conflicts.filter((conflict) => conflictIds.has(conflict.conflictId)),
    gaps: uniqueOrdered([...profileGaps, ...subjects.flatMap((subject) => subject.gaps),
      ...groups.flatMap((group) => group.targets.flatMap((target) => target.claimEvaluations.flatMap((evaluation) => [
        ...evaluation.reasons.map((reason) => gap(reason, group.groupId, target.targetId, evaluation.subjectRef, evaluation.claimId)),
        ...evaluation.contractGaps.map((entry) => ({ ...entry, groupId: group.groupId, targetId: target.targetId })),
      ]))),
    ]),
  };
}
