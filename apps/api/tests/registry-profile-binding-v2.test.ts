import assert from "node:assert/strict";
import test from "node:test";
import { compareRegistryProfileBindingsV2, registryProfileBindingV2Schema } from "../src/languages/decisions/registry-profile-binding-v2.js";
import { validateLanguageDecisionRegistry } from "../src/languages/decisions/language-decision-registry.js";
import { RegistryGroundingErrorV2, RegistryGroundingStoreV2 } from "../src/languages/knowledge/registry-grounding-v2.js";
import { createProfileReviewCandidateV2, reviewProfileCandidateV2 } from "../src/languages/profile/profile-lifecycle-v2.js";
import { lifecycleDecision } from "./fixtures/profile-lifecycle-v2.js";
import { groundingProfile, groundingRegistry } from "./fixtures/registry-grounding-v2.js";
import { germanLanguageProfileFixture } from "./fixtures/language-profile/german.js";

const recordId = "00000000-0000-4000-8000-000000000001";
const binding = registryProfileBindingV2Schema.parse({
  bindingVersion: "1.0.0", profileId: "test.grounding", profileVersion: "2.3.4", schemaVersion: "2.0.0",
  contractVersion: "1.0.0", canonicalRecordId: recordId, canonicalSha256: "a".repeat(64),
});
test("grounding compares every exact identity field", () => {
  assert.deepEqual(compareRegistryProfileBindingsV2(binding, structuredClone(binding)), { ok: true });
});
const changed = {
  bindingVersion: "2.0.0", profileId: "another.profile", profileVersion: "2.3.5", schemaVersion: "3.0.0",
  contractVersion: "2.0.0", canonicalRecordId: "00000000-0000-4000-8000-000000000002", canonicalSha256: "b".repeat(64),
};
for (const [field, value] of Object.entries(changed)) {
  test(`grounding rejects wrong ${field} with a structured field diagnostic`, () => {
    const result = compareRegistryProfileBindingsV2({ ...binding, [field]: value }, binding);
    assert.ok(!result.ok); assert.ok(result.fields.includes(field));
  });
  test(`grounding rejects absent ${field}`, () => {
    const value: Record<string, unknown> = { ...binding }; delete value[field];
    assert.equal(compareRegistryProfileBindingsV2(value, binding).ok, false);
  });
}
for (const value of [null, undefined]) test(`grounding ${String(value)} is explicitly unbound`, () => {
  assert.deepEqual(compareRegistryProfileBindingsV2(value, binding), { ok: false, code: "registry_unbound", fields: [] });
});
test("grounding does not upgrade a legacy Registry or accept partial identity", () => {
  assert.equal(compareRegistryProfileBindingsV2(groundingRegistry(), binding).ok, false);
  assert.equal(compareRegistryProfileBindingsV2({ profileId: binding.profileId, profileVersion: binding.profileVersion }, binding).ok, false);
});
test("grounding rejects malformed hashes and unknown binding fields", () => {
  assert.equal(compareRegistryProfileBindingsV2({ ...binding, canonicalSha256: "not-a-sha" }, binding).ok, false);
  assert.equal(compareRegistryProfileBindingsV2({ ...binding, current: true }, binding).ok, false);
  assert.equal(compareRegistryProfileBindingsV2(binding, {}).ok, false);
});
test("grounding cannot substitute reviewed SHA for canonical SHA", () => {
  const c = createProfileReviewCandidateV2({ profile: groundingProfile(), proposedVersion: "1.0.0", parentCanonical: null,
    origin: { kind: "manual", originRef: "test.origin" } });
  assert.ok(c.ok);
  const o = reviewProfileCandidateV2(c.candidate, lifecycleDecision(c.candidate), null);
  assert.ok(o.ok && o.outcome === "accepted");
  assert.notEqual(c.candidate.snapshot.contentSha256, o.canonical.snapshot.contentSha256);
  const expected = { ...binding, canonicalSha256: o.canonical.snapshot.contentSha256 };
  assert.equal(compareRegistryProfileBindingsV2({ ...expected, canonicalSha256: c.candidate.snapshot.contentSha256 }, expected).ok, false);
});
test("grounding comparison is deterministic, order-independent for object keys and non-mutating", () => {
  const reversed = Object.fromEntries(Object.entries(binding).reverse()), before = structuredClone(reversed);
  for (let i = 0; i < 20; i++) assert.deepEqual(compareRegistryProfileBindingsV2(reversed, binding), { ok: true });
  assert.deepEqual(reversed, before);
});
test("same version and SHA cannot substitute another canonical durable record", () => {
  const result = compareRegistryProfileBindingsV2({ ...binding, canonicalRecordId: changed.canonicalRecordId }, binding);
  assert.deepEqual(result, { ok: false, code: "registry_profile_mismatch", fields: ["canonicalRecordId"] });
});
for (const status of ["candidate", "review", "deprecated", "canonical"]) test(`grounding creation rejects caller ${status} objects as durable identity`, async () => {
  const store = new RegistryGroundingStoreV2(() => { throw new Error("must not open DB"); });
  await assert.rejects(store.createRegistry({ userId: recordId, canonicalRecordId: { id: recordId, status }, registry: groundingRegistry() }),
    (e) => e instanceof RegistryGroundingErrorV2 && e.code === "invalid_input");
});
test("grounding creation rejects caller-supplied binding identity overrides", async () => {
  const store = new RegistryGroundingStoreV2(() => { throw new Error("must not open DB"); });
  await assert.rejects(store.createRegistry({ userId: recordId, canonicalRecordId: recordId, registry: groundingRegistry(), profileBinding: binding }),
    (e) => e instanceof RegistryGroundingErrorV2 && e.code === "invalid_input");
});
test("existing Registry validator supports explicit v2 references without changing legacy schema selection", () => {
  const registry = groundingRegistry(), profile = groundingProfile();
  assert.equal(validateLanguageDecisionRegistry(registry, { languageProfileV2: profile }).valid, true);
  assert.equal(validateLanguageDecisionRegistry(registry, { languageProfile: profile as unknown as typeof germanLanguageProfileFixture }).valid, false);
  assert.equal(validateLanguageDecisionRegistry(registry, { languageProfileV2: profile, languageProfile: germanLanguageProfileFixture }).valid, false);
});
for (const field of ["featureRefs", "mechanismRefs", "claimRefs"] as const) test(`v2 Registry context rejects unresolved ${field}`, () => {
  const registry = groundingRegistry(); registry.decisions[0]!.languageBasis[field] = ["nonexistent.ref"];
  registry.validation.strictProfileGrounding = false;
  assert.equal(validateLanguageDecisionRegistry(registry, { languageProfileV2: groundingProfile() }).valid, false);
});
