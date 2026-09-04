import { z } from "zod";
import {
  domainIdSchema,
  requiredTextSchema,
  semanticVersionSchema,
  versionedRefSchema,
} from "../curriculum/primitives.js";
import {
  validationIssue,
  validationResult,
  zodIssuesToValidationIssues,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";
import type { AdaptationPlan } from "../adaptation/adaptation-plan.js";
import type { CurriculumUnitSpec } from "../curriculum/curriculum-unit-spec.js";
import {
  validateLanguageProfile,
  type LanguageProfile,
  type LanguageProfileSection,
} from "../profile/language-profile.js";

export const profileResearchSourceSchema = z
  .object({
    sourceId: domainIdSchema,
    sourceType: z.enum([
      "official_reference",
      "academic",
      "publisher_reference",
      "reputable_educational",
      "other",
    ]),
    authorityClass: requiredTextSchema,
    title: requiredTextSchema,
    publisherOrAuthor: requiredTextSchema,
    date: requiredTextSchema.optional(),
    urlOrReference: z.string().url(),
    language: requiredTextSchema,
  })
  .strict();

export const profileResearchClaimSchema = z
  .object({
    claimId: domainIdSchema,
    featureRef: domainIdSchema,
    statement: requiredTextSchema,
    evidenceRefs: z.array(domainIdSchema).min(2),
    confidence: z.enum(["medium", "high"]),
    reviewStatus: z.literal("machine_synthesized"),
    requirementRefs: z.array(domainIdSchema).min(1),
  })
  .strict();

export const languageProfileResearchCandidateSchema = z
  .object({
    baseProfileRef: versionedRefSchema,
    adaptationPlanRef: versionedRefSchema,
    researchTaskRefs: z.array(domainIdSchema).min(1),
    disposition: z.enum(["enriched", "needs_review"]),
    blockingReason: requiredTextSchema.optional(),
    sources: z.array(profileResearchSourceSchema),
    claims: z.array(profileResearchClaimSchema),
  })
  .strict();

export type LanguageProfileResearchCandidate = z.infer<
  typeof languageProfileResearchCandidateSchema
>;

export type ProfileResearchTarget = {
  researchTaskRef: string;
  requirementRef: string;
  domain: string;
  section: LanguageProfileSection;
  featureRefs: string[];
};

const PROFILE_SECTION_BY_DOMAIN: Record<string, LanguageProfileSection> = {
  "writing.beginner_system": "writingSystem",
  "phonology.initial_intelligibility": "phonology",
  "sociolinguistics.initial_register": "sociolinguisticSystem",
  "participant.basic_reference": "participantReference",
  "nominal.beginner_package": "nominalSystem",
  "predication.identity_state": "predicationSystem",
  "age.basic_expression": "semanticSystems",
  "possession.basic": "semanticSystems",
  "action.basic_pattern": "verbalSystem",
  "localization.first_contact": "sociolinguisticSystem",
};

function collectFeatureIds(value: unknown, target = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectFeatureIds(entry, target));
    return target;
  }
  if (!value || typeof value !== "object") return target;
  const record = value as Record<string, unknown>;
  if (typeof record.featureId === "string") target.add(record.featureId);
  Object.values(record).forEach((entry) => collectFeatureIds(entry, target));
  return target;
}

export function deriveProfileResearchTargets(input: {
  curriculum: CurriculumUnitSpec;
  languageProfile: LanguageProfile;
  adaptationPlan: AdaptationPlan;
  researchTaskRefs: string[];
}): ProfileResearchTarget[] {
  const taskById = new Map(
    input.adaptationPlan.researchPlan.map((task) => [task.researchTaskId, task] as const),
  );
  const gapById = new Map(
    input.adaptationPlan.gapAnalysis.map((gap) => [gap.gapId, gap] as const),
  );
  const requirementById = new Map(
    input.curriculum.adaptationRequirements.map((requirement) => [
      requirement.requirementId,
      requirement,
    ] as const),
  );
  const targets: ProfileResearchTarget[] = [];

  for (const researchTaskRef of input.researchTaskRefs) {
    const task = taskById.get(researchTaskRef);
    if (!task) continue;
    for (const gapRef of task.gapRefs) {
      const gap = gapById.get(gapRef);
      const requirement = gap ? requirementById.get(gap.requirementRef) : undefined;
      if (!requirement) continue;
      const section = PROFILE_SECTION_BY_DOMAIN[requirement.domain];
      if (!section) continue;
      targets.push({
        researchTaskRef,
        requirementRef: requirement.requirementId,
        domain: requirement.domain,
        section,
        featureRefs: [...collectFeatureIds(input.languageProfile[section])].sort(),
      });
    }
  }

  const unique = new Map<string, ProfileResearchTarget>();
  for (const target of targets) {
    unique.set(`${target.researchTaskRef}|${target.requirementRef}`, target);
  }
  return [...unique.values()];
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort();
}

