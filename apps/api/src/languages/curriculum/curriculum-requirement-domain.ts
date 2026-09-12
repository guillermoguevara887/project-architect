import type { LanguageProfileSection } from "../profile/language-profile.js";
import {
  CURRICULUM_REQUIREMENT_DOMAINS,
  CURRICULUM_REQUIREMENT_DOMAIN_VERSION,
  curriculumRequirementDomainSchema,
  type CurriculumRequirementDomain,
} from "./curriculum-requirement-domain-values.js";
import {
  requirementEvidenceTargetCatalogRef,
  type RequirementEvidenceTargetCatalogRef,
} from "../profile/requirement-evidence-targets.js";
export {
  CURRICULUM_REQUIREMENT_DOMAINS,
  CURRICULUM_REQUIREMENT_DOMAIN_VERSION,
  curriculumRequirementDomainSchema,
  type CurriculumRequirementDomain,
} from "./curriculum-requirement-domain-values.js";

export type CurriculumRequirementResearchGroup =
  | "literacy"
  | "pronunciation"
  | "first_contact"
  | "nominal_verbal_core"
  | "predication_relations";

export type CurriculumRequirementResolutionArea =
  | "instructional"
  | "pronunciation"
  | "literacy"
  | "localization";

export type CurriculumRequirementDomainMetadata = Readonly<{
  profileSection: LanguageProfileSection;
  researchGroup: CurriculumRequirementResearchGroup;
  resolutionArea: CurriculumRequirementResolutionArea;
  promptDescription: string;
  evidenceTargetCatalogRef: RequirementEvidenceTargetCatalogRef;
}>;

const domainMetadata = {
  "writing.beginner_system": {
    profileSection: "writingSystem",
    researchGroup: "literacy",
    resolutionArea: "literacy",
    promptDescription:
      "sistema gráfico inicial, alfabetización y apoyos de escritura legítimos",
  },
  "phonology.initial_intelligibility": {
    profileSection: "phonology",
    researchGroup: "pronunciation",
    resolutionArea: "pronunciation",
    promptDescription:
      "rasgos sonoros o prosódicos relevantes para la inteligibilidad inicial",
  },
  "sociolinguistics.initial_register": {
    profileSection: "sociolinguisticSystem",
    researchGroup: "first_contact",
    resolutionArea: "instructional",
    promptDescription:
      "registro, tratamiento, cortesía y distancia social en interacciones iniciales",
  },
  "participant.basic_reference": {
    profileSection: "participantReference",
    researchGroup: "first_contact",
    resolutionArea: "instructional",
    promptDescription:
      "referencia básica a hablante, interlocutor, terceros y grupos",
  },
  "nominal.beginner_package": {
    profileSection: "nominalSystem",
    researchGroup: "nominal_verbal_core",
    resolutionArea: "instructional",
    promptDescription:
      "paquete nominal mínimo que debe acompañar al léxico principiante",
  },
  "predication.identity_state": {
    profileSection: "predicationSystem",
    researchGroup: "predication_relations",
    resolutionArea: "instructional",
    promptDescription:
      "realización auténtica de identidad, estado y propiedad básica",
  },
  "age.basic_expression": {
    profileSection: "semanticSystems",
    researchGroup: "predication_relations",
    resolutionArea: "instructional",
    promptDescription: "expresión y pregunta de edad sin proyectar una construcción universal",
  },
  "possession.basic": {
    profileSection: "semanticSystems",
    researchGroup: "predication_relations",
    resolutionArea: "instructional",
    promptDescription: "expresión básica de posesión o relación",
  },
  "action.basic_pattern": {
    profileSection: "verbalSystem",
    researchGroup: "nominal_verbal_core",
    resolutionArea: "instructional",
    promptDescription:
      "patrones de acción frecuentes sin asumir conjugación, tiempo u orden universales",
  },
  "localization.first_contact": {
    profileSection: "sociolinguisticSystem",
    researchGroup: "first_contact",
    resolutionArea: "localization",
    promptDescription:
      "localización culturalmente plausible de escenarios de primer contacto",
  },
} as const satisfies Record<
  CurriculumRequirementDomain,
  Omit<CurriculumRequirementDomainMetadata, "evidenceTargetCatalogRef">
>;

// Metadata points to the one catalog. Consumers retain their historical fields.
export const CURRICULUM_REQUIREMENT_DOMAIN_METADATA = Object.fromEntries(
  CURRICULUM_REQUIREMENT_DOMAINS.map((domain) => [domain, {
    ...domainMetadata[domain],
    evidenceTargetCatalogRef: requirementEvidenceTargetCatalogRef(domain),
  }]),
) as {
  readonly [D in CurriculumRequirementDomain]: typeof domainMetadata[D] & {
    readonly evidenceTargetCatalogRef: RequirementEvidenceTargetCatalogRef & { domain: D };
  };
};

export const LEGACY_CURRICULUM_REQUIREMENT_DOMAIN_ALIASES = {
  writing_system: "writing.beginner_system",
  pronunciation: "phonology.initial_intelligibility",
  social_register: "sociolinguistics.initial_register",
  participant_reference: "participant.basic_reference",
  nominal_packaging: "nominal.beginner_package",
  identity_and_state: "predication.identity_state",
  age_expression: "age.basic_expression",
  possession_and_relation: "possession.basic",
  event_expression: "action.basic_pattern",
  cultural_context: "localization.first_contact",
} as const satisfies Record<string, CurriculumRequirementDomain>;

export type CurriculumRequirementDomainNormalization = Readonly<{
  contractVersion: typeof CURRICULUM_REQUIREMENT_DOMAIN_VERSION;
  originalDomain: string;
  canonicalDomain: CurriculumRequirementDomain;
  legacyNormalized: boolean;
}>;

export class UnknownCurriculumRequirementDomainError extends Error {
  readonly code = "unknown_curriculum_requirement_domain";

  constructor(readonly originalDomain: unknown) {
    super("Unknown CurriculumUnitSpec adaptation requirement domain.");
    this.name = "UnknownCurriculumRequirementDomainError";
  }
}

export function normalizeCurriculumRequirementDomain(
  value: unknown,
): CurriculumRequirementDomainNormalization {
  const canonical = curriculumRequirementDomainSchema.safeParse(value);
  if (canonical.success) {
    return {
      contractVersion: CURRICULUM_REQUIREMENT_DOMAIN_VERSION,
      originalDomain: canonical.data,
      canonicalDomain: canonical.data,
      legacyNormalized: false,
    };
  }

  if (typeof value === "string") {
    const alias = (
      LEGACY_CURRICULUM_REQUIREMENT_DOMAIN_ALIASES as Record<
        string,
        CurriculumRequirementDomain | undefined
      >
    )[value];
    if (alias) {
      return {
        contractVersion: CURRICULUM_REQUIREMENT_DOMAIN_VERSION,
        originalDomain: value,
        canonicalDomain: alias,
        legacyNormalized: true,
      };
    }
  }

  throw new UnknownCurriculumRequirementDomainError(value);
}

export function curriculumRequirementDomainMetadata(
  domain: CurriculumRequirementDomain,
): CurriculumRequirementDomainMetadata {
  return CURRICULUM_REQUIREMENT_DOMAIN_METADATA[domain];
}

export const CURRICULUM_REQUIREMENT_DOMAIN_PROMPT_GUIDANCE =
  CURRICULUM_REQUIREMENT_DOMAINS.map(
    (domain) =>
      `- ${domain}: ${CURRICULUM_REQUIREMENT_DOMAIN_METADATA[domain].promptDescription}.`,
  ).join("\n");
