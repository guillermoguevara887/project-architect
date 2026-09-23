import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import { profileFeatureSlotIdSchema, profileKnowledgeSectionsV2Schema, profileKnowledgeSlotValue,
  type ProfileKnowledgeSectionsV2, type ProfileKnowledgeSlotId, type ProfileKnowledgeSubjectRef } from "../profile/profile-knowledge-v2.js";
import { candidateResearchProvenanceV2Schema, type CandidateResearchProvenanceV2 } from "../profile/candidate-research-provenance-v2.js";
import type { LanguageProfileV2 } from "../profile/language-profile-v2.js";
import { REQUIREMENT_EVIDENCE_TARGET_CATALOG, requirementEvidenceTarget, type RequirementEvidenceTargetRef } from "../profile/requirement-evidence-targets.js";
import { resolveRequirementEvidence, type RequirementEvidenceInput, type RequirementEvidenceOptions,
  type RequirementEvidenceResolution } from "../profile/requirement-evidence.js";
import type { ProfileResearchResultV2 } from "./contracts-v2.js";

type Path = (string | number)[];
type Mapping = CandidateResearchProvenanceV2["findings"][number]["knowledgeChanges"][number] & { findingRef: string };
type ScopedResearch = {
  findings: Pick<ProfileResearchResultV2["findings"][number], "findingId" | "subjectRefs" | "knowledgeChanges">[];
  knowledgeAddition: ProfileResearchResultV2["knowledgeAddition"];
};

/** M14 can propose evidence, but it cannot perform the human epistemic work it
 * proposes. This constructor is shared by the producer and lifecycle replay so
 * a resealed candidate cannot grant itself a stronger review state. */
export const M14_RESEARCH_CLAIM_REVIEW_STATUS_V2 = "needs_review" as const;
export function m14ResearchClaimEpistemicStateV2(evidenceRefs: readonly string[]) {
  return {
    reviewStatus: M14_RESEARCH_CLAIM_REVIEW_STATUS_V2,
    evidenceRefs: evidenceRefs.map((evidenceRef) => ({
      evidenceRef, relationshipValidation: { status: "unvalidated" as const },
    })),
  };
}

/** A new research claim must retain exactly the producer's epistemic state.
 * Historical claims are protected separately by the parent prefix check. */
function researchClaimEpistemicStateIssueV2(
  claim: LanguageProfileV2["evidenceRegistry"]["claims"][number], evidenceRefs: readonly string[],
): string | null {
  const expected = m14ResearchClaimEpistemicStateV2(evidenceRefs);
  if (claim.reviewStatus !== expected.reviewStatus) return "New research claims must remain needs_review";
  if (!isDeepStrictEqual(claim.evidenceRefs, expected.evidenceRefs)) {
    return "New research evidence relationships must remain exactly unvalidated";
  }
  return null;
}

const TARGET_NOT_ADDRESSED_REASONS = new Set([
  "subject_missing", "subject_unknown", "subject_invalid", "subject_relevance_missing",
  "claim_wrong_target", "claim_wrong_subject", "claim_state_mismatch", "not_applicable_unsubstantiated",
]);

/** Shared producer/lifecycle interpretation of S2 applicability. Review status
 * intentionally does not participate: M14 claims are pending. Each mapped
 * change must fall under an applicable S2 subject for its own finding. */
export function researchTargetApplicabilityIssueV2(
  preview: RequirementEvidenceResolution, target: RequirementEvidenceTargetRef,
  findings: readonly { findingRef: string; claimId: string }[], changes: readonly Mapping[], initializingSlot: boolean,
): string | null {
  const targetPreview = preview.groups.flatMap((group) => group.targets).find((entry) => entry.targetId === target.targetId);
  if (!targetPreview) return "Research finding does not address the exact authorized target";
  for (const finding of findings) {
    const applicable = targetPreview.claimEvaluations.filter((evaluation) =>
      evaluation.claimId === finding.claimId && !evaluation.reasons.some((reason) => TARGET_NOT_ADDRESSED_REASONS.has(reason)));
    if (!applicable.length) return "Research finding does not address the exact authorized target";
    for (const change of changes.filter((entry) => entry.findingRef === finding.findingRef)) {
      // S2 may address an entire slot/feature, or one relevant mechanism. A
      // broad claim ref cannot lend the latter's applicability to a sibling.
      const addressed = applicable.some((evaluation) => contains(evaluation.subjectRef, change.subject));
      // When M14 initializes an unknown feature, its feature-level fields are
      // structural context for an applicable mechanism in that same feature.
      const initialFeature = initializingSlot && change.subject.kind === "feature" && applicable.some((evaluation) =>
        contains(change.subject, evaluation.subjectRef));
      if (!addressed && !initialFeature) return "Research change does not address the exact authorized target";
    }
  }
  if (changes.some((change) => !findings.some((finding) => finding.findingRef === change.findingRef))) {
    return "Research change has no finding";
  }
  return null;
}

