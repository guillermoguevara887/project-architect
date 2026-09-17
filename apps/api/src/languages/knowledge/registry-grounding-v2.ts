import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { dbTimestamp } from "../../db/timestamps.js";
import { domainIdSchema, semanticVersionSchema, versionedRefSchema } from "../curriculum/primitives.js";
import { languageDecisionRegistrySchema, validateLanguageDecisionRegistry, type LanguageDecisionRegistry } from "../decisions/language-decision-registry.js";
import { compareRegistryProfileBindingsV2, registryProfileBindingV2Schema, REGISTRY_PROFILE_BINDING_VERSION,
  type RegistryProfileBindingV2, type RegistryGroundingCheckV2 } from "../decisions/registry-profile-binding-v2.js";
import { languageProfileV2Schema } from "../profile/language-profile-v2.js";
import { ProfileLifecycleStoreV2, type ProfileCanonicalRecordV2 } from "../profile/profile-lifecycle-store-v2.js";

export type RegistryGroundingErrorCodeV2 = "invalid_input" | "invalid_registry" | "canonical_not_found" |
  "registry_not_found" | "registry_not_found_for_canonical" | "registry_unbound" | "registry_profile_mismatch" | "registry_version_exists" | "storage_integrity";
export class RegistryGroundingErrorV2 extends Error {
  constructor(readonly code: RegistryGroundingErrorCodeV2, readonly fields: readonly string[] = []) {
    super(code); this.name = "RegistryGroundingErrorV2";
  }
}
function problem(code: RegistryGroundingErrorCodeV2, fields: readonly string[] = []): never {
  throw new RegistryGroundingErrorV2(code, fields);
}
const uuid = z.string().uuid().transform((id) => id.toLowerCase());
const createInput = z.object({ userId: uuid, canonicalRecordId: uuid, registry: languageDecisionRegistrySchema }).strict();
const recordInput = z.object({ userId: uuid, registryRecordId: uuid }).strict();
const currentInput = z.object({ userId: uuid, profileId: domainIdSchema, registryRef: versionedRefSchema }).strict();
const rowSchema = z.object({
  id: uuid, user_id: uuid, profile_record_id: uuid.nullable(), canonical_record_id: uuid.nullable(),
  profile_binding_v2: z.unknown(), registry_id: domainIdSchema, language_id: domainIdSchema,
  variety_id: domainIdSchema, curriculum_id: domainIdSchema, version: semanticVersionSchema,
  status: z.enum(["draft", "review", "canonical", "deprecated"]), registry: z.unknown(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  created_at: z.union([z.date(), z.string()]).transform(dbTimestamp),
}).strict();
export type GroundedRegistryRecordV2 = Readonly<{
  id: string; userId: string; registry: LanguageDecisionRegistry; profileBinding: RegistryProfileBindingV2;
  contentSha256: string; createdAt: Date;
}>;
type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(frozen); Object.freeze(value);
  }
  return value;
}
function registrySha(registry: LanguageDecisionRegistry): string {
  // Existing Registry artifact hash, not another profile/canonical identity.
  return createHash("sha256").update(JSON.stringify(registry), "utf8").digest("hex");
}
function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : problem("invalid_input", parsed.error.issues.map((i) => i.path.join(".")));
}
function lifecycle(tx: Transaction) {
  // S3B reads participate in this outer REPEATABLE READ transaction. There is no
  // second connection/snapshot and no promotion operation exposed by this API.
  return new ProfileLifecycleStoreV2(() => ({ transaction: (operation) => operation(tx) }));
}
async function readCanonical(tx: Transaction, id: string): Promise<ProfileCanonicalRecordV2> {
  const canonical = await lifecycle(tx).getCanonical(id);
  return canonical ?? problem("canonical_not_found");
}
function bindingFromRead(canonical: ProfileCanonicalRecordV2): RegistryProfileBindingV2 {
  // Private constructor: callers can only select a durable record ID, never
  // provide independent profile identity fields or a fabricated canonical.
  return frozen(registryProfileBindingV2Schema.parse({
    bindingVersion: REGISTRY_PROFILE_BINDING_VERSION,
    canonicalRecordId: canonical.id, profileId: canonical.snapshot.profileId,
    profileVersion: canonical.snapshot.version, schemaVersion: canonical.snapshot.schemaVersion,
    contractVersion: canonical.snapshot.contractVersion, canonicalSha256: canonical.snapshot.contentSha256,
  }));
}
function validateArtifact(registry: LanguageDecisionRegistry, canonical: ProfileCanonicalRecordV2) {
  const profile = languageProfileV2Schema.parse(JSON.parse(canonical.snapshotJson));
  const validation = validateLanguageDecisionRegistry(registry, { languageProfileV2: profile });
  if (!validation.valid) problem("invalid_registry", validation.issues.map((issue) => issue.path));
}
async function selectRegistry(tx: Transaction, userId: string, id: string) {
  const rows = await tx.execute(sql`SELECT * FROM language_decision_registry_versions WHERE id=${id} AND user_id=${userId}`);
  return rows[0] ?? problem("registry_not_found");
}
async function decode(tx: Transaction, input: unknown): Promise<GroundedRegistryRecordV2> {
  // Database/connection errors propagate. Only invalid durable data is mapped
  // to storage_integrity; there is no best-effort fallback to a legacy registry.
  const parsed = rowSchema.safeParse(input);
  if (!parsed.success) return problem("storage_integrity");
  const row = parsed.data;
  if (row.profile_record_id !== null && row.canonical_record_id === null && row.profile_binding_v2 === null) return problem("registry_unbound");
  if (row.profile_record_id !== null || row.canonical_record_id === null) return problem("storage_integrity");
  const canonical = await lifecycle(tx).getCanonical(row.canonical_record_id);
  if (!canonical) return problem("storage_integrity", ["canonicalRecordId"]);
  const checked = compareRegistryProfileBindingsV2(row.profile_binding_v2, bindingFromRead(canonical));
  if (!checked.ok) return problem("storage_integrity", checked.fields);
  const registry = languageDecisionRegistrySchema.safeParse(row.registry);
  if (!registry.success) return problem("storage_integrity", ["registry"]);
  const r = registry.data;
  if (row.registry_id !== r.identity.registryId || row.language_id !== r.identity.languageId || row.variety_id !== r.identity.varietyId ||
    row.curriculum_id !== r.identity.curriculumId || row.version !== r.version || row.status !== r.status || row.content_sha256 !== registrySha(r)) {
    return problem("storage_integrity", ["registry"]);
  }
  try { validateArtifact(r, canonical); } catch { return problem("storage_integrity", ["registry"]); }
  return frozen({ id: row.id, userId: row.user_id, registry: r, profileBinding: bindingFromRead(canonical),
    contentSha256: row.content_sha256, createdAt: row.created_at });
}

