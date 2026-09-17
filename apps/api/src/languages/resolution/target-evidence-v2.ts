import { z } from "zod";
import { RegistryGroundingErrorV2, RegistryGroundingStoreV2, type GroundedRegistryRecordV2 } from "../knowledge/registry-grounding-v2.js";
import { ProfileLifecycleStoreError } from "../profile/profile-lifecycle-store-v2.js";
import { REQUIREMENT_EVIDENCE_TARGET_CATALOG, requirementEvidenceTargetRefSchema } from "../profile/requirement-evidence-targets.js";
import {
  canConsumeRequirementEvidenceDurably, requirementEvidenceInputSchema, requirementEvidenceOptionsSchema,
  resolveRequirementEvidence, type DurableRequirementEvidenceResolution, type RequirementEvidenceResolution,
  type RequirementEvidenceTargetResolution,
} from "../profile/requirement-evidence.js";

export const targetEvidenceInputV2Schema = z.object({
  userId: z.string().uuid(),
  canonicalRecordId: z.string().uuid(),
  registryRecordId: z.string().uuid(),
  requirement: requirementEvidenceInputSchema,
  target: requirementEvidenceTargetRefSchema,
  mode: z.enum(["preview", "durable"]),
  options: requirementEvidenceOptionsSchema.optional(),
}).strict().superRefine((input, context) => {
  if (input.options?.mode !== undefined && input.options.mode !== input.mode) {
    context.addIssue({ code: "custom", path: ["options", "mode"], message: "Conflicting evidence modes" });
  }
  const domain = REQUIREMENT_EVIDENCE_TARGET_CATALOG.domains.find((entry) => entry.domain === input.requirement.domain)!;
  if (!domain.groups.some((group) => group.targets.some((target) => target.targetId === input.target.targetId))) {
    context.addIssue({ code: "custom", path: ["target"], message: "Target does not belong to requirement domain" });
  }
});
export type TargetEvidenceInputV2 = z.infer<typeof targetEvidenceInputV2Schema>;
type GroundingPort = Pick<RegistryGroundingStoreV2, "getRegistryForCanonical">;
type Provenance = {
  registryRecordId: string;
  registryContentSha256: string;
  binding: GroundedRegistryRecordV2["profileBinding"];
};
type Resolution = {
  requirement: TargetEvidenceInputV2["requirement"];
  target: TargetEvidenceInputV2["target"];
  mode: TargetEvidenceInputV2["mode"];
  provenance: Provenance;
  evidence: RequirementEvidenceResolution;
  targetEvidence: RequirementEvidenceTargetResolution;
};
export type TargetEvidenceResultV2 =
  | (Resolution & { outcome: "authorized"; mode: "durable"; durableAuthorized: true; evidence: DurableRequirementEvidenceResolution })
  | (Resolution & { outcome: "preview"; mode: "preview"; durableAuthorized: false })
  | (Resolution & { outcome: "gap"; durableAuthorized: false; reason: "evidence_missing" | "evidence_partial" | "limit_exceeded" | "durable_not_authorized" })
  | { outcome: "error"; durableAuthorized: false; reason: "invalid_input" | "canonical_not_found" | "registry_not_found" |
      "registry_unbound" | "registry_profile_mismatch" | "storage_integrity" | "evidence_invalid";
      request: TargetEvidenceInputV2 | null; resolution: Resolution | null };

/** Non-persistent M13 v2. The only infrastructure port reads an exact grounded
 * pair; S2 is called afresh from its canonical bytes, never caller evidence.
 * This class does not adapt or invoke the legacy resolution workflow.
 */
export class TargetEvidenceResolverV2 {
  constructor(private readonly grounding: GroundingPort = new RegistryGroundingStoreV2()) {}

  async resolve(input: unknown): Promise<TargetEvidenceResultV2> {
    // Zod clones the request before the first await, including policy options.
    const parsed = targetEvidenceInputV2Schema.safeParse(input);
    if (!parsed.success) return { outcome: "error", durableAuthorized: false, reason: "invalid_input", request: null, resolution: null };
    const args = parsed.data;
    let pair: Awaited<ReturnType<GroundingPort["getRegistryForCanonical"]>>;
    try {
      pair = await this.grounding.getRegistryForCanonical(args.userId, args.registryRecordId, args.canonicalRecordId);
    } catch (error) {
      if (error instanceof RegistryGroundingErrorV2 && (
        error.code === "invalid_input" || error.code === "canonical_not_found" || error.code === "registry_not_found" ||
        error.code === "registry_unbound" || error.code === "registry_profile_mismatch" || error.code === "storage_integrity"
      )) return { outcome: "error", durableAuthorized: false, reason: error.code, request: args, resolution: null };
      if (error instanceof ProfileLifecycleStoreError && error.code === "storage_integrity") {
        return { outcome: "error", durableAuthorized: false, reason: "storage_integrity", request: args, resolution: null };
      }
      // Infrastructure failures propagate, with no fallback or research gap.
      throw error;
    }
    let profile: unknown;
    try { profile = JSON.parse(pair.canonical.snapshotJson); }
    catch { return { outcome: "error", durableAuthorized: false, reason: "storage_integrity", request: args, resolution: null }; }
    const evidence = resolveRequirementEvidence(args.requirement, profile, { ...args.options, mode: args.mode });
    const targetEvidence = evidence.groups.flatMap((group) => group.targets).find((target) => target.targetId === args.target.targetId)!;
    const resolution: Resolution = {
      requirement: args.requirement, target: args.target, mode: args.mode, evidence, targetEvidence,
      provenance: { registryRecordId: pair.registry.id, registryContentSha256: pair.registry.contentSha256, binding: pair.registry.profileBinding },
    };
    // These are S2 diagnostics, not a second structural validator. Preserve the
    // complete local evaluations even if global profile validity blocks durable use.
    const invalid = evidence.gaps.some((gap) =>
      gap.reason === "profile_contract_invalid" || gap.reason === "unsupported_schema_version" || gap.reason === "profile_not_canonical" ||
      ((gap.targetId === args.target.targetId || gap.targetId === null) && (
        gap.reason === "claim_contract_invalid" || gap.reason === "source_contract_invalid" || gap.reason === "subject_invalid"
      )));
    if (invalid) return { outcome: "error", durableAuthorized: false, reason: "evidence_invalid", request: args, resolution };
    if (targetEvidence.status === "covered" && canConsumeRequirementEvidenceDurably(evidence)) {
      return { ...resolution, outcome: "authorized", mode: "durable", durableAuthorized: true, evidence };
    }
    if (args.mode === "preview") return { ...resolution, outcome: "preview", mode: "preview", durableAuthorized: false };
    // Limit is a local evaluation outcome, not an invented S2 top-level status.
    const limited = evidence.gaps.some((gap) => gap.reason === "independence_evaluation_limit_exceeded");
    const reason = limited ? "limit_exceeded" : targetEvidence.status === "missing" ? "evidence_missing" :
      targetEvidence.status === "partial" || evidence.status === "partial" ? "evidence_partial" : "durable_not_authorized";
    return { ...resolution, outcome: "gap", durableAuthorized: false, reason };
  }
}

const resolver = new TargetEvidenceResolverV2();
export function resolveTargetEvidenceV2(input: unknown): Promise<TargetEvidenceResultV2> {
  return resolver.resolve(input);
}