/** The existing producer contract for NEW conflicts, shared with lifecycle.
 * Callers validate S1 shapes first; historical conflicts are not reauthorized. */
export function researchConflictIssueV2(existingClaims: LanguageProfileV2["evidenceRegistry"]["claims"], proposedClaimIds: ReadonlySet<string>,
  target: RequirementEvidenceTargetRef, conflicts: LanguageProfileV2["evidenceRegistry"]["conflicts"], hasKnowledgeChanges: boolean):
  { reason: "invalid_conflict" | "conflicting_knowledge"; message: string } | null {
  for (const conflict of conflicts) {
    if (conflict.resolutionStatus !== "unresolved") return { reason: "invalid_conflict", message: "New research conflicts must be unresolved" };
    if (!conflict.requirementEvidenceTargetRefs.every((ref) => ref.targetId === target.targetId) ||
      !conflict.claimRefs.some((ref) => proposedClaimIds.has(ref)) || conflict.claimRefs.some((ref) => !proposedClaimIds.has(ref) &&
        !existingClaims.some((claim) => claim.claimId === ref && claim.requirementEvidenceTargetRefs.some((t) => t.targetId === target.targetId)))) {
      return { reason: "invalid_conflict", message: "Conflict must involve proposed findings and exact-target claims" };
    }
  }
  return conflicts.length && hasKnowledgeChanges
    ? { reason: "conflicting_knowledge", message: "Research cannot combine new conflicts with knowledge changes" } : null;
}
type Tree = string | Tree[] | { [key: string]: Tree };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** No overwrite, removals, reordering or inferred facts. Numeric components are
 * S1 array positions, never arbitrary object keys. Sparse arrays fail S1. */
function insert(tree: Tree | undefined, path: Path, value: Tree): Tree {
  if (!path.length) {
    if (tree !== undefined) throw new Error("Existing knowledge cannot be replaced");
    return structuredClone(value);
  }
  const [head, ...tail] = path;
  const result = tree ?? (typeof head === "number" ? [] : {});
  if (typeof head === "number") {
    if (!Array.isArray(result)) throw new Error("Expected an array position");
    result[head] = insert(result[head], tail, value);
  } else {
    if (!object(result) || head === undefined) throw new Error("Expected a named S1 field");
    result[head] = insert(Object.hasOwn(result, head) ? result[head] as Tree : undefined, tail, value);
  }
  return result;
}

function leaves(value: unknown, path: Path = []): { path: Path; value: unknown }[] {
  if (Array.isArray(value)) return value.length ? value.flatMap((item, i) => leaves(item, [...path, i])) : [{ path, value }];
  if (object(value)) return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
  return [{ path, value }];
}

/** The finest existing S1 subject containing a concrete scalar/list assertion. */
export function researchChangeSubject(slot: ProfileKnowledgeSlotId, value: unknown, path: Path): ProfileKnowledgeSubjectRef {
  let item = value, rest = path;
  if (Array.isArray(value)) { item = value[path[0] as number]; rest = path.slice(1); }
  if (profileFeatureSlotIdSchema.safeParse(slot).success && object(item)) {
    const featureSlot = profileFeatureSlotIdSchema.parse(slot), featureId = item.featureId as string;
    if (rest[0] === "mechanisms" && typeof rest[1] === "number" && Array.isArray(item.mechanisms)) {
      return { kind: "feature_mechanism", slot: featureSlot, featureId, mechanismId: item.mechanisms[rest[1]]!.mechanismId as string };
    }
    return { kind: "feature", slot: featureSlot, featureId };
  }
  if (object(item) && (slot === "writingSystem.scripts" || slot === "writingSystem.transliterationSystems" || slot === "clauseStructure.argumentMarkingMechanisms")) {
    return { kind: "structural_item", slot, itemId: (item.scriptId ?? item.systemId ?? item.mechanismId) as string };
  }
  return { kind: "slot", slot };
}

