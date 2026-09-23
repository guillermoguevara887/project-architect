import { createHash } from "node:crypto";

/** Internal integrity primitive, not lifecycle admission. Field order and hash
 * semantics are unchanged; callers must still validate S1, lineage and parent. */
export function profileCandidateContextShaV2(candidate: { snapshotJson: string; snapshot: unknown; lineage: unknown }): string {
  return createHash("sha256").update(JSON.stringify({ snapshotJson: candidate.snapshotJson, snapshot: candidate.snapshot, lineage: candidate.lineage }), "utf8").digest("hex");
}
