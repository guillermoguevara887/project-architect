import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAdaptedUnitSpec,
} from "../src/languages/adapted/adapted-unit-spec.js";
import { germanA1U01AdaptedUnitFixture } from "./fixtures/adapted-curriculum/german-a1-u01.js";

function issueCodes(input: unknown) {
  return validateAdaptedUnitSpec(input).issues.map((issue) => issue.code);
}

test("a deferred capability may explicitly carry no productive or mastery expectation", () => {
  const fixture = structuredClone(germanA1U01AdaptedUnitFixture);
  const capability = fixture.capabilityRealizations[0]!;
  capability.status = "deferred";
  capability.outputExpectation = "";
  capability.masteryExpectation = "";
  capability.deferredScope = ["future.unit.scope"];

  const result = validateAdaptedUnitSpec(fixture);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
});

test("a deferred capability cannot silently retain a productive output expectation", () => {
  const fixture = structuredClone(germanA1U01AdaptedUnitFixture);
  const capability = fixture.capabilityRealizations[0]!;
  capability.status = "deferred";
  capability.masteryExpectation = "";

  assert.equal(
    issueCodes(fixture).includes("DEFERRED_CAPABILITY_HAS_OUTPUT_EXPECTATION"),
    true,
  );
});

test("an active capability requires explicit productive and mastery expectations", () => {
  const fixture = structuredClone(germanA1U01AdaptedUnitFixture);
  const capability = fixture.capabilityRealizations[0]!;
  capability.outputExpectation = "";
  capability.masteryExpectation = "";

  const codes = issueCodes(fixture);
  assert.equal(codes.includes("CAPABILITY_OUTPUT_EXPECTATION_REQUIRED"), true);
  assert.equal(codes.includes("CAPABILITY_MASTERY_EXPECTATION_REQUIRED"), true);
});
