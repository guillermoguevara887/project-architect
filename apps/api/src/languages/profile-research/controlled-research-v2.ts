import { isDeepStrictEqual } from "node:util";
import { RegistryGroundingStoreV2 } from "../knowledge/registry-grounding-v2.js";
import { languageProfileV2Schema, type LanguageProfileV2 } from "../profile/language-profile-v2.js";
import { ProfileLifecycleStoreV2, ProfileLifecycleStoreError, type ProfileCandidateRecordV2 } from "../profile/profile-lifecycle-store-v2.js";
import { createProfileReviewCandidateV2 } from "../profile/profile-lifecycle-v2.js";
import { type RequirementEvidenceResolution } from "../profile/requirement-evidence.js";
import { TargetEvidenceResolverV2 } from "../resolution/target-evidence-v2.js";
import { classifyM14GapV2, controlledResearchInputV2Schema, m14GapReferenceV2, type ControlledResearchInputV2, type M13GapV2 } from "./contracts-v2.js";
import { buildProfileResearchProposalV2, candidateResearchProvenanceV2, type ProfileResearchProposalV2, type ProposalBuildResultV2 } from "./proposal-v2.js";

type GroundingPort = Pick<RegistryGroundingStoreV2, "getRegistryForCanonical">;
type CandidatePort = Pick<ProfileLifecycleStoreV2, "persistReviewCandidate" | "getCurrentCanonical" | "getReviewDecision">;

/** Separate v2 proposer contract. The legacy researcher requires v1 profiles and
 * AdaptationPlans and cannot safely implement this port without a future adapter. */
export interface ProfileResearchProviderV2 {
  research(context: { input: ControlledResearchInputV2; gap: M13GapV2; baseProfile: LanguageProfileV2 }, signal: AbortSignal): Promise<unknown>;
}
export type ControlledResearchResultV2 =
  | { outcome: "proposal_created"; proposal: ProfileResearchProposalV2; candidate: ProfileCandidateRecordV2; preview: RequirementEvidenceResolution;
      candidateStatus: "review"; humanReviewRequired: true; canonicalChangedByM14: false; parentPolicy: "exact_parent_rechecked_at_human_review" }
  | Extract<ProposalBuildResultV2, { outcome: "gap_unresolved" }>
  | { outcome: "not_researchable"; reason: "no_gap" | "non_epistemic_gap" | "gap_mismatch" | "candidate_already_reviewed"; candidateRecordId?: string }
  | { outcome: "error"; reason: string; stage: "input" | "revalidation" | "provider" | "proposal" | "persistence"; issues?: string[]; persistedCandidateRecordId?: string };

export class ControlledProfileResearchV2 {
  constructor(
    private readonly provider: ProfileResearchProviderV2,
    private readonly grounding: GroundingPort = new RegistryGroundingStoreV2(),
    private readonly candidates: CandidatePort = new ProfileLifecycleStoreV2(),
    private readonly timeoutMs = 30_000,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("Invalid research timeout");
  }

  async research(input: unknown): Promise<ControlledResearchResultV2> {
    const parsed = controlledResearchInputV2Schema.safeParse(input);
    if (!parsed.success) return { outcome: "error", reason: "invalid_input", stage: "input" };
    const args = parsed.data;
    // Minimal composition over M13: capture precisely the pair M13 read, not a
    // second independent canonical lookup. No duplicated evidence semantics.
    let pair: Awaited<ReturnType<GroundingPort["getRegistryForCanonical"]>> | undefined;
    const resolver = new TargetEvidenceResolverV2({ getRegistryForCanonical: async (...refs) => {
      pair = await this.grounding.getRegistryForCanonical(...refs); return pair;
    } });
    let stage: "revalidation" | "proposal" | "persistence" = "revalidation";
    let persistedCandidateRecordId: string | undefined;
    try {
      const resolved = await resolver.resolve(args.evidenceRequest);
      const classification = classifyM14GapV2(resolved);
      if (classification.kind === "non_researchable_error") return { outcome: "error", reason: classification.reason, stage };
      if (classification.kind === "not_researchable") return { outcome: "not_researchable", reason: classification.reason };
      const gap = classification.gap;
      if (!isDeepStrictEqual(m14GapReferenceV2(gap), args.gap)) return { outcome: "not_researchable", reason: "gap_mismatch" };
      const parent = pair!.canonical;
      const base = languageProfileV2Schema.parse(JSON.parse(parent.snapshotJson));
      if (args.research.proposedVersion === base.version) return { outcome: "error", reason: "invalid_proposed_version", stage: "input" };
      if ((await this.candidates.getCurrentCanonical(parent.profileId))?.id !== parent.id) return { outcome: "error", reason: "stale_parent", stage };

      let raw: unknown;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        raw = await Promise.race([
          Promise.resolve().then(() => this.provider.research(structuredClone({ input: args, gap, baseProfile: base }), controller.signal)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("research_timeout")); }, this.timeoutMs); }),
        ]);
      } catch {
        return { outcome: "error", reason: controller.signal.aborted ? "provider_timeout" : "provider_failed", stage: "provider" };
      } finally { clearTimeout(timer); }
      stage = "proposal";
      const built = buildProfileResearchProposalV2(args, gap, base, raw);
      if (built.outcome === "error") return { ...built, stage };
      if (built.outcome === "gap_unresolved") return built;
      // Re-read ownership and integrity after external IO. Exact references and
      // original M13 policy remain fixed throughout the invocation.
      stage = "revalidation";
      const fresh = await resolver.resolve(args.evidenceRequest);
      if (fresh.outcome === "error") return { outcome: "error", reason: fresh.reason, stage };
      if (fresh.outcome !== "gap" || !isDeepStrictEqual(m14GapReferenceV2(fresh), args.gap)) return { outcome: "not_researchable", reason: "gap_mismatch" };
      if ((await this.candidates.getCurrentCanonical(parent.profileId))?.id !== parent.id) return { outcome: "error", reason: "stale_parent", stage };
      const created = createProfileReviewCandidateV2({ profile: built.profile, parentCanonical: base,
        proposedVersion: args.research.proposedVersion, origin: { kind: "researched", originRef: `m14.${built.proposal.proposalSha256}`, runRef: args.research.runRef,
          researchProvenance: candidateResearchProvenanceV2(built.proposal) } });
      if (!created.ok) return { outcome: "error", reason: created.code, stage: "proposal" };
      stage = "persistence";
      // S3B checks exact parent under its existing lock, closing the promotion
      // race after the last read. It also owns candidate hash idempotency.
      const candidate = await this.candidates.persistReviewCandidate({ candidate: created.candidate, parentCanonicalRecordId: parent.id });
      persistedCandidateRecordId = candidate.id;
      if (await this.candidates.getReviewDecision(candidate.id)) return { outcome: "not_researchable", reason: "candidate_already_reviewed", candidateRecordId: candidate.id };
      if ((await this.candidates.getCurrentCanonical(parent.profileId))?.id !== parent.id) return { outcome: "error", reason: "stale_parent", stage, persistedCandidateRecordId };
      return { outcome: "proposal_created", proposal: built.proposal, candidate, preview: built.preview,
        candidateStatus: "review", humanReviewRequired: true, canonicalChangedByM14: false, parentPolicy: "exact_parent_rechecked_at_human_review" };
    } catch (error) {
      return { outcome: "error", reason: error instanceof ProfileLifecycleStoreError ? error.code : "infrastructure_failure", stage,
        ...(persistedCandidateRecordId ? { persistedCandidateRecordId } : {}) };
    }
  }
}
