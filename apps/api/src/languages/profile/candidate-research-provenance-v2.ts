import { z } from "zod";
import { domainIdSchema } from "../curriculum/primitives.js";
import { registryProfileBindingV2Schema } from "../decisions/registry-profile-binding-v2.js";
import { profileKnowledgeSlotIdSchema, profileKnowledgeSubjectRefSchema } from "./profile-knowledge-v2.js";
import { requirementEvidenceInputSchema, requirementEvidenceOptionsSchema } from "./requirement-evidence.js";
import { REQUIREMENT_EVIDENCE_TARGET_CATALOG, requirementEvidenceTarget, requirementEvidenceTargetRefSchema } from "./requirement-evidence-targets.js";

// Addresses are concrete fields/array positions in a normalized S1 slot value,
// not new S1 subject IDs. They are checked against that value before sealing.
export const researchChangePathSchema = z.array(z.union([
  z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/u).refine((key) => !["__proto__", "prototype", "constructor"].includes(key)),
  z.number().int().min(0).max(4095),
])).max(8);
export const researchKnowledgeChangeSchema = z.object({
  changeId: domainIdSchema,
  path: researchChangePathSchema,
  // Profile v2 leaves are strings. Empty lists must also be explicitly asserted.
  value: z.union([z.string().trim().min(1), z.array(z.never()).length(0)]),
}).strict();
export type ResearchKnowledgeChangeV2 = z.infer<typeof researchKnowledgeChangeSchema>;

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const candidateResearchProvenanceV2Schema = z.object({
  kind: z.literal("m14-controlled-research-v2"),
  version: z.literal("1.0.0"),
  runRef: domainIdSchema,
  registry: z.object({ registryRecordId: z.string().uuid(), registryContentSha256: sha, binding: registryProfileBindingV2Schema }).strict(),
  gap: z.object({
    reason: z.enum(["evidence_missing", "evidence_partial"]),
    requirement: requirementEvidenceInputSchema,
    target: requirementEvidenceTargetRefSchema,
    mode: z.literal("durable"),
    options: requirementEvidenceOptionsSchema.optional(),
    resolutionSha256: sha,
    effectivePolicy: z.object({
      policyVersion: domainIdSchema,
      minimumConfidence: z.enum(["low", "medium", "high"]),
      allowedReviewStatuses: z.array(z.string().min(1)),
      crossCheckedMinimumIndependentSources: z.number().int().positive(),
      humanReviewedMinimumAuthoritativeSources: z.number().int().positive(),
      humanReviewedRequiresValidatedClaimSourceRelation: z.literal(true),
      openConflictBlocksCovered: z.literal(true),
    }).strict(),
  }).strict(),
  provider: z.object({ providerRef: domainIdSchema, responseRef: domainIdSchema.optional(), model: z.string().trim().min(1).max(1200).optional() }).strict(),
  proposalSha256: sha,
  sharedSlotEffects: z.array(z.object({
    domain: requirementEvidenceInputSchema.shape.domain,
    targetId: requirementEvidenceTargetRefSchema.shape.targetId,
    before: z.enum(["missing", "partial", "covered"]), after: z.enum(["missing", "partial", "covered"]),
  }).strict()),
  findings: z.array(z.object({
    findingRef: domainIdSchema,
    claimRef: domainIdSchema,
    evidence: z.array(z.object({
      evidenceRef: domainIdSchema, sourceRef: domainIdSchema,
      materialRef: domainIdSchema.optional(), extractionRef: domainIdSchema.optional(),
    }).strict()).min(1).max(32),
    knowledgeChanges: z.array(z.object({
      changeId: domainIdSchema, slot: profileKnowledgeSlotIdSchema,
      path: researchChangePathSchema, subject: profileKnowledgeSubjectRefSchema,
    }).strict()).max(512),
  }).strict()).min(1).max(32),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const target = requirementEvidenceTarget(value.gap.target);
  if (!REQUIREMENT_EVIDENCE_TARGET_CATALOG.domains.find((domain) => domain.domain === value.gap.requirement.domain)!
    .groups.some((group) => group.targets.some((entry) => entry.targetId === target.targetId))) fail("Research target must belong to requirement domain");
  if (value.gap.options?.mode !== undefined && value.gap.options.mode !== "durable") fail("Conflicting research mode");
  const ids = new Set<string>(), changes = new Set<string>(), paths = new Set<string>();
  for (const finding of value.findings) {
    if (ids.has(finding.findingRef)) fail("Duplicate research finding");
    ids.add(finding.findingRef);
    for (const change of finding.knowledgeChanges) {
      const address = JSON.stringify([change.slot, change.path]);
      if (changes.has(change.changeId) || paths.has(address)) fail("Duplicate research change");
      changes.add(change.changeId); paths.add(address);
      if (change.slot !== target.subjectRef.slot || change.subject.kind === "section" || change.subject.slot !== change.slot) fail("Research change outside target slot");
    }
  }
});
export type CandidateResearchProvenanceV2 = z.infer<typeof candidateResearchProvenanceV2Schema>;
