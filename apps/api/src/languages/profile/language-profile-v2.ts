import { z } from "zod";
import { domainIdSchema, requiredTextSchema, semanticVersionSchema } from "../curriculum/primitives.js";
import {
  validationResult,
  zodIssuesToValidationIssues,
  type ValidationResult,
} from "../curriculum/validation.js";
import { evidenceRegistryV2Schema, type EvidenceClaimV2 } from "./evidence-provenance-v2.js";
import {
  profileKnowledgeSectionsV2Schema,
  profileKnowledgeIntegrityIssues,
  profileSubjectExists,
} from "./profile-knowledge-v2.js";
import { requirementEvidenceTarget } from "./requirement-evidence-targets.js";

export const LANGUAGE_PROFILE_V2_SCHEMA_VERSION = "2.0.0";

/** Registry ID integrity can run independently of unrelated structural failures. */
export function evidenceRegistryReferencesV2Issues(registry: Record<string, unknown>): z.ZodIssue[] {
  const issues: z.ZodIssue[] = [];
  const entries = (kind: string): Record<string, unknown>[] => Array.isArray(registry[kind])
    ? registry[kind].map((entry: unknown) => entry && typeof entry === "object" ? entry as Record<string, unknown> : {}) : [];
  const id = (value: unknown) => {
    const parsed = domainIdSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };
  for (const [kind, field] of [["sources", "sourceId"], ["evidence", "evidenceId"], ["claims", "claimId"], ["conflicts", "conflictId"]] as const) {
    const ids = entries(kind).map((entry) => id(entry[field]));
    ids.forEach((value, index) => {
      if (value !== undefined && ids.indexOf(value) !== ids.lastIndexOf(value)) {
        issues.push({ code: "custom", path: ["evidenceRegistry", kind, index], message: "Duplicate reference or ID" });
      }
    });
  }
  const sourceIds = new Set(entries("sources").map((entry) => id(entry.sourceId)));
  entries("evidence").forEach((entry, index) => {
    const sourceRef = id(entry.sourceRef);
    if (sourceRef !== undefined && !sourceIds.has(sourceRef)) {
      issues.push({ code: "custom", path: ["evidenceRegistry", "evidence", index, "sourceRef"], message: "Unknown sourceRef" });
    }
  });
  return issues;
}

/** S1 claim integrity rules, reusable even when an unrelated profile field is malformed. */
export function evidenceClaimReferencesV2Issues(
  claim: EvidenceClaimV2, knowledge: unknown, evidenceIds: ReadonlySet<string>,
): z.ZodIssue[] {
  const issues: z.ZodIssue[] = [];
  const issue = (path: (string | number)[], message: string) => issues.push({ code: "custom", path, message });
  const unique = (values: string[], path: string[]) => {
    if (new Set(values).size !== values.length) issue(path, "Duplicate reference or ID");
  };
  unique(claim.evidenceRefs.map((ref) => ref.evidenceRef), ["evidenceRefs"]);
  unique(claim.requirementEvidenceTargetRefs.map((ref) => ref.targetId), ["requirementEvidenceTargetRefs"]);
  unique(claim.subjectRefs.map((ref) => JSON.stringify(ref)), ["subjectRefs"]);
  unique((claim.subjectStateAssertions ?? []).map((entry) => JSON.stringify(entry.subjectRef)), ["subjectStateAssertions"]);
  claim.subjectStateAssertions?.forEach((assertion, index) => {
    if (!claim.subjectRefs.some((ref) => JSON.stringify(ref) === JSON.stringify(assertion.subjectRef))) {
      issue(["subjectStateAssertions", index], "State assertion must identify an exact claim subject");
    }
  });
  unique(claim.requirementRefs, ["requirementRefs"]);
  claim.evidenceRefs.forEach((ref, index) => {
    if (!evidenceIds.has(ref.evidenceRef)) issue(["evidenceRefs", index], "Unknown evidenceRef");
  });
  claim.subjectRefs.forEach((ref, index) => {
    if (!profileSubjectExists(knowledge, ref)) issue(["subjectRefs", index], "Subject does not exist in this profile snapshot");
  });
  claim.requirementEvidenceTargetRefs.forEach((ref, index) => {
    const target = requirementEvidenceTarget(ref);
    if (!claim.subjectRefs.some((subject) => subject.kind !== "section" && subject.slot === target.subjectRef.slot)) {
      issue(["requirementEvidenceTargetRefs", index], "Target requires its exact slot or an item within that slot");
    }
  });
  return issues;
}

export const languageProfileV2Schema = z.object({
  schemaVersion: z.literal(LANGUAGE_PROFILE_V2_SCHEMA_VERSION),
  // Content revision is independent of the schema version.
  version: semanticVersionSchema,
  status: z.enum(["draft", "review", "canonical", "deprecated"]),
  identity: z.object({
    profileId: domainIdSchema,
    languageId: domainIdSchema,
    languageName: requiredTextSchema,
    varietyId: domainIdSchema,
    varietyName: requiredTextSchema,
  }).strict(),
  knowledge: z.preprocess((knowledge, context) => {
    // Count raw IDs before structural parsing can abort. Return the input
    // unchanged so missing fields and duplicate IDs are reported together.
    for (const error of profileKnowledgeIntegrityIssues(knowledge)) {
      context.addIssue({ ...error, path: error.path.slice(1) });
    }
    return knowledge;
  }, profileKnowledgeSectionsV2Schema),
  evidenceRegistry: evidenceRegistryV2Schema,
}).strict().superRefine((profile, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  function unique(values: string[], path: (string | number)[]) {
    if (new Set(values).size !== values.length) issue(path, "Duplicate reference or ID");
  }
  const { sources, evidence, claims, conflicts } = profile.evidenceRegistry;
  for (const error of evidenceRegistryReferencesV2Issues({ sources, evidence, claims, conflicts })) context.addIssue(error);
  const evidenceIds = new Set(evidence.map((entry) => entry.evidenceId));
  const claimIds = new Set(claims.map((entry) => entry.claimId));
  claims.forEach((claim, index) => {
    for (const error of evidenceClaimReferencesV2Issues(claim, profile.knowledge, evidenceIds)) {
      context.addIssue({ ...error, path: ["evidenceRegistry", "claims", index, ...error.path] });
    }
  });
  conflicts.forEach((conflict, index) => {
    const path = ["evidenceRegistry", "conflicts", index];
    unique(conflict.claimRefs, [...path, "claimRefs"]);
    unique(conflict.requirementEvidenceTargetRefs.map((ref) => ref.targetId), [...path, "requirementEvidenceTargetRefs"]);
    conflict.claimRefs.forEach((ref, refIndex) => {
      if (!claimIds.has(ref)) issue([...path, "claimRefs", refIndex], "Unknown claimRef");
    });
    conflict.requirementEvidenceTargetRefs.forEach((ref, refIndex) => {
      if (!claims.some((claim) => conflict.claimRefs.includes(claim.claimId) &&
        claim.requirementEvidenceTargetRefs.some((target) => target.targetId === ref.targetId))) {
        issue([...path, "requirementEvidenceTargetRefs", refIndex], "Conflict target must be referenced by an involved claim");
      }
    });
  });

});
export type LanguageProfileV2 = z.infer<typeof languageProfileV2Schema>;

export function validateLanguageProfileV2(input: unknown): ValidationResult {
  const parsed = languageProfileV2Schema.safeParse(input);
  return validationResult(parsed.success ? [] : zodIssuesToValidationIssues(parsed.error));
}