function contains(parent: ProfileKnowledgeSubjectRef, child: ProfileKnowledgeSubjectRef): boolean {
  if (parent.kind === "section" || child.kind === "section" || parent.slot !== child.slot) return false;
  if (parent.kind === "slot") return true;
  if (parent.kind === "feature") return (child.kind === "feature" || child.kind === "feature_mechanism") && child.featureId === parent.featureId;
  return isDeepStrictEqual(parent, child);
}

/** The optional provider blob is an assertion to compare, never patch authority.
 * Every inserted leaf (including an empty collection) comes from a finding. */
export function buildScopedKnowledgeV2(knowledge: ProfileKnowledgeSectionsV2, slot: ProfileKnowledgeSlotId, research: ScopedResearch):
  { ok: true; value?: unknown; mapping: Mapping[] } | { ok: false; issues: string[] } {
  const fail = (message: string) => ({ ok: false as const, issues: [message] });
  const entries = research.findings.flatMap((finding) => (finding.knowledgeChanges ?? []).map((change) => ({ finding, change })));
  const assertion = research.knowledgeAddition;
  if (!entries.length) return assertion ? fail(`Overbroad knowledge.${slot}: no explicit finding changes`) : { ok: true, mapping: [] };
  const prior = profileKnowledgeSlotValue(knowledge, slot);
  if (prior.state === "not_applicable") return fail(`knowledge.${slot}: non-applicability replacement requires human review`);
  const [section, field] = slot.split(".") as [keyof ProfileKnowledgeSectionsV2, string];
  const schema = (profileKnowledgeSectionsV2Schema.shape[section].shape as Record<string, z.ZodTypeAny>)[field]!;
  let value = prior.state === "known" ? structuredClone(prior.value) as Tree : undefined;
  const ids = new Set<string>(), paths: Path[] = [];
  for (const { change } of entries) {
    const overlaps = paths.some((path) => path.slice(0, change.path.length).every((part, i) => part === change.path[i]) && path.length >= change.path.length ||
      change.path.slice(0, path.length).every((part, i) => part === path[i]) && change.path.length >= path.length);
    if (ids.has(change.changeId) || overlaps) return fail(`Ambiguous/duplicate change ${change.changeId} at knowledge.${slot}.${change.path.join(".")}`);
    ids.add(change.changeId); paths.push(change.path);
    try { value = insert(value, change.path, change.value); }
    catch (error) { return fail(`${change.changeId} at knowledge.${slot}.${change.path.join(".")}: ${(error as Error).message}`); }
  }
  const checked = schema.safeParse({ state: "known", value });
  if (!checked.success) return fail(`Invalid scoped knowledge.${slot}: ${checked.error.message}`);
  value = checked.data.value as Tree;
  const normalizedLeaves = leaves(value);
  const mapping: Mapping[] = [];
  for (const { finding, change } of entries) {
    const leaf = normalizedLeaves.find((entry) => isDeepStrictEqual(entry.path, change.path));
    if (!leaf || !isDeepStrictEqual(leaf.value, change.value)) return fail(`Change ${change.changeId} is not an exact S1 value assertion`);
    const subject = researchChangeSubject(slot, value, change.path);
    if (!finding.subjectRefs.some((ref) => contains(ref, subject))) return fail(`Change ${change.changeId} outside finding ${finding.findingId} subjects`);
    mapping.push({ findingRef: finding.findingId, changeId: change.changeId, slot, path: [...change.path], subject });
  }
  if (assertion) {
    const declared = schema.safeParse({ state: "known", value: assertion.value });
    if (!declared.success) return fail(`Invalid asserted knowledge.${slot}: ${declared.error.message}`);
    if (!isDeepStrictEqual(declared.data.value, value)) {
      const extra = leaves(declared.data.value).find((leaf) => !normalizedLeaves.some((entry) => isDeepStrictEqual(entry, leaf)));
      return fail(`Overbroad knowledge.${slot}.${extra?.path.join(".") ?? "value"}: asserted change has no matching finding authorization`);
    }
    const refs = new Set(entries.map(({ finding }) => finding.findingId));
    if (assertion.findingRefs.length !== refs.size || assertion.findingRefs.some((ref) => !refs.has(ref))) return fail("Knowledge assertion findingRefs must match actual change authors");
    assertion.value = structuredClone(value);
  }
  return { ok: true, value, mapping };
}

