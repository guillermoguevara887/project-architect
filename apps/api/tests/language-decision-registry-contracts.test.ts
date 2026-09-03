import assert from "node:assert/strict";
import test from "node:test";
import {
  languageDecisionRegistrySchema,
  resolveRegistryDecision,
  validateLanguageDecisionRegistry,
} from "../src/languages/decisions/language-decision-registry.js";
import { germanDecisionRegistryFixture } from "./fixtures/language-decisions/german.js";
import { japaneseDecisionRegistryFixture } from "./fixtures/language-decisions/japanese.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";
import { japaneseLanguageProfileFixture } from "./fixtures/language-profile/japanese.js";

function germanIssueCodes(input: unknown) {
  return validateLanguageDecisionRegistry(input, {
    languageProfile: germanLanguageProfileFixture,
  }).issues.map((issue) => issue.code);
}

test("German decision registry satisfies M3 structural, semantic and profile-grounding contracts", () => {
  assert.equal(languageDecisionRegistrySchema.safeParse(germanDecisionRegistryFixture).success, true);
  const result = validateLanguageDecisionRegistry(germanDecisionRegistryFixture, {
    languageProfile: germanLanguageProfileFixture,
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("Japanese writing strategy uses the same registry contract without language-specific fields", () => {
  assert.equal(languageDecisionRegistrySchema.safeParse(japaneseDecisionRegistryFixture).success, true);
  const result = validateLanguageDecisionRegistry(japaneseDecisionRegistryFixture, {
    languageProfile: japaneseLanguageProfileFixture,
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("productive scope must remain inside recognition scope", () => {
  const fixture = structuredClone(germanDecisionRegistryFixture);
  fixture.decisions[0]!.resolution.productiveRange.push("de.role.unrecognized_new_target");

  assert.equal(
    germanIssueCodes(fixture).includes("PRODUCTIVE_RANGE_EXCEEDS_RECOGNITION_RANGE"),
    true,
  );
});

test("deferred scope cannot silently become productive", () => {
  const fixture = structuredClone(germanDecisionRegistryFixture);
  fixture.decisions[0]!.resolution.deferredScope = ["de.role.actor"];

  assert.equal(germanIssueCodes(fixture).includes("DEFERRED_SCOPE_IS_PRODUCTIVE"), true);
});

test("language-basis references must resolve against LanguageProfile", () => {
  const fixture = structuredClone(germanDecisionRegistryFixture);
  fixture.decisions[0]!.languageBasis.featureRefs = ["de.feature.does_not_exist"];

  assert.equal(
    germanIssueCodes(fixture).includes("BROKEN_LANGUAGE_FEATURE_REFERENCE"),
    true,
  );
});

test("validated decisions require reviewed non-contested evidence", () => {
  const fixture = structuredClone(germanDecisionRegistryFixture);
  fixture.decisions[0]!.evidence.confidence = "contested";

  assert.equal(
    germanIssueCodes(fixture).includes("VALIDATED_DECISION_HAS_INSUFFICIENT_EVIDENCE"),
    true,
  );
});

test("strict profile grounding fails when validation context is absent", () => {
  const result = validateLanguageDecisionRegistry(germanDecisionRegistryFixture);
  assert.equal(result.valid, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "MISSING_LANGUAGE_PROFILE_CONTEXT"),
    true,
  );
});

test("hard decision dependencies must remain acyclic", () => {
  const fixture = structuredClone(germanDecisionRegistryFixture);
  const actor = fixture.decisions[0]!;
  const register = fixture.decisions[1]!;
  actor.dependencies.requiresDecisionRefs = [
    { id: "social.register.initial", version: "1.0.0" },
  ];
  register.dependencies.requiresDecisionRefs = [
    { id: "participant.actor_affected", version: "1.0.0" },
  ];
  fixture.dependencyGraph.edges = [
    {
      from: { id: "participant.actor_affected", version: "1.0.0" },
      to: { id: "social.register.initial", version: "1.0.0" },
      relation: "requires",
    },
    {
      from: { id: "social.register.initial", version: "1.0.0" },
      to: { id: "participant.actor_affected", version: "1.0.0" },
      relation: "requires",
    },
  ];

  assert.equal(germanIssueCodes(fixture).includes("CYCLE_DETECTED"), true);
});

test("dependency graph is a checked projection of decision dependencies", () => {
  const fixture = structuredClone(germanDecisionRegistryFixture);
  fixture.dependencyGraph.edges.push({
    from: { id: "participant.actor_affected", version: "1.0.0" },
    to: { id: "social.register.initial", version: "1.0.0" },
    relation: "benefits_from",
  });

  assert.equal(
    germanIssueCodes(fixture).includes("DEPENDENCY_GRAPH_EDGE_MISMATCH"),
    true,
  );
});

test("supersession requires a newer version of the same stable decision id", () => {
  const fixture = structuredClone(germanDecisionRegistryFixture);
  const oldDecision = fixture.decisions[0]!;
  oldDecision.identity.status = "superseded";
  const replacement = structuredClone(oldDecision);
  replacement.identity.status = "validated";
  replacement.identity.decisionVersion = "0.9.0";
  replacement.lifecycle.supersedes = {
    id: "participant.actor_affected",
    version: "1.0.0",
  };
  fixture.decisions.push(replacement);
  fixture.dependencyGraph.nodes.push({
    id: "participant.actor_affected",
    version: "0.9.0",
  });

  assert.equal(
    germanIssueCodes(fixture).includes("SUPERSESSION_VERSION_NOT_NEWER"),
    true,
  );
});

test("registry lookup deterministically returns reuse, extend or none", () => {
  assert.deepEqual(
    resolveRegistryDecision(germanDecisionRegistryFixture, {
      adaptationRequirementRef: "AR04",
      levelScope: "A1",
    }),
    {
      mode: "reuse",
      decisionRef: { id: "participant.actor_affected", version: "1.0.0" },
      reason: "Validated decision covers the requested adaptation scope.",
    },
  );

  assert.deepEqual(
    resolveRegistryDecision(germanDecisionRegistryFixture, {
      adaptationRequirementRef: "AR04",
      levelScope: "A2",
    }),
    {
      mode: "extend",
      decisionRef: { id: "participant.actor_affected", version: "1.0.0" },
      reason: "A validated decision exists but its scope must be extended.",
    },
  );

  assert.deepEqual(
    resolveRegistryDecision(germanDecisionRegistryFixture, {
      adaptationRequirementRef: "AR99",
      levelScope: "A1",
    }),
    {
      mode: "none",
      reason: "No compatible validated decision exists for this requirement.",
    },
  );
});
