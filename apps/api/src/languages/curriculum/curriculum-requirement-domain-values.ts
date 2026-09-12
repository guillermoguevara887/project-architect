import { z } from "zod";

// Leaf contract shared by curriculum metadata and the evidence catalog; no cycles.
export const CURRICULUM_REQUIREMENT_DOMAIN_VERSION = "1.0.0";
export const CURRICULUM_REQUIREMENT_DOMAINS = [
  "writing.beginner_system",
  "phonology.initial_intelligibility",
  "sociolinguistics.initial_register",
  "participant.basic_reference",
  "nominal.beginner_package",
  "predication.identity_state",
  "age.basic_expression",
  "possession.basic",
  "action.basic_pattern",
  "localization.first_contact",
] as const;
export const curriculumRequirementDomainSchema = z.enum(CURRICULUM_REQUIREMENT_DOMAINS);
export type CurriculumRequirementDomain = z.infer<typeof curriculumRequirementDomainSchema>;