function sameSet(left: string[], right: string[]) {
  return sortedUnique(left).join("|") === sortedUnique(right).join("|");
}

export function validateLanguageProfileResearchCandidate(
  candidateInput: unknown,
  input: {
    curriculum: CurriculumUnitSpec;
    languageProfile: LanguageProfile;
    adaptationPlan: AdaptationPlan;
    researchTaskRefs: string[];
    observedUrls: string[];
  },
): ValidationResult {
  const parsed = languageProfileResearchCandidateSchema.safeParse(candidateInput);
  if (!parsed.success) {
    return validationResult(zodIssuesToValidationIssues(parsed.error));
  }
  const candidate = parsed.data;
  const issues: ValidationIssue[] = [];
  const expectedProfileRef = {
    id: input.languageProfile.identity.profileId,
    version: input.languageProfile.version,
  };
  const expectedPlanRef = {
    id: input.adaptationPlan.identity.adaptationPlanId,
    version: input.adaptationPlan.version,
  };

  if (
    candidate.baseProfileRef.id !== expectedProfileRef.id ||
    candidate.baseProfileRef.version !== expectedProfileRef.version
  ) {
    issues.push(
      validationIssue(
        "PROFILE_RESEARCH_BASE_REF_MISMATCH",
        "baseProfileRef",
        "Research candidate must be pinned to the exact LanguageProfile snapshot.",
      ),
    );
  }
  if (
    candidate.adaptationPlanRef.id !== expectedPlanRef.id ||
    candidate.adaptationPlanRef.version !== expectedPlanRef.version
  ) {
    issues.push(
      validationIssue(
        "PROFILE_RESEARCH_PLAN_REF_MISMATCH",
        "adaptationPlanRef",
        "Research candidate must be pinned to the exact AdaptationPlan snapshot.",
      ),
    );
  }
  if (!sameSet(candidate.researchTaskRefs, input.researchTaskRefs)) {
    issues.push(
      validationIssue(
        "PROFILE_RESEARCH_TASK_REFS_MISMATCH",
        "researchTaskRefs",
        "Research candidate must cover exactly the blocked research tasks.",
      ),
    );
  }

  if (candidate.disposition === "needs_review") {
    if (!candidate.blockingReason) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_REVIEW_REASON_MISSING",
          "blockingReason",
          "needs_review requires a blockingReason.",
        ),
      );
    }
    return validationResult(issues);
  }
  if (candidate.sources.length < 2 || candidate.claims.length === 0) {
    issues.push(
      validationIssue(
        "PROFILE_RESEARCH_EVIDENCE_INSUFFICIENT",
        "claims",
        "Automatic enrichment requires at least two sources and one claim.",
      ),
    );
  }

  const observed = new Set(input.observedUrls.map(canonicalUrl));
  const existingSourceIds = new Set(
    input.languageProfile.evidenceRegistry.sources.map((source) => source.sourceId),
  );
  const existingClaimIds = new Set(
    input.languageProfile.evidenceRegistry.claims.map((claim) => claim.claimId),
  );
  const sourceById = new Map<string, (typeof candidate.sources)[number]>();
  const sourceUrls = new Set<string>();

  candidate.sources.forEach((source, index) => {
    if (existingSourceIds.has(source.sourceId) || sourceById.has(source.sourceId)) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_SOURCE_ID_COLLISION",
          `sources.${index}.sourceId`,
          `Evidence source id ${source.sourceId} is already used.`,
        ),
      );
    }
    const url = canonicalUrl(source.urlOrReference);
    if (sourceUrls.has(url)) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_DUPLICATE_SOURCE_URL",
          `sources.${index}.urlOrReference`,
          "Each research source URL must be unique.",
        ),
      );
    }
    if (!observed.has(url)) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_UNOBSERVED_SOURCE",
          `sources.${index}.urlOrReference`,
          "The provider did not expose this URL in a web-search tool call.",
        ),
      );
    }
    sourceById.set(source.sourceId, source);
    sourceUrls.add(url);
  });

  const targets = deriveProfileResearchTargets(input);
  const targetByRequirement = new Map(
    targets.map((target) => [target.requirementRef, target] as const),
  );
  const coveredRequirements = new Set<string>();
  const seenClaimIds = new Set<string>();
  const referencedSources = new Set<string>();

  candidate.claims.forEach((claim, index) => {
    if (existingClaimIds.has(claim.claimId) || seenClaimIds.has(claim.claimId)) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_CLAIM_ID_COLLISION",
          `claims.${index}.claimId`,
          `Evidence claim id ${claim.claimId} is already used.`,
        ),
      );
    }
    seenClaimIds.add(claim.claimId);

    const sources = sortedUnique(claim.evidenceRefs)
      .map((ref) => sourceById.get(ref))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    claim.evidenceRefs.forEach((ref) => {
      referencedSources.add(ref);
      if (!sourceById.has(ref)) {
        issues.push(
          validationIssue(
            "PROFILE_RESEARCH_BROKEN_SOURCE_REF",
            `claims.${index}.evidenceRefs`,
            `Claim references unknown research source ${ref}.`,
          ),
        );
      }
    });
    const hostnames = new Set(
      sources.map((source) => new URL(source.urlOrReference).hostname.toLowerCase()),
    );
    if (sources.length < 2 || hostnames.size < 2) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_NOT_CROSS_CHECKED",
          `claims.${index}.evidenceRefs`,
          "Automatic cross-checking requires at least two observed sources from distinct hosts.",
        ),
      );
    }

    for (const requirementRef of claim.requirementRefs) {
      const target = targetByRequirement.get(requirementRef);
      if (!target) {
        issues.push(
          validationIssue(
            "PROFILE_RESEARCH_INELIGIBLE_REQUIREMENT",
            `claims.${index}.requirementRefs`,
            `Requirement ${requirementRef} is outside the blocked research scope.`,
          ),
        );
        continue;
      }
      coveredRequirements.add(requirementRef);
      if (!target.featureRefs.includes(claim.featureRef)) {
        issues.push(
          validationIssue(
            "PROFILE_RESEARCH_FEATURE_OUT_OF_SCOPE",
            `claims.${index}.featureRef`,
            `Feature ${claim.featureRef} is not an existing feature in ${target.section}.`,
            { relatedRefs: [claim.featureRef, requirementRef] },
          ),
        );
      }
    }
  });

  for (const target of targets) {
    if (!coveredRequirements.has(target.requirementRef)) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_REQUIREMENT_UNCOVERED",
          "claims",
          `No evidence claim covers blocked requirement ${target.requirementRef}.`,
          { relatedRefs: [target.requirementRef] },
        ),
      );
    }
  }
  candidate.sources.forEach((source, index) => {
    if (!referencedSources.has(source.sourceId)) {
      issues.push(
        validationIssue(
          "PROFILE_RESEARCH_UNUSED_SOURCE",
          `sources.${index}.sourceId`,
          "Every persisted research source must support at least one claim.",
        ),
      );
    }
  });

  return validationResult(issues);
}