/** Official durable grounding boundary. Creation pins an explicit canonical ID;
 * current lookup is a consistent snapshot, never a lease on future currentness.
 * Existing user scoping is preserved; reviewer/canonical authorization is not
 * introduced here. No legacy Registry is relabeled or upgraded by this service.
 */
export class RegistryGroundingStoreV2 {
  constructor(private readonly database: () => Pick<Database, "transaction"> = getDb) {}

  async createRegistry(input: unknown): Promise<GroundedRegistryRecordV2> {
    // Clone/normalize before any await so caller mutation cannot swap artifact.
    const args = parseInput(createInput, input);
    try {
      return await this.database().transaction(async (tx) => {
        const canonical = await readCanonical(tx, args.canonicalRecordId);
        validateArtifact(args.registry, canonical);
        const binding = bindingFromRead(canonical), r = args.registry;
        const rows = await tx.execute(sql`INSERT INTO language_decision_registry_versions
          (user_id,profile_record_id,canonical_record_id,profile_binding_v2,registry_id,language_id,variety_id,curriculum_id,version,status,registry,content_sha256)
          VALUES (${args.userId},NULL,${canonical.id},${JSON.stringify(binding)}::jsonb,${r.identity.registryId},${r.identity.languageId},
            ${r.identity.varietyId},${r.identity.curriculumId},${r.version},${r.status},${JSON.stringify(r)}::jsonb,${registrySha(r)}) RETURNING *`);
        return decode(tx, rows[0]);
      }, { isolationLevel: "repeatable read" });
    } catch (error) {
      const candidates = [error, error instanceof Error ? error.cause : undefined];
      if (candidates.some((e) => typeof e === "object" && e !== null && "code" in e && e.code === "23505" &&
        "constraint_name" in e && typeof e.constraint_name === "string" &&
        e.constraint_name.startsWith("language_decision_registry_versions_user_registry_version_"))) {
        return problem("registry_version_exists");
      }
      throw error;
    }
  }

