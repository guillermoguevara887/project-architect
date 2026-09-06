import assert from "node:assert/strict";
import test from "node:test";
import {
  compileInitialAdaptationPlan,
  type AdaptationPlan,
} from "../src/languages/adaptation/adaptation-plan.js";
import { curriculumDocumentGenerationSchema } from "../src/languages/ai/document-curriculum-generation-schema.js";
import {
  CURRICULUM_REQUIREMENT_DOMAINS,
  CURRICULUM_REQUIREMENT_DOMAIN_METADATA,
  LEGACY_CURRICULUM_REQUIREMENT_DOMAIN_ALIASES,
  curriculumRequirementDomainSchema,
  normalizeCurriculumRequirementDomain,
  UnknownCurriculumRequirementDomainError,
} from "../src/languages/curriculum/curriculum-requirement-domain.js";
import { normalizePersistedCurriculumUnitSpec } from "../src/languages/curriculum/curriculum-unit-domain-compatibility.js";
import type { CurriculumUnitSpec } from "../src/languages/curriculum/curriculum-unit-spec.js";
import {
  languageDecisionDomainSchema,
} from "../src/languages/decisions/language-decision-registry.js";
import { deriveProfileResearchTargets } from "../src/languages/profile-research/contracts.js";
import {
  compileVersionedAdaptationPlan,
  finalizeResolvedAdaptationPlan,
  hasPromotableProfileEvidenceForTask,
} from "../src/languages/resolution/adaptation-resolution-runtime.js";
import { germanM5DecisionRegistryFixture } from "./fixtures/adapted-curriculum/resolved-german-inputs.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

type CurriculumRequirement =
  CurriculumUnitSpec["adaptationRequirements"][number];
type LegacyCurriculumUnitSpec = Omit<
  CurriculumUnitSpec,
  "adaptationRequirements"
> & {
  adaptationRequirements: Array<
    Omit<CurriculumRequirement, "domain"> & { domain: string }
  >;
};

function legacyCanonicalSnapshot(): LegacyCurriculumUnitSpec {
  const snapshot = structuredClone(
    a1U01CurriculumFixture,
  ) as LegacyCurriculumUnitSpec;
  const aliasByCanonical = new Map(
    Object.entries(LEGACY_CURRICULUM_REQUIREMENT_DOMAIN_ALIASES).map(
      ([alias, canonical]) => [canonical, alias],
    ),
  );
  snapshot.status = "canonical";
  snapshot.specVersion = "1.0.1";
  snapshot.adaptationRequirements.forEach((requirement) => {
    const alias = aliasByCanonical.get(
      requirement.domain as CurriculumRequirement["domain"],
    );
    assert.ok(alias);
    requirement.domain = alias;
  });
  return snapshot;
}

test("curriculum requirement domain V1 accepts exactly the ten canonical domains", () => {
  assert.equal(CURRICULUM_REQUIREMENT_DOMAINS.length, 10);
  for (const domain of CURRICULUM_REQUIREMENT_DOMAINS) {
    assert.equal(curriculumRequirementDomainSchema.safeParse(domain).success, true);
    assert.ok(CURRICULUM_REQUIREMENT_DOMAIN_METADATA[domain]);
  }
  assert.equal(
    curriculumRequirementDomainSchema.safeParse("future.unknown_domain").success,
    false,
  );
});

test("the ten LIVE aliases normalize one-to-one and unknown aliases fail", () => {
  assert.equal(
    Object.keys(LEGACY_CURRICULUM_REQUIREMENT_DOMAIN_ALIASES).length,
    10,
  );
  for (const [alias, canonical] of Object.entries(
    LEGACY_CURRICULUM_REQUIREMENT_DOMAIN_ALIASES,
  )) {
    assert.deepEqual(normalizeCurriculumRequirementDomain(alias), {
      contractVersion: "1.0.0",
      originalDomain: alias,
      canonicalDomain: canonical,
      legacyNormalized: true,
    });
    assert.deepEqual(normalizeCurriculumRequirementDomain(canonical), {
      contractVersion: "1.0.0",
      originalDomain: canonical,
      canonicalDomain: canonical,
      legacyNormalized: false,
    });
  }
  assert.throws(
    () => normalizeCurriculumRequirementDomain("legacy_but_unknown"),
    UnknownCurriculumRequirementDomainError,
  );
});

