import { createHash } from "node:crypto";
import { z } from "zod";
import { domainIdSchema, semanticVersionSchema } from "../curriculum/primitives.js";
import { validationIssue, type ValidationIssue } from "../curriculum/validation.js";
import { LANGUAGE_PROFILE_V2_SCHEMA_VERSION, languageProfileV2Schema, type LanguageProfileV2 } from "./language-profile-v2.js";
import { REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION } from "./requirement-evidence-targets.js";

// Readonly is local to S3A's append-only records; it does not change S1/S2 types.
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const snapshotRefSchema = z.object({
  profileId: domainIdSchema,
  version: semanticVersionSchema,
  schemaVersion: z.literal(LANGUAGE_PROFILE_V2_SCHEMA_VERSION),
  contractVersion: z.literal(REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION),
  status: z.enum(["draft", "review", "canonical", "deprecated"]),
  contentSha256: shaSchema,
}).strict();
const originSchema = z.object({
  kind: z.enum(["manual", "generated", "researched", "corrected"]),
  originRef: domainIdSchema,
  runRef: domainIdSchema.optional(),
}).strict();
const candidateSchema = z.object({
  candidateSha256: shaSchema,
  snapshotJson: z.string(),
  snapshot: snapshotRefSchema,
  lineage: z.object({
    source: snapshotRefSchema,
    parentCanonical: snapshotRefSchema.nullable(),
    origin: originSchema,
  }).strict(),
}).strict();

export const profileReviewDecisionV2Schema = z.object({
  candidateSha256: shaSchema,
  contentSha256: shaSchema,
  decision: z.enum(["ACCEPT", "REJECT"]),
  reviewer: z.object({ kind: z.literal("human"), reviewerRef: domainIdSchema }).strict(),
  decidedAt: z.string().datetime({ offset: true }),
  note: z.string().trim().min(1).optional(),
}).strict();

export type ProfileReviewCandidateV2 = Immutable<z.infer<typeof candidateSchema>>;
export type ProfileReviewDecisionV2 = Immutable<z.infer<typeof profileReviewDecisionV2Schema>>;
export type ProfileSnapshotRefV2 = Immutable<z.infer<typeof snapshotRefSchema>>;
export type ProfileLifecycleErrorV2 =
  | "candidate_invalid" | "snapshot_mismatch" | "decision_invalid"
  | "illegal_lifecycle_transition" | "stale_decision" | "lineage_mismatch";
type Failure = { readonly ok: false; readonly code: ProfileLifecycleErrorV2; readonly issues: readonly ValidationIssue[] };
export type ProfileReviewOutcomeV2 = Failure | Immutable<{
  ok: true;
  outcome: "rejected";
  candidate: ProfileReviewCandidateV2;
  decision: ProfileReviewDecisionV2;
  canonical: null;
}> | Immutable<{
  ok: true;
  outcome: "accepted";
  candidate: ProfileReviewCandidateV2;
  decision: ProfileReviewDecisionV2;
  canonical: { snapshotJson: string; snapshot: ProfileSnapshotRefV2 };
}>;

function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
function fail(code: ProfileLifecycleErrorV2, path: string, message: string): Failure {
  return { ok: false, code, issues: [validationIssue(code, path, message)] };
}
function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function snapshotRef(profile: LanguageProfileV2): z.infer<typeof snapshotRefSchema> {
  return {
    profileId: profile.identity.profileId, version: profile.version,
    schemaVersion: LANGUAGE_PROFILE_V2_SCHEMA_VERSION,
    contractVersion: REQUIREMENT_EVIDENCE_TARGET_CATALOG_VERSION,
    status: profile.status, contentSha256: sha(JSON.stringify(profile)),
  };
}
function sameRef(left: ProfileSnapshotRefV2, right: ProfileSnapshotRefV2): boolean {
  return Object.keys(snapshotRefSchema.shape).every((key) =>
    left[key as keyof ProfileSnapshotRefV2] === right[key as keyof ProfileSnapshotRefV2]);
}
function candidateSha(candidate: Omit<z.infer<typeof candidateSchema>, "candidateSha256">): string {
  // Stable field order from our schemas. Array order and normalized profile text
  // remain significant. The digest also binds origin, source and parent context.
  return sha(JSON.stringify({ snapshotJson: candidate.snapshotJson, snapshot: candidate.snapshot, lineage: candidate.lineage }));
}
function parentProfile(input: unknown): LanguageProfileV2 | null | Failure {
  if (input === null) return null;
  const parsed = languageProfileV2Schema.safeParse(input);
  if (!parsed.success || parsed.data.status !== "canonical") {
    return fail("lineage_mismatch", "parentCanonical", "Parent must be an explicit valid canonical snapshot or null for bootstrap.");
  }
  return parsed.data;
}
function checkLineage(candidate: ProfileReviewCandidateV2, profile: LanguageProfileV2, parent: LanguageProfileV2 | null): Failure | null {
  const { source, parentCanonical } = candidate.lineage;
  if (source.status === "deprecated") {
    return fail("illegal_lifecycle_transition", "lineage.source", "Deprecated snapshots cannot re-enter review.");
  }
  if (source.profileId !== profile.identity.profileId) {
    return fail("lineage_mismatch", "lineage.source", "Source and candidate must retain the same profileId.");
  }
  if (parent === null ? parentCanonical !== null : parentCanonical === null || !sameRef(parentCanonical, snapshotRef(parent))) {
    return fail("lineage_mismatch", "lineage.parentCanonical", "The supplied current canonical must match the candidate's exact parent binding.");
  }
  if (source.status === "canonical" && (parentCanonical === null || !sameRef(source, parentCanonical))) {
    return fail("lineage_mismatch", "lineage.source", "A canonical source must be the exact parent canonical.");
  }
  if (parent !== null && (parent.identity.profileId !== profile.identity.profileId ||
    parent.identity.languageId !== profile.identity.languageId || parent.identity.varietyId !== profile.identity.varietyId ||
    parent.version === profile.version)) {
    return fail("lineage_mismatch", "lineage.parentCanonical", "A revision must preserve stable identity and use a distinct content version.");
  }
  return null;
}

