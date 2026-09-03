import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAdaptationSignals,
  languageProfileSchema,
  validateLanguageProfile,
} from "../src/languages/profile/language-profile.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { japaneseLanguageProfileFixture } from "./fixtures/language-profile/japanese.js";
import { mandarinLanguageProfileFixture } from "./fixtures/language-profile/mandarin.js";
import { fixtureSourceId } from "./fixtures/language-profile/factory.js";

function issueCodes(input: unknown) {
  return validateLanguageProfile(input).issues.map((issue) => issue.code);
}

for (const [label, fixture] of [
  ["German", germanLanguageProfileFixture],
  ["Japanese", japaneseLanguageProfileFixture],
  ["Mandarin", mandarinLanguageProfileFixture],
] as const) {
  test(`${label} LanguageProfile fixture satisfies v1.0 structural and semantic contracts`, () => {
    assert.equal(languageProfileSchema.safeParse(fixture).success, true);
    const result = validateLanguageProfile(fixture);
    assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.issues, []);
    assert.deepEqual(fixture.adaptationSignals, deriveAdaptationSignals(fixture));
  });
}

test("adaptation signals are derived rather than arbitrary declarations", () => {
  const fixture = structuredClone(mandarinLanguageProfileFixture);
  fixture.adaptationSignals = fixture.adaptationSignals.filter(
    (signal) => signal !== "lexical_tone",
  );
  assert.equal(issueCodes(fixture).includes("ADAPTATION_SIGNAL_MISMATCH"), true);
});

test("restricted phenomena do not automatically become adaptation signals", () => {
  assert.equal(germanLanguageProfileFixture.participantReference.zeroReference.applicability, "restricted");
  assert.equal(deriveAdaptationSignals(germanLanguageProfileFixture).includes("zero_reference"), false);
});

test("profile validator reports duplicate feature ids", () => {
  const fixture = structuredClone(germanLanguageProfileFixture);
  fixture.nominalSystem.numberMarking.featureId = fixture.nominalSystem.grammaticalGender.featureId;
  assert.equal(issueCodes(fixture).includes("DUPLICATE_DOMAIN_ID"), true);
});

test("profile validator reports broken evidence references", () => {
  const fixture = structuredClone(germanLanguageProfileFixture);
  fixture.nominalSystem.caseMarking.evidenceRefs = ["missing.source"];
  assert.equal(issueCodes(fixture).includes("BROKEN_EVIDENCE_REFERENCE"), true);
});

test("profile validator reports claims pointing to unknown features", () => {
  const fixture = structuredClone(japaneseLanguageProfileFixture);
  fixture.evidenceRegistry.claims[0]!.featureRef = "ja.feature.missing";
  assert.equal(issueCodes(fixture).includes("BROKEN_FEATURE_REFERENCE"), true);
});

test("every profile section must declare coverage", () => {
  const fixture = structuredClone(mandarinLanguageProfileFixture);
  fixture.profileCoverage = fixture.profileCoverage.filter((entry) => entry.section !== "phonology");
  assert.equal(issueCodes(fixture).includes("MISSING_PROFILE_COVERAGE"), true);
});

test("reviewed sections cannot hide unresolved evidence conflicts", () => {
  const fixture = structuredClone(germanLanguageProfileFixture);
  fixture.evidenceRegistry.claims.push({
    claimId: "de.claim.case.alternative",
    featureRef: "de.nominal.case",
    statement: "Alternative fixture claim requiring explicit conflict resolution.",
    evidenceRefs: [fixtureSourceId],
    confidence: "contested",
    reviewStatus: "needs_review",
  });
  fixture.evidenceRegistry.conflicts.push({
    conflictId: "de.conflict.case.fixture",
    claimRefs: ["de.claim.case", "de.claim.case.alternative"],
    conflictType: "scope_disagreement",
    resolutionStatus: "unresolved",
    notes: "Intentional unresolved fixture conflict.",
  });
  assert.equal(issueCodes(fixture).includes("REVIEWED_SECTION_HAS_UNRESOLVED_CONFLICT"), true);
});

test("not_applicable cannot coexist with active feature values", () => {
  const fixture = structuredClone(germanLanguageProfileFixture);
  fixture.nominalSystem.nounClasses.values = ["active class"];
  assert.equal(issueCodes(fixture).includes("STRUCTURAL_VALIDATION_ERROR"), true);
});

test("profile identity must resolve its declared scripts", () => {
  const fixture = structuredClone(japaneseLanguageProfileFixture);
  fixture.identity.scriptScope.push("ja.script.missing");
  assert.equal(issueCodes(fixture).includes("BROKEN_SCRIPT_REFERENCE"), true);
});
