import { z } from "zod";
import {
  CURRICULUM_REQUIREMENT_DOMAINS,
  curriculumRequirementDomainSchema,
  type CurriculumRequirementDomain,
} from "../curriculum/curriculum-requirement-domain-values.js";
import { domainIdSchema } from "../curriculum/primitives.js";
import {
  profileKnowledgeSlotRefSchema,
  profileKnowledgeRelevanceSchema,
  type ProfileKnowledgeSlotId,
} from "./profile-knowledge-v2.js";
import { targetEvidencePolicySchema } from "./evidence-policy-v2.js";

export const REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION = "1.0.0";

const relevanceRequirementSchema = z.object({
  scope: z.enum(["feature", "feature_mechanism"]),
  relevance: profileKnowledgeRelevanceSchema,
}).strict();

export const requirementEvidenceTargetGroupSchema = z.object({
  groupId: domainIdSchema,
  requirement: z.enum(["required", "optional"]),
  aggregation: z.enum(["all", "any"]),
  targets: z.array(z.object({
    targetId: domainIdSchema,
    subjectRef: profileKnowledgeSlotRefSchema,
    relevanceRequirement: relevanceRequirementSchema.optional(),
    policy: targetEvidencePolicySchema.optional(),
  }).strict()).min(1),
}).strict();
export type RequirementEvidenceTargetGroup = z.infer<typeof requirementEvidenceTargetGroupSchema>;
export type RequirementEvidenceTarget = RequirementEvidenceTargetGroup["targets"][number];

function group(
  domain: CurriculumRequirementDomain,
  name: string,
  requirement: RequirementEvidenceTargetGroup["requirement"],
  aggregation: RequirementEvidenceTargetGroup["aggregation"],
  slots: readonly ProfileKnowledgeSlotId[],
  relevanceRequirement?: z.infer<typeof relevanceRequirementSchema>,
): RequirementEvidenceTargetGroup {
  return {
    groupId: `${domain}.${name}`,
    requirement,
    aggregation,
    targets: slots.map((slot) => ({
      targetId: `${domain}.${slot}`,
      subjectRef: { kind: "slot", slot },
      ...(relevanceRequirement ? { relevanceRequirement } : {}),
    })),
  };
}

/** The sole versioned target vocabulary. No language facts or coverage decisions. */
const groupsByDomain = {
  "writing.beginner_system": [group("writing.beginner_system", "core", "required", "all", [
    "writingSystem.scripts", "writingSystem.primaryScriptStrategy", "writingSystem.direction",
    "writingSystem.segmentation", "writingSystem.graphemeSoundRelationship",
    "writingSystem.orthographicDepth", "writingSystem.orthographicConventions",
    "writingSystem.diacritics", "writingSystem.transliterationSystems",
  ])],
  "phonology.initial_intelligibility": [group("phonology.initial_intelligibility", "intelligibility", "required", "any", [
    "phonology.segmentalSystem", "phonology.syllableStructure", "phonology.stressSystem",
    "phonology.lexicalToneSystem", "phonology.lexicalPitchSystem", "phonology.lengthContrasts",
    "phonology.connectedSpeech", "phonology.phonotacticConstraints", "phonology.intelligibilityRelevantFeatures",
  ], { scope: "feature", relevance: "initial_intelligibility" })],
  "sociolinguistics.initial_register": [
    group("sociolinguistics.initial_register", "core", "required", "all", [
      "sociolinguisticSystem.addressSystem", "sociolinguisticSystem.politenessSystem",
      "sociolinguisticSystem.honorificSystem", "sociolinguisticSystem.registerVariation",
      "sociolinguisticSystem.interactionalNorms",
    ]),
    group("sociolinguistics.initial_register", "corroboration", "optional", "all", ["participantReference.socialDistinctions"]),
  ],
  "participant.basic_reference": [
    group("participant.basic_reference", "core", "required", "all", [
      "participantReference.personDistinctions", "participantReference.numberDistinctions",
      "participantReference.genderDistinctions", "participantReference.socialDistinctions",
      "participantReference.pronounInventoryCharacteristics", "participantReference.zeroReference",
      "participantReference.nominalReference", "participantReference.agreementBasedReference",
      "participantReference.referencePersistence",
    ]),
    group("participant.basic_reference", "contextual", "optional", "all", [
      "participantReference.animacyDistinctions", "participantReference.clusivity", "participantReference.demonstrativeReference",
    ]),
  ],
  "nominal.beginner_package": [
    group("nominal.beginner_package", "core", "required", "all", [
      "nominalSystem.grammaticalGender", "nominalSystem.nounClasses", "nominalSystem.numberMarking",
      "nominalSystem.caseMarking", "nominalSystem.definiteness", "nominalSystem.articlesAndDeterminers",
      "nominalSystem.classifiers", "nominalSystem.agreement",
    ]),
    group("nominal.beginner_package", "contextual", "optional", "all", ["nominalSystem.modification"]),
  ],
  "predication.identity_state": [group("predication.identity_state", "core", "required", "all", [
    "predicationSystem.identityPredication", "predicationSystem.propertyPredication", "predicationSystem.statePredication",
  ])],
  "age.basic_expression": [
    group("age.basic_expression", "core", "required", "all", ["semanticSystems.age", "clauseStructure.questionFormation"]),
    group("age.basic_expression", "numerals", "required", "all", ["semanticSystems.numerals"], {
      scope: "feature", relevance: "age_expression",
    }),
    // Alternatives are closed slots of already modeled mechanisms. S2 must check
    // the exact mechanism's age_realization annotation, never infer it from a section.
    group("age.basic_expression", "realization", "required", "any", [
      "predicationSystem.identityPredication", "predicationSystem.propertyPredication",
      "predicationSystem.statePredication", "predicationSystem.locationPredication",
      "predicationSystem.existencePredication", "predicationSystem.possessionPredication",
      "verbalSystem.personMarking", "verbalSystem.numberMarking", "verbalSystem.tense",
      "verbalSystem.aspect", "verbalSystem.mood", "verbalSystem.polarity", "verbalSystem.voice",
      "verbalSystem.politenessMarking", "verbalSystem.evidentiality", "verbalSystem.auxiliaries",
      "verbalSystem.particles", "verbalSystem.serialization", "verbalSystem.irregularity",
      "discourseSystem.discourseParticles",
    ], { scope: "feature_mechanism", relevance: "age_realization" }),
  ],
  "possession.basic": [group("possession.basic", "core", "required", "all", [
    "semanticSystems.possession", "predicationSystem.possessionPredication", "nominalSystem.possessionWithinNP",
  ])],
  "action.basic_pattern": [group("action.basic_pattern", "core", "required", "all", [
    "verbalSystem.personMarking", "verbalSystem.numberMarking", "verbalSystem.tense", "verbalSystem.aspect",
    "verbalSystem.auxiliaries", "verbalSystem.particles", "verbalSystem.serialization", "verbalSystem.irregularity",
    "clauseStructure.canonicalOrders", "clauseStructure.orderFlexibility", "clauseStructure.argumentMarkingMechanisms",
  ])],
  "localization.first_contact": [
    group("localization.first_contact", "core", "required", "all", [
      "identity.regionScope", "identity.referenceRegister", "sociolinguisticSystem.namingConventions",
      "sociolinguisticSystem.sociallySensitiveQuestions", "sociolinguisticSystem.interactionalNorms",
      "sociolinguisticSystem.registerVariation",
    ]),
    group("localization.first_contact", "reusable", "optional", "all", [
      "sociolinguisticSystem.addressSystem", "sociolinguisticSystem.politenessSystem",
    ]),
  ],
} satisfies Record<CurriculumRequirementDomain, RequirementEvidenceTargetGroup[]>;

