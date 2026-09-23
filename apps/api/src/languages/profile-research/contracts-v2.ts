import { createHash } from "node:crypto";
import { z } from "zod";
import { confidenceSchema, domainIdSchema, requiredTextSchema, semanticVersionSchema } from "../curriculum/primitives.js";
import { registryProfileBindingV2Schema } from "../decisions/registry-profile-binding-v2.js";
import { evidenceConflictV2Schema, evidenceSourceV2Schema, sourceEvidenceV2Schema } from "../profile/evidence-provenance-v2.js";
import { profileKnowledgeSlotRefSchema, profileKnowledgeSubjectRefSchema } from "../profile/profile-knowledge-v2.js";
import { requirementEvidenceTargetRefSchema } from "../profile/requirement-evidence-targets.js";
import { targetEvidenceInputV2Schema, type TargetEvidenceResultV2 } from "../resolution/target-evidence-v2.js";
import { researchKnowledgeChangeSchema } from "../profile/candidate-research-provenance-v2.js";

export type M13GapV2 = Extract<TargetEvidenceResultV2, { outcome: "gap" }>;
const text = requiredTextSchema.max(1200);
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/u);

/** Object keys are irrelevant; list order remains explicit and significant. */
export function researchDigestV2(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) :
    item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, ordered(child)])) : item;
  return createHash("sha256").update(JSON.stringify(ordered(value)), "utf8").digest("hex");
}

const gapReferenceSchema = z.object({
  outcome: z.literal("gap"),
  reason: z.enum(["evidence_missing", "evidence_partial", "limit_exceeded", "durable_not_authorized"]),
  provenance: z.object({ registryRecordId: z.string().uuid(), registryContentSha256: shaSchema, binding: registryProfileBindingV2Schema }).strict(),
  resolutionSha256: shaSchema,
}).strict();

/** A reference is not a capability: M14 always recomputes M13 before research. */
export function m14GapReferenceV2(gap: M13GapV2): z.infer<typeof gapReferenceSchema> {
  return gapReferenceSchema.parse({ outcome: gap.outcome, reason: gap.reason, provenance: gap.provenance, resolutionSha256: researchDigestV2(gap) });
}

export const controlledResearchInputV2Schema = z.object({
  evidenceRequest: targetEvidenceInputV2Schema.refine((request) => request.mode === "durable", "M14 requires a durable M13 request"),
  gap: gapReferenceSchema,
  research: z.object({
    runRef: domainIdSchema,
    proposedVersion: semanticVersionSchema,
    question: text.optional(),
    materialRefs: z.array(domainIdSchema).max(32),
  }).strict(),
}).strict();
export type ControlledResearchInputV2 = z.infer<typeof controlledResearchInputV2Schema>;

// Deliberately no provider-controlled review status, relationship validation,
// origin, parent, version, lifecycle state or arbitrary Profile snapshot.
const findingSchema = z.object({
  findingId: domainIdSchema,
  requirementRef: domainIdSchema,
  target: requirementEvidenceTargetRefSchema,
  claimId: domainIdSchema,
  statement: text,
  subjectRefs: z.array(profileKnowledgeSubjectRefSchema).min(1).max(32),
  subjectStateAssertions: z.array(z.object({ subjectRef: profileKnowledgeSubjectRefSchema, state: z.enum(["known", "not_applicable"]) }).strict()).min(1).max(32).optional(),
  confidence: confidenceSchema,
  knowledgeChanges: z.array(researchKnowledgeChangeSchema).max(512).optional(),
  evidence: z.array(sourceEvidenceV2Schema.extend({
    // Omitted locator is represented honestly, never by an invented page.
    locator: sourceEvidenceV2Schema.shape.locator.optional(),
    materialRef: domainIdSchema.optional(),
    extractionRef: domainIdSchema.optional(),
  }).strict()).min(1).max(32),
  rationale: text,
}).strict();

export const profileResearchResultV2Schema = z.object({
  provenance: z.object({ providerRef: domainIdSchema, responseRef: domainIdSchema.optional(), model: text.optional() }).strict(),
  sources: z.array(evidenceSourceV2Schema).max(64),
  findings: z.array(findingSchema).max(32),
  // Optional consistency assertion only. Findings' exact changes are authority.
  knowledgeAddition: z.object({ subject: profileKnowledgeSlotRefSchema, value: z.unknown().refine((value) => value !== undefined), findingRefs: z.array(domainIdSchema).min(1).max(32) }).strict().nullable(),
  conflicts: z.array(evidenceConflictV2Schema.extend({ resolutionStatus: z.literal("unresolved") }).strict()).max(32),
  rationale: text,
}).strict();
export type ProfileResearchResultV2 = z.infer<typeof profileResearchResultV2Schema>;

export type ResearchabilityV2 =
  | { kind: "researchable_gap"; gap: M13GapV2 }
  | { kind: "not_researchable"; reason: "no_gap" | "non_epistemic_gap" }
  | { kind: "non_researchable_error"; reason: Extract<TargetEvidenceResultV2, { outcome: "error" }>["reason"] };

export function classifyM14GapV2(result: TargetEvidenceResultV2): ResearchabilityV2 {
  if (result.outcome === "error") return { kind: "non_researchable_error", reason: result.reason };
  if (result.outcome !== "gap") return { kind: "not_researchable", reason: "no_gap" };
  // A local covered target blocked by another target, or an evaluation budget,
  // does not warrant researching this target. Review-only deficits stay human.
  const epistemic = new Set(["subject_missing", "subject_unknown", "subject_relevance_missing", "claim_missing", "claim_confidence_insufficient",
    "source_missing", "source_authority_insufficient", "source_independence_insufficient", "not_applicable_unsubstantiated", "open_conflict"]);
  const localGaps = result.evidence.gaps.filter((gap) => gap.targetId === result.target.targetId);
  if ((result.reason !== "evidence_missing" && result.reason !== "evidence_partial") || result.targetEvidence.status === "covered" ||
    !localGaps.some((gap) => epistemic.has(gap.reason))) return { kind: "not_researchable", reason: "non_epistemic_gap" };
  return { kind: "researchable_gap", gap: result };
}
