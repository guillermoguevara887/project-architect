import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptationPlanSchema,
  compileInitialAdaptationPlan,
  validateAdaptationPlan,
} from "../src/languages/adaptation/adaptation-plan.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

function compileGerman() {
  return compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
}

test("M4 deterministically compiles A1-U01 German into an initial AdaptationPlan", () => {
  const result = compileGerman();
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues, null, 2));
  assert.ok(result.plan);
  assert.equal(adaptationPlanSchema.safeParse(result.plan).success, true);
  assert.equal(result.plan.status, "gaps_identified");
  assert.equal(result.plan.readiness.state, "needs_review");
  assert.equal(result.plan.outputs.routeReady, false);
});

test("M4 reuses AR03 and AR04 before creating any research gap", () => {
  const plan = compileGerman().plan!;
  const byRequirement = new Map(
    plan.requirementResolution.map((resolution) => [resolution.requirementRef, resolution]),
  );

  assert.equal(byRequirement.get("AR03")?.resolutionMode, "reuse");
  assert.deepEqual(byRequirement.get("AR03")?.decisionRef, {
    id: "social.register.initial",
    version: "1.0.0",
  });
  assert.equal(byRequirement.get("AR04")?.resolutionMode, "reuse");
  assert.deepEqual(byRequirement.get("AR04")?.decisionRef, {
    id: "participant.actor_affected",
    version: "1.0.0",
  });
  assert.equal(plan.gapAnalysis.some((gap) => gap.requirementRef === "AR03"), false);
  assert.equal(plan.gapAnalysis.some((gap) => gap.requirementRef === "AR04"), false);
});

test("M4 identifies the eight unresolved German requirements as explicit blocking gaps", () => {
  const plan = compileGerman().plan!;
  assert.equal(plan.requirementResolution.length, 10);
  assert.equal(plan.gapAnalysis.length, 8);
  assert.deepEqual(
    plan.gapAnalysis.map((gap) => gap.requirementRef).sort(),
    ["AR01", "AR02", "AR05", "AR06", "AR07", "AR08", "AR09", "AR10"],
  );
  assert.equal(plan.gapAnalysis.every((gap) => gap.criticality === "blocking"), true);
  assert.equal(plan.readiness.blockingGapRefs.length, 8);
  assert.equal(
    plan.gapAnalysis.find((gap) => gap.requirementRef === "AR10")?.gapType,
    "localization_gap",
  );
});

test("reviewed German profile keeps M4 research at registry reasoning instead of external research", () => {
  const plan = compileGerman().plan!;
  assert.equal(
    plan.gapAnalysis.every((gap) => gap.researchNecessity === "registry_reasoning"),
    true,
  );
  assert.equal(plan.researchPlan.length, 5);
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
    plan.researchPlan.some((task) => task.researchNecessity === "external_research"),
    false,
  );
});

test("M4 records reused decisions and their known pedagogical impacts", () => {
  const plan = compileGerman().plan!;
  assert.deepEqual(plan.decisionChanges.reusedDecisionRefs, [
    { id: "social.register.initial", version: "1.0.0" },
    { id: "participant.actor_affected", version: "1.0.0" },
  ]);
  assert.equal(plan.pedagogicalImpactAnalysis.length, 1);
  assert.deepEqual(plan.pedagogicalImpactAnalysis[0]?.sourceDecisionRefs, [
    { id: "participant.actor_affected", version: "1.0.0" },
  ]);
  assert.equal(plan.pedagogicalImpactAnalysis[0]?.impactType, "granularity");
  assert.deepEqual(plan.pedagogicalImpactAnalysis[0]?.affectedStepRefs, [
    "S09",
    "S10",
    "S12",
  ]);
});

test("M4 compiler output is deterministic for identical pinned inputs", () => {
  const first = compileGerman();
  const second = compileGerman();
  assert.deepEqual(first, second);
});

test("empty registry produces ten gaps but still groups research deterministically", () => {
  const registry = structuredClone(germanDecisionRegistryFixture);
  registry.decisions = [];
  registry.dependencyGraph.nodes = [];
  registry.dependencyGraph.edges = [];

  const result = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry,
  });
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues, null, 2));
  assert.ok(result.plan);
  assert.equal(result.plan.gapAnalysis.length, 10);
  assert.equal(result.plan.decisionChanges.reusedDecisionRefs.length, 0);
  assert.equal(result.plan.researchPlan.length, 5);
});

test("M4 distinguishes extend from resolve when a validated decision exists outside requested scope", () => {
  const registry = structuredClone(germanDecisionRegistryFixture);
  const participantDecision = registry.decisions.find(
    (decision) => decision.identity.decisionId === "participant.actor_affected",
  )!;
  participantDecision.scope = {
    scopeType: "unit_contextual",
    unitScope: "A1-U99",
  };

  const result = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry,
  });
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues, null, 2));
  assert.ok(result.plan);
  const ar04 = result.plan.requirementResolution.find(
    (resolution) => resolution.requirementRef === "AR04",
  );
  assert.equal(ar04?.resolutionMode, "extend");
  assert.equal(ar04?.coverageStatus, "partial");
  assert.equal(
    result.plan.gapAnalysis.find((gap) => gap.requirementRef === "AR04")?.gapType,
    "insufficient_scope",
  );
  assert.deepEqual(result.plan.decisionChanges.extendedDecisionRefs, [
    { id: "participant.actor_affected", version: "1.0.0" },
  ]);
});

test("AdaptationPlan validator rejects missing requirement resolutions", () => {
  const plan = structuredClone(compileGerman().plan!);
  plan.requirementResolution = plan.requirementResolution.filter(
    (resolution) => resolution.requirementRef !== "AR05",
  );

  const validation = validateAdaptationPlan(plan, {
    curriculum: a1U01CurriculumFixture,
    languageProfile: germanLanguageProfileFixture,
    registry: germanDecisionRegistryFixture,
  });
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some((issue) => issue.code === "MISSING_REQUIREMENT_RESOLUTION"),
    true,
  );
});

test("M4 refuses to compile mismatched profile and registry identities", () => {
  const profile = structuredClone(germanLanguageProfileFixture);
  profile.identity.varietyId = "de.other";

  const result = compileInitialAdaptationPlan({
    curriculum: a1U01CurriculumFixture,
    languageProfile: profile,
    registry: germanDecisionRegistryFixture,
  });
  assert.equal(result.plan, null);
  assert.equal(result.validation.valid, false);
  assert.equal(
    result.validation.issues.some(
      (issue) => issue.code === "PROFILE_REGISTRY_IDENTITY_MISMATCH",
    ),
    true,
  );
});