const catalog = {
  catalogVersion: REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION,
  domains: CURRICULUM_REQUIREMENT_DOMAINS.map((domain) => ({ domain, groups: groupsByDomain[domain] })),
};

const targetById = new Map(catalog.domains.flatMap(({ groups }) => groups.flatMap(({ targets }) =>
  targets.map((target) => [target.targetId, target] as const),
)));

export const requirementEvidenceTargetRefSchema = z.object({
  catalogVersion: z.literal(REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION),
  targetId: z.enum([...targetById.keys()] as [string, ...string[]]),
}).strict();
export type RequirementEvidenceTargetRef = z.infer<typeof requirementEvidenceTargetRefSchema>;

export const requirementEvidenceTargetCatalogRefSchema = z.object({
  catalogVersion: z.literal(REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION),
  domain: curriculumRequirementDomainSchema,
}).strict();
export type RequirementEvidenceTargetCatalogRef = z.infer<typeof requirementEvidenceTargetCatalogRefSchema>;

export function requirementEvidenceTargetCatalogRef<D extends CurriculumRequirementDomain>(domain: D) {
  return { catalogVersion: REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION, domain } as const;
}

export function requirementEvidenceTarget(ref: RequirementEvidenceTargetRef): RequirementEvidenceTarget {
  const parsed = requirementEvidenceTargetRefSchema.parse(ref);
  return targetById.get(parsed.targetId)!;
}

export const requirementEvidenceTargetCatalogSchema = z.object({
  catalogVersion: z.literal(REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION),
  domains: z.array(z.object({
    domain: curriculumRequirementDomainSchema,
    groups: z.array(requirementEvidenceTargetGroupSchema).min(1),
  }).strict()).length(CURRICULUM_REQUIREMENT_DOMAINS.length),
}).strict().superRefine((value, context) => {
  const domains = new Set<string>();
  const groups = new Set<string>();
  const targets = new Set<string>();
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  for (const entry of value.domains) {
    if (domains.has(entry.domain)) issue(`Duplicate domain: ${entry.domain}`);
    domains.add(entry.domain);
    const expectedGroups = groupsByDomain[entry.domain];
    if (entry.groups.length !== expectedGroups.length) issue(`Incomplete domain: ${entry.domain}`);
    for (const group of entry.groups) {
      if (groups.has(group.groupId)) issue(`Duplicate groupId: ${group.groupId}`);
      groups.add(group.groupId);
      const expected = expectedGroups.find((candidate) => candidate.groupId === group.groupId);
      if (!expected || expected.requirement !== group.requirement || expected.aggregation !== group.aggregation ||
        expected.targets.length !== group.targets.length) issue(`Unknown or changed group: ${group.groupId}`);
      for (const target of group.targets) {
        if (targets.has(target.targetId)) issue(`Duplicate targetId: ${target.targetId}`);
        targets.add(target.targetId);
        const canonical = expected?.targets.find((candidate) => candidate.targetId === target.targetId);
        if (!canonical || canonical.subjectRef.slot !== target.subjectRef.slot ||
          canonical.relevanceRequirement?.scope !== target.relevanceRequirement?.scope ||
          canonical.relevanceRequirement?.relevance !== target.relevanceRequirement?.relevance) {
          issue(`Unknown or changed target: ${target.targetId}`);
        }
      }
    }
  }
});

// Validate once as contract data and freeze recursively, including lookup values.
requirementEvidenceTargetCatalogSchema.parse(catalog);
function freezeContract<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeContract);
    Object.freeze(value);
  }
  return value;
}
export const REQUIREMENT_EVIDENCE_TARGET_CATALOG = freezeContract(catalog);
