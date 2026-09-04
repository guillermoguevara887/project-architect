import type { LanguageFeature, LanguageProfileSection } from "../../../src/languages/profile/language-profile.js";

export const fixtureSourceId = "fixture.reference";

export function feature(
  featureId: string,
  applicability: LanguageFeature["applicability"] = "common",
  values: string[] = [],
  options: Partial<LanguageFeature> = {},
): LanguageFeature {
  return {
    featureId,
    description: `Contract fixture feature for ${featureId}`,
    applicability,
    values,
    mechanisms: [],
    conditions: [],
    variation: "none_known",
    confidence: "high",
    evidenceRefs: [fixtureSourceId],
    coverageDepth: "A1_sufficient",
    reviewStatus: "cross_checked",
    ...options,
  };
}

export function notApplicable(featureId: string): LanguageFeature {
  return feature(featureId, "not_applicable", []);
}

export const profileSections: LanguageProfileSection[] = [
  "writingSystem",
  "phonology",
  "nominalSystem",
  "participantReference",
  "predicationSystem",
  "verbalSystem",
  "clauseStructure",
  "semanticSystems",
  "discourseSystem",
  "sociolinguisticSystem",
];

export function reviewedCoverage() {
  return profileSections.map((section) => ({
    section,
    coverageDepth: "A1_sufficient" as const,
    coverageStatus: "reviewed" as const,
  }));
}

export function fixtureSource(language: string) {
  return {
    sourceId: fixtureSourceId,
    sourceType: "contract_fixture",
    authorityClass: "internal_test_reference",
    title: `${language} LanguageProfile contract fixture reference`,
    publisherOrAuthor: "MemoOS test suite",
    urlOrReference: "internal://language-profile-contract-fixture",
    language,
  };
}