/** Shared by proposal construction and durable validation. Only the knowledge
 * patch changes in this preview; added research claims are not sibling authority. */
export function researchSharedSlotEffectsV2(parent: LanguageProfileV2, knowledge: ProfileKnowledgeSectionsV2, version: string,
  requirement: RequirementEvidenceInput, target: RequirementEvidenceTargetRef, options?: RequirementEvidenceOptions): CandidateResearchProvenanceV2["sharedSlotEffects"] {
  if (isDeepStrictEqual(parent.knowledge, knowledge)) return [];
  const slot = requirementEvidenceTarget(target).subjectRef.slot;
  const profile = { ...parent, status: "review", version, knowledge };
  return REQUIREMENT_EVIDENCE_TARGET_CATALOG.domains.flatMap(({ domain, groups }) => {
    const siblings = groups.flatMap((group) => group.targets).filter((entry) => entry.subjectRef.slot === slot && entry.targetId !== target.targetId);
    if (!siblings.length) return [];
    const siblingRequirement = { ...requirement, domain };
    const before = resolveRequirementEvidence(siblingRequirement, parent, { ...options, mode: "preview" });
    const after = resolveRequirementEvidence(siblingRequirement, profile, { ...options, mode: "preview" });
    return siblings.map((entry) => ({ domain, targetId: entry.targetId,
      before: before.groups.flatMap((group) => group.targets).find((item) => item.targetId === entry.targetId)!.status,
      after: after.groups.flatMap((group) => group.targets).find((item) => item.targetId === entry.targetId)!.status }));
  });
}

/** Verify M14's existing additive contract by replay, not a generic JSON diff.
 * The candidate supplies proposed leaf values, NEVER authority to copy a slot.
 * Every declared leaf must be insertable into the parent under its own claim's
 * subjects; the reconstructed knowledge must equal ALL candidate knowledge. */
