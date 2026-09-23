import { languageProfileV2Schema, type LanguageProfileV2 } from "../profile/language-profile-v2.js";
import { profileKnowledgeSlotValue } from "../profile/profile-knowledge-v2.js";
import { candidateResearchProvenanceV2Schema, type CandidateResearchProvenanceV2 } from "../profile/candidate-research-provenance-v2.js";
import { requirementEvidenceTarget } from "../profile/requirement-evidence-targets.js";
import { resolveRequirementEvidence, type RequirementEvidenceResolution } from "../profile/requirement-evidence.js";
import { profileResearchResultV2Schema, researchDigestV2, type ControlledResearchInputV2, type M13GapV2, type ProfileResearchResultV2 } from "./contracts-v2.js";
import { buildScopedKnowledgeV2, m14ResearchClaimEpistemicStateV2, researchConflictIssueV2,
  researchSharedSlotEffectsV2, researchTargetApplicabilityIssueV2 } from "./scoped-knowledge-v2.js";

export type ProfileResearchProposalV2 = {
  status: "review";
  humanReviewRequired: true;
  authority: "proposal_only";
  input: ControlledResearchInputV2;
  originalGap: M13GapV2;
  research: ProfileResearchResultV2;
  changes: { claimIds: string[]; evidenceIds: string[]; sourceIds: string[]; conflictIds: string[]; knowledgeSlot: string | null;
    knowledge: (CandidateResearchProvenanceV2["findings"][number]["knowledgeChanges"][number] & { findingRef: string })[] };
  proposalSha256: string;
  sharedSlotEffects: CandidateResearchProvenanceV2["sharedSlotEffects"];
};
export type ProposalBuildResultV2 =
  | { outcome: "proposal"; proposal: ProfileResearchProposalV2; profile: LanguageProfileV2; preview: RequirementEvidenceResolution }
  | { outcome: "gap_unresolved"; reason: "no_findings" | "knowledge_replacement_requires_review" | "conflicting_knowledge" | "target_not_addressed"; research: ProfileResearchResultV2; preview?: RequirementEvidenceResolution }
  | { outcome: "error"; reason: "invalid_proposal"; issues: string[] };

/** Pure transformation for a service-validated context; this helper grants no IO
 * authority. Append-only evidence and explicitly finding-authorized knowledge.
 * Every other field and existing knowledge value is preserved byte-for-byte. */