test("legacy canonical 1.0.1 normalizes without mutating its persisted snapshot", () => {
  const snapshot = legacyCanonicalSnapshot();
  const before = structuredClone(snapshot);
  const result = normalizePersistedCurriculumUnitSpec(snapshot);

  assert.deepEqual(snapshot, before);
  assert.equal(result.legacyNormalizationApplied, true);
  assert.equal(result.domainNormalizations.length, 10);
  assert.equal(
    result.domainNormalizations.every(
      (trace) =>
        trace.legacyNormalized &&
        trace.originalDomain !== trace.canonicalDomain,
    ),
    true,
  );
  assert.deepEqual(
    result.curriculum.adaptationRequirements.map(
      (requirement) => requirement.domain,
    ),
    CURRICULUM_REQUIREMENT_DOMAINS,
  );
  assert.equal(result.curriculum.status, "canonical");
  assert.equal(result.curriculum.specVersion, "1.0.1");
});

test("normalized legacy domains restore specialized M4, M13 and M14 routing", () => {
  const curriculum = normalizePersistedCurriculumUnitSpec(
    legacyCanonicalSnapshot(),
  ).curriculum;
  const compilation = compileInitialAdaptationPlan({
    curriculum,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
  assert.equal(
    compilation.validation.valid,
    true,
    JSON.stringify(compilation.validation.issues, null, 2),
  );
  assert.ok(compilation.plan);
  const plan = compilation.plan;
  assert.deepEqual(
    plan.researchPlan.map((task) => task.researchTaskId),
    [
      "research.first_contact",
      "research.literacy",
      "research.nominal_verbal_core",
      "research.predication_relations",
      "research.pronunciation",
    ],
  );
  assert.equal(
    plan.gapAnalysis.every(
      (gap) => gap.researchNecessity === "registry_reasoning",
    ),
    true,
  );

  const task = plan.researchPlan.find(
    (entry) => entry.researchTaskId === "research.nominal_verbal_core",
  );
  const nominalGap = plan.gapAnalysis.find(
    (gap) => gap.requirementRef === "AR05",
  );
  assert.ok(task);
  assert.ok(nominalGap);
  const nominalPlan = structuredClone(plan) as AdaptationPlan;
  nominalPlan.gapAnalysis = [nominalGap];
  nominalPlan.researchPlan = [
    {
      ...task,
      gapRefs: [nominalGap.gapId],
    },
  ];
  assert.equal(
    hasPromotableProfileEvidenceForTask({
      curriculum,
      languageProfile: germanLanguageProfileFixture,
      plan: nominalPlan,
      researchTaskRef: task.researchTaskId,
    }),
    true,
  );

  const targets = deriveProfileResearchTargets({
    curriculum,
    languageProfile: germanLanguageProfileFixture,
    adaptationPlan: plan,
    researchTaskRefs: plan.researchPlan.map((entry) => entry.researchTaskId),
  });
  assert.deepEqual(
    targets.map((target) => [target.requirementRef, target.section]),
    [
      ["AR10", "sociolinguisticSystem"],
      ["AR01", "writingSystem"],
      ["AR05", "nominalSystem"],
      ["AR09", "verbalSystem"],
      ["AR06", "predicationSystem"],
      ["AR07", "semanticSystems"],
      ["AR08", "semanticSystems"],
      ["AR02", "phonology"],
    ],
  );

  const resolvedPlan = compileVersionedAdaptationPlan({
    curriculum,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
  });
  const ready = finalizeResolvedAdaptationPlan({
    curriculum,
    languageProfile: germanLanguageProfileFixture,
    registry: germanM5DecisionRegistryFixture,
    plan: resolvedPlan,
  });
  assert.equal(ready.pronunciationResolution.status, "resolved");
  assert.equal(ready.literacyResolution.status, "resolved");
  assert.equal(ready.localizationResolution.status, "resolved");
});

test("M12 generation and LanguageDecision use distinct domain contracts", () => {
  const generationDomainSchema =
    curriculumDocumentGenerationSchema.shape.units.element.shape
      .adaptationRequirements.element.shape.domain;
  for (const domain of CURRICULUM_REQUIREMENT_DOMAINS) {
    assert.equal(generationDomainSchema.safeParse(domain).success, true);
  }
  for (const alias of Object.keys(
    LEGACY_CURRICULUM_REQUIREMENT_DOMAIN_ALIASES,
  )) {
    assert.equal(generationDomainSchema.safeParse(alias).success, false);
  }
  assert.equal(generationDomainSchema.safeParse("arbitrary_domain").success, false);

  assert.equal(languageDecisionDomainSchema.safeParse("participant.reference").success, true);
  assert.equal(
    curriculumRequirementDomainSchema.safeParse("participant.reference").success,
    false,
  );
});