export function reconcileResearchKnowledgeV2(parent: LanguageProfileV2, profile: LanguageProfileV2, rawProvenance: unknown): string | null {
  const parsed = candidateResearchProvenanceV2Schema.safeParse(rawProvenance);
  if (!parsed.success) return "Invalid research provenance";
  const provenance = parsed.data, slot = requirementEvidenceTarget(provenance.gap.target).subjectRef.slot;
  // M14 only appends registry records. Preserve prior evidence and reconcile
  // new claims/evidence by ID, rather than comparing lifecycle/version metadata.
  for (const kind of ["sources", "evidence", "claims", "conflicts"] as const) {
    if (!isDeepStrictEqual(profile.evidenceRegistry[kind].slice(0, parent.evidenceRegistry[kind].length), parent.evidenceRegistry[kind])) return `Research cannot rewrite existing ${kind}`;
  }
  const newClaims = profile.evidenceRegistry.claims.slice(parent.evidenceRegistry.claims.length);
  const newEvidence = profile.evidenceRegistry.evidence.slice(parent.evidenceRegistry.evidence.length);
  const mappedEvidence = provenance.findings.flatMap((finding) => finding.evidence.map((entry) => entry.evidenceRef));
  if (newClaims.length !== provenance.findings.length || newClaims.some((claim) => !provenance.findings.some((finding) => finding.claimRef === claim.claimId)) ||
    newEvidence.length !== mappedEvidence.length || newEvidence.some((entry) => !mappedEvidence.includes(entry.evidenceId))) return "Research findings do not account for all new claims/evidence";
  const usedSources = new Set(provenance.findings.flatMap((finding) => finding.evidence.map((entry) => entry.sourceRef)));
  if (profile.evidenceRegistry.sources.slice(parent.evidenceRegistry.sources.length).some((source) => !usedSources.has(source.sourceId))) return "Unmapped research source";
  const value = profileKnowledgeSlotValue(profile.knowledge, slot);
  const findings: ScopedResearch["findings"] = [], declared: Mapping[] = [];
  const claimIds = new Set<string>();
  for (const finding of provenance.findings) {
    const claim = profile.evidenceRegistry.claims.find((entry) => entry.claimId === finding.claimRef);
    if (!claim || claimIds.has(claim.claimId) || parent.evidenceRegistry.claims.some((entry) => entry.claimId === claim.claimId) ||
      claim.subjectRefs.some((ref) => ref.kind === "section" || ref.slot !== slot) ||
      claim.requirementEvidenceTargetRefs.some((ref) => !isDeepStrictEqual(ref, provenance.gap.target)) ||
      claim.evidenceRefs.length !== finding.evidence.length || claim.evidenceRefs.some((ref) => !finding.evidence.some((entry) => entry.evidenceRef === ref.evidenceRef))) return "Research finding must identify its own new exact-target claim";
    const epistemicIssue = researchClaimEpistemicStateIssueV2(claim, finding.evidence.map((entry) => entry.evidenceRef));
    if (epistemicIssue) return epistemicIssue;
    claimIds.add(claim.claimId);
    const knowledgeChanges: NonNullable<ScopedResearch["findings"][number]["knowledgeChanges"]> = [];
    for (const change of finding.knowledgeChanges) {
      let leaf = value.value;
      for (const part of change.path) {
        if (Array.isArray(leaf) ? typeof part !== "number" : !object(leaf) || typeof part !== "string") return `Invalid research address ${change.changeId}`;
        leaf = (leaf as Record<string | number, unknown>)[part];
      }
      if (value.state !== "known" || !(typeof leaf === "string" || Array.isArray(leaf) && leaf.length === 0)) return `Research change ${change.changeId} must resolve to a snapshot leaf`;
      knowledgeChanges.push({ changeId: change.changeId, path: change.path, value: typeof leaf === "string" ? leaf : [] });
      declared.push({ ...change, findingRef: finding.findingRef });
    }
    findings.push({ findingId: finding.findingRef, subjectRefs: claim.subjectRefs, knowledgeChanges });
  }
  const conflictIssue = researchConflictIssueV2(parent.evidenceRegistry.claims, claimIds, provenance.gap.target,
    profile.evidenceRegistry.conflicts.slice(parent.evidenceRegistry.conflicts.length), declared.length > 0);
  if (conflictIssue) return conflictIssue.message;
  const replay = buildScopedKnowledgeV2(parent.knowledge, slot, { findings, knowledgeAddition: null });
  if (!replay.ok) return replay.issues.join("; ");
  const order = (entries: Mapping[]) => [...entries].sort((a, b) => a.changeId.localeCompare(b.changeId));
  if (!isDeepStrictEqual(order(replay.mapping), order(declared))) return "Research change subject/finding does not match the actual snapshot location";
  const expected = structuredClone(parent.knowledge);
  if (replay.mapping.length) {
    const [section, field] = slot.split(".") as [keyof ProfileKnowledgeSectionsV2, string];
    (expected[section] as Record<string, unknown>)[field] = { state: "known", value: replay.value };
  }
  if (!isDeepStrictEqual(expected, profile.knowledge)) return "Candidate knowledge contains an unmapped or non-additive change";
  if (!isDeepStrictEqual(parent.identity, profile.identity)) return "Research cannot change profile identity";
  const preview = resolveRequirementEvidence(provenance.gap.requirement, profile, { ...provenance.gap.options, mode: "preview" });
  const applicabilityIssue = researchTargetApplicabilityIssueV2(preview, provenance.gap.target,
    provenance.findings.map((finding) => ({ findingRef: finding.findingRef, claimId: finding.claimRef })), replay.mapping,
    profileKnowledgeSlotValue(parent.knowledge, slot).state !== "known");
  if (applicabilityIssue) return applicabilityIssue;
  const effects = researchSharedSlotEffectsV2(parent, expected, profile.version, provenance.gap.requirement, provenance.gap.target, provenance.gap.options);
  if (!isDeepStrictEqual(effects, provenance.sharedSlotEffects)) return "Shared-slot effects do not match the authorized knowledge delta";
  return null;
}