export function buildProfileResearchProposalV2(input: ControlledResearchInputV2, gap: M13GapV2, base: LanguageProfileV2, raw: unknown): ProposalBuildResultV2 {
  const fail = (...issues: string[]): ProposalBuildResultV2 => ({ outcome: "error", reason: "invalid_proposal", issues });
  const parsed = profileResearchResultV2Schema.safeParse(raw);
  if (!parsed.success) return fail(...parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  const research = parsed.data;
  if (!research.findings.length) {
    if (research.knowledgeAddition || research.conflicts.length) return fail("Empty findings cannot carry changes");
    return { outcome: "gap_unresolved", reason: "no_findings", research };
  }
  const { requirement, target } = input.evidenceRequest;
  const slot = requirementEvidenceTarget(target).subjectRef.slot;
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(research.findings.map((finding) => finding.findingId))) return fail("Duplicate finding IDs");
  for (const finding of research.findings) {
    if (finding.requirementRef !== requirement.requirementRef || finding.target.targetId !== target.targetId ||
      finding.subjectRefs.some((subject) => subject.kind === "section" || subject.slot !== slot)) return fail("Finding outside exact requirement/target scope");
    if (finding.evidence.some((entry) => entry.materialRef && !input.research.materialRefs.includes(entry.materialRef))) return fail("Unknown research material reference");
  }
  const addedClaims = new Set(research.findings.map((finding) => finding.claimId));
  const conflictIssue = researchConflictIssueV2(base.evidenceRegistry.claims, addedClaims, target, research.conflicts,
    research.knowledgeAddition !== null || research.findings.some((finding) => !!finding.knowledgeChanges?.length));
  if (conflictIssue?.reason === "invalid_conflict") return fail(conflictIssue.message);
  const usedSources = new Set(research.findings.flatMap((finding) => finding.evidence.map((entry) => entry.sourceRef)));
  if (research.sources.some((source) => !usedSources.has(source.sourceId))) return fail("Unrelated source");
  const addition = research.knowledgeAddition;
  if (addition && (addition.subject.slot !== slot || !unique(addition.findingRefs) ||
    addition.findingRefs.some((ref) => !research.findings.some((finding) => finding.findingId === ref)))) return fail("Knowledge addition outside finding scope");
  if (conflictIssue?.reason === "conflicting_knowledge") return { outcome: "gap_unresolved", reason: "conflicting_knowledge", research };
  const scoped = buildScopedKnowledgeV2(base.knowledge, slot, research);
  if (!scoped.ok) return fail(...scoped.issues);

  const profile = structuredClone(base);
  profile.status = "review";
  profile.version = input.research.proposedVersion;
  if (scoped.mapping.length) {
    const [section, field] = slot.split(".") as [keyof LanguageProfileV2["knowledge"], string];
    (profile.knowledge[section] as Record<string, unknown>)[field] = { state: "known", value: structuredClone(scoped.value) };
  }
  // Diagnostic effect of the SAME knowledge delta on existing claims. These
  // previews grant no extra research scope and add no claims for other targets.
  const sharedSlotEffects = researchSharedSlotEffectsV2(base, profile.knowledge, profile.version, requirement, target, input.evidenceRequest.options);
  const manifest = { status: "review" as const, humanReviewRequired: true as const, authority: "proposal_only" as const,
    input: structuredClone(input), originalGap: structuredClone(gap), research,
    sharedSlotEffects,
    changes: { claimIds: research.findings.map((finding) => finding.claimId),
      evidenceIds: research.findings.flatMap((finding) => finding.evidence.map((entry) => entry.evidenceId)),
      sourceIds: research.sources.map((source) => source.sourceId), conflictIds: research.conflicts.map((conflict) => conflict.conflictId),
      knowledgeSlot: scoped.mapping.length ? slot : null, knowledge: scoped.mapping } };
  const proposal: ProfileResearchProposalV2 = { ...manifest, proposalSha256: researchDigestV2(manifest) };
  profile.evidenceRegistry.sources.push(...research.sources);
  profile.evidenceRegistry.evidence.push(...research.findings.flatMap((finding) => finding.evidence.map((entry) => ({
    evidenceId: entry.evidenceId, sourceRef: entry.sourceRef, evidenceSummary: entry.evidenceSummary,
    locator: entry.locator ?? "Whole reference; no page or section supplied",
  }))));
  profile.evidenceRegistry.claims.push(...research.findings.map((finding) => ({
    claimId: finding.claimId, statement: finding.statement, subjectRefs: finding.subjectRefs,
    ...(finding.subjectStateAssertions ? { subjectStateAssertions: finding.subjectStateAssertions } : {}),
    requirementEvidenceTargetRefs: [target], requirementRefs: [requirement.requirementRef], confidence: finding.confidence,
    ...m14ResearchClaimEpistemicStateV2(finding.evidence.map((entry) => entry.evidenceId)),
    origin: { kind: "research_run" as const, originRunRef: `m14.${proposal.proposalSha256}` },
  })));
  profile.evidenceRegistry.conflicts.push(...research.conflicts);
  const validated = languageProfileV2Schema.safeParse(profile);
  if (!validated.success) return fail(...validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  const preview = resolveRequirementEvidence(requirement, validated.data, { ...input.evidenceRequest.options, mode: "preview" });
  if (researchTargetApplicabilityIssueV2(preview, target,
    research.findings.map((finding) => ({ findingRef: finding.findingId, claimId: finding.claimId })), scoped.mapping,
    profileKnowledgeSlotValue(base.knowledge, slot).state !== "known")) {
    return { outcome: "gap_unresolved", reason: "target_not_addressed", research, preview };
  }
  return { outcome: "proposal", proposal, profile: validated.data, preview };
}

/** Compact durable context: snapshot holds statements/sources/values, origin
 * binds their finding/change references. No prompt or provider response blob. */
export function candidateResearchProvenanceV2(proposal: ProfileResearchProposalV2): CandidateResearchProvenanceV2 {
  const { input, originalGap, research, changes } = proposal;
  return candidateResearchProvenanceV2Schema.parse({
    kind: "m14-controlled-research-v2", version: "1.0.0", runRef: input.research.runRef,
    registry: input.gap.provenance,
    gap: { reason: originalGap.reason, requirement: input.evidenceRequest.requirement, target: input.evidenceRequest.target,
      mode: input.evidenceRequest.mode, ...(input.evidenceRequest.options ? { options: input.evidenceRequest.options } : {}),
      resolutionSha256: input.gap.resolutionSha256, effectivePolicy: originalGap.targetEvidence.policy },
    provider: research.provenance, proposalSha256: proposal.proposalSha256, sharedSlotEffects: proposal.sharedSlotEffects,
    findings: research.findings.map((finding) => ({ findingRef: finding.findingId, claimRef: finding.claimId,
      evidence: finding.evidence.map((entry) => ({ evidenceRef: entry.evidenceId, sourceRef: entry.sourceRef,
        ...(entry.materialRef !== undefined ? { materialRef: entry.materialRef } : {}),
        ...(entry.extractionRef !== undefined ? { extractionRef: entry.extractionRef } : {}) })),
      knowledgeChanges: changes.knowledge.filter((change) => change.findingRef === finding.findingId)
        .map(({ changeId, slot, path, subject }) => ({ changeId, slot, path, subject })),
    })),
  });
}
