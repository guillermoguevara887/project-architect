import assert from "node:assert/strict";
import test from "node:test";
import {
  curriculumUnitSpecSchema,
  validateCurriculumUnitSpec,
} from "../src/languages/curriculum/curriculum-unit-spec.js";
import { findDirectedCycle } from "../src/languages/curriculum/graph.js";
import { semanticVersionSchema } from "../src/languages/curriculum/primitives.js";
import { a1U01CurriculumFixture } from "./fixtures/language-curriculum/a1-u01.js";

function issueCodes(input: unknown) {
  return validateCurriculumUnitSpec(input).issues.map((issue) => issue.code);
}

test("A1-U01 golden curriculum fixture satisfies v1.0 structural and semantic contracts", () => {
  assert.equal(curriculumUnitSpecSchema.safeParse(a1U01CurriculumFixture).success, true);

  const result = validateCurriculumUnitSpec(a1U01CurriculumFixture);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("curriculum validator reports broken references", () => {
  const fixture = structuredClone(a1U01CurriculumFixture);
  fixture.learningRoute.steps[0]!.capabilityRefs = ["C99"];

  assert.equal(issueCodes(fixture).includes("BROKEN_REFERENCE"), true);
});

test("curriculum validator reports duplicate domain ids within a collection", () => {
  const fixture = structuredClone(a1U01CurriculumFixture);
  fixture.competencies.push(structuredClone(fixture.competencies[0]!));

  assert.equal(issueCodes(fixture).includes("DUPLICATE_DOMAIN_ID"), true);
});

test("curriculum validator rejects hard dependency cycles", () => {
  const fixture = structuredClone(a1U01CurriculumFixture);
  const s01 = fixture.learningRoute.steps.find((step) => step.stepId === "S01")!;
  const s02 = fixture.learningRoute.steps.find((step) => step.stepId === "S02")!;
  s01.dependencies.push({ stepRef: "S02", relation: "requires" });
  s02.dependencies.push({ stepRef: "S01", relation: "requires" });

  assert.equal(issueCodes(fixture).includes("CYCLE_DETECTED"), true);
});

test("terminal capabilities require explicit mastery evidence", () => {
  const fixture = structuredClone(a1U01CurriculumFixture);
  const competency = fixture.competencies.find(
    (candidate) => candidate.competencyId === "C01",
  )!;
  competency.masteryEvidenceRefs = [];

  assert.equal(
    issueCodes(fixture).includes("TERMINAL_CAPABILITY_WITHOUT_MASTERY_EVIDENCE"),
    true,
  );
});

test("introduced capabilities cannot simultaneously be required", () => {
  const fixture = structuredClone(a1U01CurriculumFixture);
  fixture.scope.capabilityFlow.required = ["C01"];

  assert.equal(issueCodes(fixture).includes("CAPABILITY_FLOW_CONFLICT"), true);
});

test("curriculum fidelity and projection gates are mandatory and blocking", () => {
  const fixture = structuredClone(a1U01CurriculumFixture);
  fixture.qualityGates = fixture.qualityGates.filter(
    (gate) => gate.category !== "linguistic_projection",
  );

  assert.equal(issueCodes(fixture).includes("MISSING_BLOCKING_QUALITY_GATE"), true);
});

test("semantic versions are strict semver values", () => {
  assert.equal(semanticVersionSchema.safeParse("1.0.0").success, true);
  assert.equal(semanticVersionSchema.safeParse("1.0").success, false);
  assert.equal(semanticVersionSchema.safeParse("v1.0.0").success, false);
});

test("shared graph utility returns a concrete directed cycle", () => {
  assert.deepEqual(
    findDirectedCycle(
      ["A", "B", "C"],
      [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "A" },
      ],
    ),
    ["A", "B", "C", "A"],
  );

  assert.equal(
    findDirectedCycle(
      ["A", "B", "C"],
      [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
    ),
    null,
  );
});
