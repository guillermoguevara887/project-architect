import { z } from "zod";
import { domainIdSchema, semanticVersionSchema } from "../curriculum/primitives.js";
import { LANGUAGE_PROFILE_V2_SCHEMA_VERSION } from "../profile/language-profile-v2.js";
import { REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION } from "../profile/requirement-evidence-targets.js";

export const REGISTRY_PROFILE_BINDING_VERSION = "1.0.0";
export const registryProfileBindingV2Schema = z.object({
  bindingVersion: z.literal(REGISTRY_PROFILE_BINDING_VERSION),
  profileId: domainIdSchema,
  profileVersion: semanticVersionSchema,
  schemaVersion: z.literal(LANGUAGE_PROFILE_V2_SCHEMA_VERSION),
  contractVersion: z.literal(REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION),
  canonicalRecordId: z.string().uuid(),
  canonicalSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type RegistryProfileBindingV2 = Readonly<z.infer<typeof registryProfileBindingV2Schema>>;
export type RegistryGroundingCheckV2 = { readonly ok: true } | {
  readonly ok: false;
  readonly code: "registry_unbound" | "registry_binding_invalid" | "canonical_binding_invalid" | "registry_profile_mismatch";
  readonly fields: readonly string[];
};

/** One pure identity comparison. This does not establish database provenance:
 * use RegistryGroundingStoreV2 to create bindings and validate durable records.
 * A matching binding alone is not evidence sufficiency or decision approval.
 */
export function compareRegistryProfileBindingsV2(actualInput: unknown, expectedInput: unknown): RegistryGroundingCheckV2 {
  if (actualInput === null || actualInput === undefined) return { ok: false, code: "registry_unbound", fields: [] };
  const actual = registryProfileBindingV2Schema.safeParse(actualInput);
  if (!actual.success) return { ok: false, code: "registry_binding_invalid", fields: actual.error.issues.map((i) => i.path.join(".")) };
  const expected = registryProfileBindingV2Schema.safeParse(expectedInput);
  if (!expected.success) return { ok: false, code: "canonical_binding_invalid", fields: expected.error.issues.map((i) => i.path.join(".")) };
  const fields = (Object.keys(registryProfileBindingV2Schema.shape) as (keyof RegistryProfileBindingV2)[])
    .filter((key) => actual.data[key] !== expected.data[key]);
  return fields.length ? { ok: false, code: "registry_profile_mismatch", fields } : { ok: true };
}
