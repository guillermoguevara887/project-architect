import { z } from "zod";

/** Bounds the exact independence problem, not the size of the profile registry. */
export const REQUIREMENT_EVIDENCE_INDEPENDENCE_LIMITS = Object.freeze({
  maximumSourcesPerClaim: 12,
  maximumRequiredIndependentSources: 12,
} as const);

/** Central baseline contract, consumed by the pure S2 resolver. */
export const BASELINE_EVIDENCE_POLICY_V2 = Object.freeze({
  policyVersion: "1.0.0",
  minimumConfidence: "medium",
  eligibleReviewStatuses: Object.freeze(["cross_checked", "human_reviewed"] as const),
  authoritativeSourceClasses: Object.freeze(["authoritative"] as const),
  machineSynthesizedCanCoverAlone: false,
  needsReviewCanCover: false,
  crossCheckedMinimumIndependentSources: 2,
  humanReviewedMinimumAuthoritativeSources: 1,
  humanReviewedRequiresValidatedClaimSourceRelation: true,
  openConflictBlocksCovered: true,
} as const);

export const baselineEvidencePolicyV2Schema = z.object({
  policyVersion: z.literal(BASELINE_EVIDENCE_POLICY_V2.policyVersion),
  minimumConfidence: z.literal("medium"),
  eligibleReviewStatuses: z.tuple([z.literal("cross_checked"), z.literal("human_reviewed")]),
  authoritativeSourceClasses: z.tuple([z.literal("authoritative")]),
  machineSynthesizedCanCoverAlone: z.literal(false),
  needsReviewCanCover: z.literal(false),
  crossCheckedMinimumIndependentSources: z.literal(2),
  humanReviewedMinimumAuthoritativeSources: z.literal(1),
  humanReviewedRequiresValidatedClaimSourceRelation: z.literal(true),
  openConflictBlocksCovered: z.literal(true),
}).strict();

/** Additive restrictions only. Omitting a field inherits the frozen baseline. */
export const targetEvidencePolicySchema = z.object({
  allowedReviewStatuses: z.array(z.enum(["cross_checked", "human_reviewed"])).min(1).optional(),
  crossCheckedMinimumIndependentSources: z.number().int().min(2)
    .max(REQUIREMENT_EVIDENCE_INDEPENDENCE_LIMITS.maximumRequiredIndependentSources).optional(),
  humanReviewedMinimumAuthoritativeSources: z.number().int().min(1).optional(),
  humanReviewedRequiresValidatedClaimSourceRelation: z.literal(true).optional(),
  openConflictBlocksCovered: z.literal(true).optional(),
}).strict();
export type TargetEvidencePolicy = z.infer<typeof targetEvidencePolicySchema>;
