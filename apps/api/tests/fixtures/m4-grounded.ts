import { languageDecisionRegistrySchema } from "../../src/languages/decisions/language-decision-registry.js";
import { germanDecisionRegistryFixture } from "./language-decisions/german.js";

/** Synthetic approved strategies, not real-language evidence or S2 coverage. */
export function m4Registry(version = "1.0.0", registryId = "registry.m4") {
  const registry = structuredClone(germanDecisionRegistryFixture);
  registry.identity = { ...registry.identity, registryId, languageId: "test", varietyId: "test.variety" };
  registry.version = version;
  for (const decision of registry.decisions) {
    decision.languageBasis.featureRefs = ["test.feature"];
    decision.languageBasis.mechanismRefs = ["test.mechanism"];
    decision.languageBasis.claimRefs = [];
    decision.evidence.profileClaimRefs = [];
    decision.evidence.externalEvidenceRefs = ["fixture.reference"];
    decision.compatibility.validFor.languageId = "test";
    decision.compatibility.validFor.varietyId = "test.variety";
  }
  return languageDecisionRegistrySchema.parse(registry);
}