  async getRegistry(userId: string, registryRecordId: string): Promise<GroundedRegistryRecordV2> {
    const args = parseInput(recordInput, { userId, registryRecordId });
    return this.database().transaction(async (tx) => decode(tx, await selectRegistry(tx, args.userId, args.registryRecordId)),
      { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async checkRegistryGrounding(userId: string, registryRecordId: string, canonicalRecordId: string): Promise<RegistryGroundingCheckV2> {
    const args = parseInput(recordInput.extend({ canonicalRecordId: uuid }), { userId, registryRecordId, canonicalRecordId });
    return this.database().transaction(async (tx) => {
      const canonical = await readCanonical(tx, args.canonicalRecordId);
      let record: GroundedRegistryRecordV2;
      try { record = await decode(tx, await selectRegistry(tx, args.userId, args.registryRecordId)); }
      catch (error) {
        if (error instanceof RegistryGroundingErrorV2 && error.code === "registry_unbound") return { ok: false, code: "registry_unbound", fields: [] };
        throw error;
      }
      return compareRegistryProfileBindingsV2(record.profileBinding, bindingFromRead(canonical));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  /** Pinned historical/current pair from one snapshot. Consumers must not join
   * independent getRegistry/getCanonical calls or reconstruct binding fields. */
  async getRegistryForCanonical(userId: string, registryRecordId: string, canonicalRecordId: string): Promise<{
    registry: GroundedRegistryRecordV2; canonical: ProfileCanonicalRecordV2;
  }> {
    const args = parseInput(recordInput.extend({ canonicalRecordId: uuid }), { userId, registryRecordId, canonicalRecordId });
    return this.database().transaction(async (tx) => {
      const canonical = await readCanonical(tx, args.canonicalRecordId);
      const registry = await decode(tx, await selectRegistry(tx, args.userId, args.registryRecordId));
      const checked = compareRegistryProfileBindingsV2(registry.profileBinding, bindingFromRead(canonical));
      if (!checked.ok) return problem("registry_profile_mismatch", checked.fields);
      return { registry, canonical };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async getRegistryForCurrentCanonical(input: unknown): Promise<{ registry: GroundedRegistryRecordV2; canonical: ProfileCanonicalRecordV2 }> {
    const args = parseInput(currentInput, input);
    return this.database().transaction(async (tx) => {
      const canonical = await lifecycle(tx).getCurrentCanonical(args.profileId);
      if (!canonical) return problem("canonical_not_found");
      // Registry version is explicit too. Never pick a latest/compatible legacy
      // artifact just because the new canonical has the same profileId.
      const rows = await tx.execute(sql`SELECT * FROM language_decision_registry_versions
        WHERE user_id=${args.userId} AND registry_id=${args.registryRef.id} AND version=${args.registryRef.version}
          AND canonical_record_id=${canonical.id}`);
      if (!rows[0]) return problem("registry_not_found_for_canonical");
      const registry = await decode(tx, rows[0]);
      const checked = compareRegistryProfileBindingsV2(registry.profileBinding, bindingFromRead(canonical));
      if (!checked.ok) return problem("storage_integrity", checked.fields);
      return { registry, canonical };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
}