function bumpMinor(version: string) {
  const parsed = semanticVersionSchema.parse(version);
  const [major, minor] = parsed.split(".").map(Number);
  return `${major}.${(minor ?? 0) + 1}.0`;
}

function updateFeatureEvidence(
  value: unknown,
  claim: LanguageProfileResearchCandidate["claims"][number],
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => updateFeatureEvidence(entry, claim));
  }
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.featureId === claim.featureRef) {
    const refs = Array.isArray(record.evidenceRefs)
      ? record.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
      : [];
    record.evidenceRefs = sortedUnique([...refs, ...claim.evidenceRefs]);
    record.reviewStatus = "cross_checked";
    record.confidence = claim.confidence;
    return true;
  }
  return Object.values(record).some((entry) => updateFeatureEvidence(entry, claim));
}

export function buildEnrichedLanguageProfile(input: {
  baseProfile: LanguageProfile;
  candidate: LanguageProfileResearchCandidate;
  accessedAt: string;
}): LanguageProfile {
  const profile = structuredClone(input.baseProfile);
  for (const source of input.candidate.sources) {
    profile.evidenceRegistry.sources.push({
      ...source,
      accessedAt: input.accessedAt,
    });
  }
  for (const claim of input.candidate.claims) {
    profile.evidenceRegistry.claims.push({
      claimId: claim.claimId,
      featureRef: claim.featureRef,
      statement: claim.statement,
      evidenceRefs: sortedUnique(claim.evidenceRefs),
      confidence: claim.confidence,
      reviewStatus: "cross_checked",
    });
    if (!updateFeatureEvidence(profile, claim)) {
      throw new Error(`profile_research_feature_missing:${claim.featureRef}`);
    }
  }
  profile.version = bumpMinor(profile.version);
  profile.status = "review";

  const validation = validateLanguageProfile(profile);
  if (!validation.valid) {
    throw new Error(
      `enriched_profile_invalid:${validation.issues.map((issue) => issue.code).join(",")}`,
    );
  }
  return profile;
}