/** Normalize and seal what will be reviewed. No decision or approval is inferred.
 * The proposed version is explicit and fixed before review, never during ACCEPT.
 */
export function createProfileReviewCandidateV2(input: unknown): Failure | { readonly ok: true; readonly candidate: ProfileReviewCandidateV2 } {
  const parsed = z.object({
    profile: languageProfileV2Schema,
    proposedVersion: semanticVersionSchema,
    origin: originSchema,
    parentCanonical: z.unknown().refine((value) => value !== undefined, "An explicit parent or null is required"),
  }).strict().safeParse(input);
  if (!parsed.success) return fail("candidate_invalid", "candidate", parsed.error.message);
  const { profile, proposedVersion, origin } = parsed.data;
  if (profile.status === "deprecated") {
    return fail("illegal_lifecycle_transition", "profile.status", "Deprecated profiles cannot silently return to review.");
  }
  const parent = parentProfile(parsed.data.parentCanonical);
  if (parent !== null && "ok" in parent) return parent;
  const review = languageProfileV2Schema.parse({ ...profile, version: proposedVersion, status: "review" });
  const content = {
    snapshotJson: JSON.stringify(review), snapshot: snapshotRef(review),
    lineage: { source: snapshotRef(profile), parentCanonical: parent === null ? null : snapshotRef(parent), origin },
  };
  const candidate = { candidateSha256: candidateSha(content), ...content };
  const lineageError = checkLineage(candidate, review, parent);
  if (lineageError) return lineageError;
  return freeze({ ok: true as const, candidate });
}

/** Apply an explicit human decision to its exact review snapshot. This is a pure
 * contract boundary, not authentication or a persistence/concurrency boundary.
 */
export function reviewProfileCandidateV2(
  candidateInput: unknown, decisionInput: unknown, currentCanonical: unknown,
): ProfileReviewOutcomeV2 {
  const parsedCandidate = candidateSchema.safeParse(candidateInput);
  if (!parsedCandidate.success) return fail("candidate_invalid", "candidate", parsedCandidate.error.message);
  const candidate = parsedCandidate.data;
  if (sha(candidate.snapshotJson) !== candidate.snapshot.contentSha256 || candidateSha(candidate) !== candidate.candidateSha256) {
    return fail("snapshot_mismatch", "candidate", "Snapshot or review context changed after the candidate was sealed.");
  }
  let raw: unknown;
  try { raw = JSON.parse(candidate.snapshotJson); }
  catch { return fail("candidate_invalid", "snapshotJson", "Snapshot must be valid JSON."); }
  const parsedProfile = languageProfileV2Schema.safeParse(raw);
  if (!parsedProfile.success) return fail("candidate_invalid", "snapshotJson", parsedProfile.error.message);
  const profile = parsedProfile.data;
  if (!sameRef(candidate.snapshot, snapshotRef(profile)) || JSON.stringify(profile) !== candidate.snapshotJson) {
    return fail("snapshot_mismatch", "snapshot", "Snapshot must match its exact normalized S1 content and identity.");
  }
  if (profile.status !== "review") {
    return fail("illegal_lifecycle_transition", "snapshot.status", "Only review candidates are eligible for a human decision.");
  }
  const parsedDecision = profileReviewDecisionV2Schema.safeParse(decisionInput);
  if (!parsedDecision.success) return fail("decision_invalid", "decision", parsedDecision.error.message);
  const decision = parsedDecision.data;
  if (decision.contentSha256 !== candidate.snapshot.contentSha256) {
    return fail("snapshot_mismatch", "decision.contentSha256", "Decision refers to another content snapshot.");
  }
  if (decision.candidateSha256 !== candidate.candidateSha256) {
    return fail("stale_decision", "decision.candidateSha256", "Decision refers to another candidate or lineage context.");
  }
  const parent = parentProfile(currentCanonical);
  if (parent !== null && "ok" in parent) return parent;
  const lineageError = checkLineage(candidate, profile, parent);
  if (lineageError) return lineageError;
  if (decision.decision === "REJECT") {
    return freeze({ ok: true as const, outcome: "rejected" as const, candidate, decision, canonical: null });
  }
  // The approved proposed version and all content are preserved. Only the
  // lifecycle state changes; both review and canonical hashes remain auditable.
  const canonical = languageProfileV2Schema.safeParse({ ...profile, status: "canonical" });
  if (!canonical.success) return fail("candidate_invalid", "canonical", canonical.error.message);
  return freeze({
    ok: true as const, outcome: "accepted" as const, candidate, decision,
    canonical: { snapshotJson: JSON.stringify(canonical.data), snapshot: snapshotRef(canonical.data) },
  });
}
