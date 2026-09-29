import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";

export type AccountDeletionGuard = "eligible" | "already_deleted" | "forbidden_role";
export type AccountDeletionTransactionResult =
  | "deleted"
  | "already_deleted"
  | "forbidden_role"
  | "ownership_violation";

type UserRow = { id: string; role: string };
type KeyRow = { storage_key: string };
type ViolationRow = { violated: boolean };

function rows<T>(result: unknown) { return result as T[]; }

export interface AccountDeletionRepository {
  precheck(userId: string): Promise<AccountDeletionGuard>;
  revokeSessions(userId: string): Promise<AccountDeletionGuard>;
  deleteUnderLock(
    userId: string,
    deleteObjects: (keys: string[]) => Promise<void>,
  ): Promise<AccountDeletionTransactionResult>;
}

export const accountDeletionRepository: AccountDeletionRepository = {
  async precheck(userId) {
    const [user] = rows<UserRow>(await getDb().execute(sql`SELECT id, role FROM users WHERE id=${userId}`));
    if (!user) return "already_deleted";
    return user.role === "user" ? "eligible" : "forbidden_role";
  },

  async revokeSessions(userId) {
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const [updated] = rows<UserRow>(await tx.execute(sql`
        UPDATE users SET session_version=session_version+1
        WHERE id=${userId} AND role='user'
        RETURNING id, role
      `));
      if (updated) return "eligible";
      const [user] = rows<UserRow>(await tx.execute(sql`SELECT id, role FROM users WHERE id=${userId}`));
      return user ? "forbidden_role" : "already_deleted";
    });
  },

  async deleteUnderLock(userId, deleteObjects) {
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      // The user lock is held across preflight, R2 deletion, SQL DELETE, and COMMIT.
      const [user] = rows<UserRow>(await tx.execute(sql`
        SELECT id, role FROM users WHERE id=${userId} FOR UPDATE
      `));
      if (!user) return "already_deleted";
      if (user.role !== "user") return "forbidden_role";

      const [violation] = rows<ViolationRow>(await tx.execute(sql`
        WITH unit_owner AS (
          SELECT u.id, d.user_id
          FROM language_curriculum_units u
          JOIN language_curriculum_compilation_runs c ON c.id=u.compilation_run_id
          JOIN language_curriculum_document_versions v ON v.id=c.document_version_id
          JOIN language_curriculum_documents d ON d.id=v.document_record_id
        ), lesson_owner AS (
          SELECT l.id, p.user_id
          FROM language_lessons l
          JOIN language_projects p ON p.id=l.language_project_id
        ), cross_owner AS (
          SELECT b.user_id AS record_owner, u.user_id AS unit_owner
          FROM language_curriculum_planning_bundles b
          JOIN unit_owner u ON u.id=b.curriculum_unit_record_id
          UNION ALL
          SELECT r.user_id AS record_owner, u.user_id AS unit_owner
          FROM language_curriculum_unit_reviews r
          JOIN unit_owner u ON u.id=r.source_unit_record_id
          UNION ALL
          SELECT r.user_id, b.user_id
          FROM language_curriculum_orchestration_runs r
          JOIN language_curriculum_planning_bundles b ON b.id=r.planning_bundle_id
          UNION ALL
          SELECT child.user_id, parent.user_id
          FROM language_lessons l
          JOIN lesson_owner child ON child.id=l.id
          JOIN lesson_owner parent ON parent.id=l.split_parent_lesson_id
          UNION ALL
          SELECT r.user_id, p.user_id
          FROM language_decision_registry_versions r
          JOIN language_knowledge_profiles p ON p.id=r.profile_record_id
          UNION ALL
          SELECT p.user_id, profile.user_id
          FROM language_decision_proposals p
          JOIN language_knowledge_profiles profile ON profile.id=p.profile_record_id
          UNION ALL
          SELECT p.user_id, registry.user_id
          FROM language_decision_proposals p
          JOIN language_decision_registry_versions registry ON registry.id=p.base_registry_record_id
          UNION ALL
          SELECT p.user_id, registry.user_id
          FROM language_decision_proposals p
          JOIN language_decision_registry_versions registry ON registry.id=p.promoted_registry_record_id
          UNION ALL
          SELECT r.user_id, u.user_id
          FROM language_adaptation_resolution_runs r
          JOIN unit_owner u ON u.id=r.curriculum_unit_record_id
          UNION ALL
          SELECT r.user_id, p.user_id
          FROM language_adaptation_resolution_runs r
          JOIN language_knowledge_profiles p ON p.id=r.profile_record_id
          UNION ALL
          SELECT r.user_id, registry.user_id
          FROM language_adaptation_resolution_runs r
          JOIN language_decision_registry_versions registry ON registry.id=r.registry_record_id
          UNION ALL
          SELECT r.user_id, previous.user_id
          FROM language_adaptation_resolution_runs r
          JOIN language_adaptation_resolution_runs previous ON previous.id=r.previous_run_id
          UNION ALL
          SELECT r.user_id, resolution.user_id
          FROM language_profile_research_runs r
          JOIN language_adaptation_resolution_runs resolution ON resolution.id=r.adaptation_resolution_run_id
          UNION ALL
          SELECT r.user_id, resolution.user_id
          FROM language_profile_research_runs r
          JOIN language_adaptation_resolution_runs resolution ON resolution.id=r.resumed_resolution_run_id
          UNION ALL
          SELECT r.user_id, profile.user_id
          FROM language_profile_research_runs r
          JOIN language_knowledge_profiles profile ON profile.id=r.base_profile_record_id
          UNION ALL
          SELECT r.user_id, profile.user_id
          FROM language_profile_research_runs r
          JOIN language_knowledge_profiles profile ON profile.id=r.enriched_profile_record_id
        )
        SELECT EXISTS (
          SELECT 1 FROM cross_owner
          WHERE (record_owner=${userId} AND unit_owner<>${userId})
             OR (record_owner<>${userId} AND unit_owner=${userId})
        ) AS violated
      `));
      if (violation?.violated) return "ownership_violation";

      const keys = rows<KeyRow>(await tx.execute(sql`
        SELECT storage_key FROM language_audio_assets WHERE user_id=${userId}
        UNION
        SELECT v.storage_key FROM language_curriculum_document_versions v
        JOIN language_curriculum_documents d ON d.id=v.document_record_id
        WHERE d.user_id=${userId}
        ORDER BY storage_key
      `)).map((row) => row.storage_key);

      await deleteObjects(keys);

      const deleted = rows<UserRow>(await tx.execute(sql`
        DELETE FROM users WHERE id=${userId} AND role='user' RETURNING id
      `));
      if (deleted.length !== 1) {
        throw new Error("Account deletion lost its locked target before DELETE.");
      }
      return "deleted";
    });
  },
};
