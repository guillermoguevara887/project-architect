import { z } from "zod";
import { confidenceSchema, domainIdSchema, requiredTextSchema } from "../curriculum/primitives.js";
import { profileKnowledgeSubjectRefSchema } from "./profile-knowledge-v2.js";
import { requirementEvidenceTargetRefSchema } from "./requirement-evidence-targets.js";

const briefTextSchema = requiredTextSchema.max(1200);
const timestampSchema = z.string().datetime({ offset: true });

export const evidenceSourceV2Schema = z.object({
  sourceId: domainIdSchema,
  sourceType: z.enum([
    "official_reference", "academic_grammar", "academic_article", "reference_book",
    "language_corpus", "publisher_reference", "community_reference", "field_observation",
  ]),
  title: requiredTextSchema.max(500),
  publisherOrAuthor: requiredTextSchema.max(500),
  reference: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("url"), url: z.string().url(), accessedAt: timestampSchema }).strict(),
    z.object({ kind: z.literal("bibliographic"), citation: briefTextSchema, accessedAt: timestampSchema.optional() }).strict(),
  ]),
  sourceLanguage: requiredTextSchema.max(100),
  authorityClass: z.enum(["authoritative", "reference", "community", "unassessed"]),
  independenceKey: z.object({
    responsibleEntityId: domainIdSchema,
    workId: domainIdSchema,
    lineageId: domainIdSchema,
  }).strict(),
}).strict();
export type EvidenceSourceV2 = z.infer<typeof evidenceSourceV2Schema>;

/** Short evidence excerpts/summaries only; never documents or prompts. */
export const sourceEvidenceV2Schema = z.object({
  evidenceId: domainIdSchema,
  sourceRef: domainIdSchema,
  locator: requiredTextSchema.max(300),
  evidenceSummary: briefTextSchema,
}).strict();

// Validation belongs to this particular claim/evidence/source relation.
export const claimEvidenceRefV2Schema = z.object({
  evidenceRef: domainIdSchema,
  relationshipValidation: z.discriminatedUnion("status", [
    z.object({ status: z.literal("unvalidated") }).strict(),
    z.object({
      status: z.literal("human_validated"),
      validatorRef: domainIdSchema,
      validatedAt: timestampSchema,
    }).strict(),
  ]),
}).strict();

export const evidenceClaimV2Schema = z.object({
  claimId: domainIdSchema,
  statement: briefTextSchema,
  subjectRefs: z.array(profileKnowledgeSubjectRefSchema).min(1),
  // Optional for S1 compatibility; non-applicability requires an exact assertion in S2.
  subjectStateAssertions: z.array(z.object({
    subjectRef: profileKnowledgeSubjectRefSchema,
    state: z.enum(["known", "not_applicable"]),
  }).strict()).min(1).optional(),
  requirementEvidenceTargetRefs: z.array(requirementEvidenceTargetRefSchema).min(1),
  evidenceRefs: z.array(claimEvidenceRefV2Schema).min(1),
  confidence: confidenceSchema,
  reviewStatus: z.enum(["machine_synthesized", "needs_review", "cross_checked", "human_reviewed"]),
  // Empty is explicit for manual work with no originating curriculum requirement.
  requirementRefs: z.array(domainIdSchema),
  origin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("research_run"), originRunRef: domainIdSchema }).strict(),
    z.object({ kind: z.literal("manual"), authorRef: domainIdSchema, recordedAt: timestampSchema }).strict(),
  ]),
}).strict();
export type EvidenceClaimV2 = z.infer<typeof evidenceClaimV2Schema>;

export const evidenceConflictV2Schema = z.object({
  conflictId: domainIdSchema,
  claimRefs: z.array(domainIdSchema).min(2),
  requirementEvidenceTargetRefs: z.array(requirementEvidenceTargetRefSchema).min(1),
  conflictType: z.enum(["contradiction", "scope_disagreement", "source_disagreement"]),
  resolutionStatus: z.enum(["unresolved", "resolved_with_scope", "resolved_by_evidence", "accepted_variation"]),
  notes: briefTextSchema,
}).strict();

export const evidenceRegistryV2Schema = z.object({
  sources: z.array(evidenceSourceV2Schema),
  evidence: z.array(sourceEvidenceV2Schema),
  claims: z.array(evidenceClaimV2Schema),
  conflicts: z.array(evidenceConflictV2Schema),
}).strict();
