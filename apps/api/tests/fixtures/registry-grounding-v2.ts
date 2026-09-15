import { languageDecisionRegistrySchema } from "../../src/languages/decisions/language-decision-registry.js";
import { lifecycleProfile } from "./profile-lifecycle-v2.js";
import { germanDecisionRegistryFixture } from "./language-decisions/german.js";

export function groundingProfile(profileId = "test.grounding") {
  const profile = lifecycleProfile(profileId);
  profile.knowledge.phonology.segmentalSystem = { state: "known", value: {
    featureId: "test.feature", description: "Synthetic feature", applicability: "systematic", values: ["synthetic"],
    mechanisms: [{ mechanismId: "test.mechanism", role: "Synthetic mechanism", applicability: "systematic",
      conditions: [], variation: "none_known", relevance: [] }], conditions: [], variation: "none_known", relevance: [],
  } };
  return profile;
}

export function groundingRegistry(version = "1.0.0", registryId = "registry.test") {
  const registry = structuredClone(germanDecisionRegistryFixture);
  registry.identity = { ...registry.identity, registryId, languageId: "test", varietyId: "test.variety" };
  registry.version = version;
  registry.status = "draft";
  registry.decisions = [registry.decisions[0]!];
  const decision = registry.decisions[0]!;
  decision.identity.status = "provisional";
  decision.languageBasis.featureRefs = ["test.feature"];
  decision.languageBasis.mechanismRefs = ["test.mechanism"];
  decision.languageBasis.claimRefs = [];
  decision.evidence.profileClaimRefs = [];
  decision.evidence.externalEvidenceRefs = [];
  decision.compatibility.validFor.languageId = "test";
  decision.compatibility.validFor.varietyId = "test.variety";
  registry.dependencyGraph = { nodes: [{ id: decision.identity.decisionId, version: decision.identity.decisionVersion }], edges: [] };
  return languageDecisionRegistrySchema.parse(registry);
}
