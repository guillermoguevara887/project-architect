import {
  normalizeCurriculumRequirementDomain,
  type CurriculumRequirementDomainNormalization,
} from "./curriculum-requirement-domain.js";
import {
  curriculumUnitSpecSchema,
  type CurriculumUnitSpec,
} from "./curriculum-unit-spec.js";

export type CurriculumRequirementDomainNormalizationTrace =
  CurriculumRequirementDomainNormalization &
    Readonly<{
      requirementRef: string;
    }>;

export type PersistedCurriculumUnitNormalization = Readonly<{
  curriculum: CurriculumUnitSpec;
  domainNormalizations: readonly CurriculumRequirementDomainNormalizationTrace[];
  legacyNormalizationApplied: boolean;
}>;

export function normalizePersistedCurriculumUnitSpec(
  input: unknown,
): PersistedCurriculumUnitNormalization {
  const copy = structuredClone(input);
  if (!copy || typeof copy !== "object") {
    return {
      curriculum: curriculumUnitSpecSchema.parse(copy),
      domainNormalizations: [],
      legacyNormalizationApplied: false,
    };
  }

  const requirements = (copy as Record<string, unknown>).adaptationRequirements;
  if (!Array.isArray(requirements)) {
    return {
      curriculum: curriculumUnitSpecSchema.parse(copy),
      domainNormalizations: [],
      legacyNormalizationApplied: false,
    };
  }

  const traces = requirements.map((requirement, index) => {
    if (!requirement || typeof requirement !== "object") {
      curriculumUnitSpecSchema.parse(copy);
      throw new TypeError("Invalid curriculum adaptation requirement");
    }
    const record = requirement as Record<string, unknown>;
    const normalized = normalizeCurriculumRequirementDomain(record.domain);
    record.domain = normalized.canonicalDomain;
    return {
      ...normalized,
      requirementRef:
        typeof record.requirementId === "string"
          ? record.requirementId
          : `adaptationRequirements.${index}`,
    };
  });

  return {
    curriculum: curriculumUnitSpecSchema.parse(copy),
    domainNormalizations: traces,
    legacyNormalizationApplied: traces.some((trace) => trace.legacyNormalized),
  };
}
