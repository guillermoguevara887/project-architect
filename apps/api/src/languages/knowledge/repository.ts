import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import type { LanguageDecisionRegistry } from "../decisions/language-decision-registry.js";
import type { LanguageProfile } from "../profile/language-profile.js";
import type { DecisionProposal } from "./promotion.js";

export type KnowledgeProfileRecord = {
  id: string;
  userId: string;
  profile: LanguageProfile;
  contentSha256: string;
  createdAt: Date;
};

export type KnowledgeRegistryRecord = {
  id: string;
  userId: string;
  profileRecordId: string;
  registry: LanguageDecisionRegistry;
  contentSha256: string;
  createdAt: Date;
};

export type DecisionProposalStatus = "pending_review" | "accepted" | "rejected";

export type DecisionProposalRecord = {
  id: string;
  userId: string;
  profileRecordId: string;
  baseRegistryRecordId: string;
  adaptationPlanRef: { id: string; version: string };
  researchTaskRef: string;
  proposal: DecisionProposal;
  proposalSha256: string;
  status: DecisionProposalStatus;
  reviewNote: string | null;
  reviewEvidenceStatus: string | null;
  reviewConfidence: string | null;
  promotedRegistryRecordId: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
};

export interface LanguageKnowledgeStore {
  createProfile(input: {
    userId: string;
    profile: LanguageProfile;
    contentSha256: string;
  }): Promise<KnowledgeProfileRecord>;
  findProfile(userId: string, profileRecordId: string): Promise<KnowledgeProfileRecord | null>;
  listProfiles(userId: string, languageId?: string, varietyId?: string): Promise<KnowledgeProfileRecord[]>;
  createRegistry(input: {
    userId: string;
    profileRecordId: string;
    registry: LanguageDecisionRegistry;
    contentSha256: string;
  }): Promise<KnowledgeRegistryRecord | null>;
  findRegistry(userId: string, registryRecordId: string): Promise<KnowledgeRegistryRecord | null>;
  listRegistries(userId: string, languageId?: string, varietyId?: string): Promise<KnowledgeRegistryRecord[]>;
  createProposal(input: {
    userId: string;
    profileRecordId: string;
    baseRegistryRecordId: string;
    adaptationPlanRef: { id: string; version: string };
    researchTaskRef: string;
    proposal: DecisionProposal;
    proposalSha256: string;
  }): Promise<DecisionProposalRecord | null>;
  findProposal(userId: string, proposalId: string): Promise<DecisionProposalRecord | null>;
  listProposals(userId: string, status?: DecisionProposalStatus): Promise<DecisionProposalRecord[]>;
  rejectProposal(input: {
    userId: string;
    proposalId: string;
    note: string;
  }): Promise<DecisionProposalRecord | null>;
  acceptProposal(input: {
    userId: string;
    proposalId: string;
    note: string;
    evidenceReviewStatus: "cross_checked" | "human_reviewed";
    confidence: "medium" | "high";
    profileRecordId: string;
    registry: LanguageDecisionRegistry;
    contentSha256: string;
  }): Promise<{ proposal: DecisionProposalRecord; registry: KnowledgeRegistryRecord } | null>;
}

type DbProfile = {
  id: string; user_id: string; profile_record_id?: string; profile_id: string;
  language_id: string; variety_id: string; version: string; status: string;
  profile: LanguageProfile; content_sha256: string; created_at: Date;
};
type DbRegistry = {
  id: string; user_id: string; profile_record_id: string; registry_id: string;
  language_id: string; variety_id: string; curriculum_id: string; version: string;
  status: string; registry: LanguageDecisionRegistry; content_sha256: string; created_at: Date;
};
type DbProposal = {
  id: string; user_id: string; profile_record_id: string; base_registry_record_id: string;
  adaptation_plan_id: string; adaptation_plan_version: string; research_task_ref: string;
  operation: "create" | "extend"; requirement_refs: string[]; base_decision_id: string | null;
  base_decision_version: string | null; decision_id: string; decision_version: string;
  proposed_decision: DecisionProposal["decision"]; proposal_sha256: string;
  status: DecisionProposalStatus; review_note: string | null; review_evidence_status: string | null;
  review_confidence: string | null; promoted_registry_record_id: string | null;
  created_at: Date; reviewed_at: Date | null;
};

function rows<T>(value: unknown) { return value as T[]; }
function mapProfile(row: DbProfile): KnowledgeProfileRecord {
  return { id: row.id, userId: row.user_id, profile: row.profile, contentSha256: row.content_sha256, createdAt: row.created_at };
}
function mapRegistry(row: DbRegistry): KnowledgeRegistryRecord {
  return { id: row.id, userId: row.user_id, profileRecordId: row.profile_record_id, registry: row.registry, contentSha256: row.content_sha256, createdAt: row.created_at };
}
function mapProposal(row: DbProposal): DecisionProposalRecord {
  return {
    id: row.id,
    userId: row.user_id,
    profileRecordId: row.profile_record_id,
    baseRegistryRecordId: row.base_registry_record_id,
    adaptationPlanRef: { id: row.adaptation_plan_id, version: row.adaptation_plan_version },
    researchTaskRef: row.research_task_ref,
    proposal: {
      operation: row.operation,
      requirementRefs: row.requirement_refs,
      ...(row.base_decision_id && row.base_decision_version
        ? { baseDecisionRef: { id: row.base_decision_id, version: row.base_decision_version } }
        : {}),
      decision: row.proposed_decision,
    },
    proposalSha256: row.proposal_sha256,
    status: row.status,
    reviewNote: row.review_note,
    reviewEvidenceStatus: row.review_evidence_status,
    reviewConfidence: row.review_confidence,
    promotedRegistryRecordId: row.promoted_registry_record_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export const languageKnowledgeStore: LanguageKnowledgeStore = {
  async createProfile(input) {
    const inserted = rows<DbProfile>(await getDb().execute(sql`
      INSERT INTO language_knowledge_profiles (
        user_id, profile_id, language_id, variety_id, version, status, profile, content_sha256
      ) VALUES (
        ${input.userId}, ${input.profile.identity.profileId}, ${input.profile.identity.languageId},
        ${input.profile.identity.varietyId}, ${input.profile.version}, ${input.profile.status},
        ${JSON.stringify(input.profile)}::jsonb, ${input.contentSha256}
      ) ON CONFLICT (user_id, profile_id, version) DO NOTHING RETURNING *
    `));
    if (inserted[0]) return mapProfile(inserted[0]);
    const existing = rows<DbProfile>(await getDb().execute(sql`
      SELECT * FROM language_knowledge_profiles
      WHERE user_id=${input.userId} AND profile_id=${input.profile.identity.profileId}
        AND version=${input.profile.version} LIMIT 1
    `));
    if (!existing[0]) throw new Error("profile_persistence_failed");
    return mapProfile(existing[0]);
  },

  async findProfile(userId, profileRecordId) {
    const result = rows<DbProfile>(await getDb().execute(sql`
      SELECT * FROM language_knowledge_profiles WHERE id=${profileRecordId} AND user_id=${userId} LIMIT 1
    `));
    return result[0] ? mapProfile(result[0]) : null;
  },

  async listProfiles(userId, languageId, varietyId) {
    const result = rows<DbProfile>(await getDb().execute(sql`
      SELECT * FROM language_knowledge_profiles
      WHERE user_id=${userId}
        AND (${languageId ?? null}::text IS NULL OR language_id=${languageId ?? null})
        AND (${varietyId ?? null}::text IS NULL OR variety_id=${varietyId ?? null})
      ORDER BY created_at DESC
    `));
    return result.map(mapProfile);
  },

  async createRegistry(input) {
    const result = rows<DbRegistry>(await getDb().execute(sql`
      INSERT INTO language_decision_registry_versions (
        user_id, profile_record_id, registry_id, language_id, variety_id, curriculum_id,
        version, status, registry, content_sha256
      )
      SELECT ${input.userId}, profile.id, ${input.registry.identity.registryId},
        ${input.registry.identity.languageId}, ${input.registry.identity.varietyId},
        ${input.registry.identity.curriculumId}, ${input.registry.version}, ${input.registry.status},
        ${JSON.stringify(input.registry)}::jsonb, ${input.contentSha256}
      FROM language_knowledge_profiles profile
      WHERE profile.id=${input.profileRecordId} AND profile.user_id=${input.userId}
      ON CONFLICT (user_id, registry_id, version) DO NOTHING
      RETURNING *
    `));
    if (result[0]) return mapRegistry(result[0]);
    const existing = rows<DbRegistry>(await getDb().execute(sql`
      SELECT * FROM language_decision_registry_versions
      WHERE user_id=${input.userId} AND registry_id=${input.registry.identity.registryId}
        AND version=${input.registry.version} LIMIT 1
    `));
    return existing[0] ? mapRegistry(existing[0]) : null;
  },

  async findRegistry(userId, registryRecordId) {
    const result = rows<DbRegistry>(await getDb().execute(sql`
      SELECT * FROM language_decision_registry_versions WHERE id=${registryRecordId} AND user_id=${userId} LIMIT 1
    `));
    return result[0] ? mapRegistry(result[0]) : null;
  },

  async listRegistries(userId, languageId, varietyId) {
    const result = rows<DbRegistry>(await getDb().execute(sql`
      SELECT * FROM language_decision_registry_versions
      WHERE user_id=${userId}
        AND (${languageId ?? null}::text IS NULL OR language_id=${languageId ?? null})
        AND (${varietyId ?? null}::text IS NULL OR variety_id=${varietyId ?? null})
      ORDER BY created_at DESC
    `));
    return result.map(mapRegistry);
  },

  async createProposal(input) {
    const baseRef = input.proposal.baseDecisionRef;
    const result = rows<DbProposal>(await getDb().execute(sql`
      INSERT INTO language_decision_proposals (
        user_id, profile_record_id, base_registry_record_id, adaptation_plan_id,
        adaptation_plan_version, research_task_ref, operation, requirement_refs,
        base_decision_id, base_decision_version, decision_id, decision_version,
        proposed_decision, proposal_sha256
      )
      SELECT ${input.userId}, profile.id, registry.id, ${input.adaptationPlanRef.id},
        ${input.adaptationPlanRef.version}, ${input.researchTaskRef}, ${input.proposal.operation},
        ${JSON.stringify(input.proposal.requirementRefs)}::jsonb, ${baseRef?.id ?? null},
        ${baseRef?.version ?? null}, ${input.proposal.decision.identity.decisionId},
        ${input.proposal.decision.identity.decisionVersion},
        ${JSON.stringify(input.proposal.decision)}::jsonb, ${input.proposalSha256}
      FROM language_knowledge_profiles profile
      JOIN language_decision_registry_versions registry
        ON registry.id=${input.baseRegistryRecordId} AND registry.user_id=${input.userId}
      WHERE profile.id=${input.profileRecordId} AND profile.user_id=${input.userId}
        AND registry.profile_record_id=profile.id
      ON CONFLICT (
        user_id, base_registry_record_id, decision_id, decision_version, proposal_sha256
      ) DO NOTHING RETURNING *
    `));
    if (result[0]) return mapProposal(result[0]);
    const existing = rows<DbProposal>(await getDb().execute(sql`
      SELECT * FROM language_decision_proposals
      WHERE user_id=${input.userId} AND base_registry_record_id=${input.baseRegistryRecordId}
        AND decision_id=${input.proposal.decision.identity.decisionId}
        AND decision_version=${input.proposal.decision.identity.decisionVersion}
        AND proposal_sha256=${input.proposalSha256} LIMIT 1
    `));
    return existing[0] ? mapProposal(existing[0]) : null;
  },

  async findProposal(userId, proposalId) {
    const result = rows<DbProposal>(await getDb().execute(sql`
      SELECT * FROM language_decision_proposals WHERE id=${proposalId} AND user_id=${userId} LIMIT 1
    `));
    return result[0] ? mapProposal(result[0]) : null;
  },

  async listProposals(userId, status) {
    const result = rows<DbProposal>(await getDb().execute(sql`
      SELECT * FROM language_decision_proposals
      WHERE user_id=${userId} AND (${status ?? null}::text IS NULL OR status=${status ?? null})
      ORDER BY created_at ASC
    `));
    return result.map(mapProposal);
  },

  async rejectProposal(input) {
    const result = rows<DbProposal>(await getDb().execute(sql`
      UPDATE language_decision_proposals
      SET status='rejected', review_note=${input.note}, reviewed_at=now()
      WHERE id=${input.proposalId} AND user_id=${input.userId} AND status='pending_review'
      RETURNING *
    `));
    return result[0] ? mapProposal(result[0]) : null;
  },

  async acceptProposal(input) {
    return getDb().transaction(async (tx) => {
      const registryRows = rows<DbRegistry>(await tx.execute(sql`
        INSERT INTO language_decision_registry_versions (
          user_id, profile_record_id, registry_id, language_id, variety_id, curriculum_id,
          version, status, registry, content_sha256
        )
        SELECT proposal.user_id, proposal.profile_record_id, ${input.registry.identity.registryId},
          ${input.registry.identity.languageId}, ${input.registry.identity.varietyId},
          ${input.registry.identity.curriculumId}, ${input.registry.version}, ${input.registry.status},
          ${JSON.stringify(input.registry)}::jsonb, ${input.contentSha256}
        FROM language_decision_proposals proposal
        WHERE proposal.id=${input.proposalId} AND proposal.user_id=${input.userId}
          AND proposal.status='pending_review' AND proposal.profile_record_id=${input.profileRecordId}
        ON CONFLICT (user_id, registry_id, version) DO NOTHING
        RETURNING *
      `));
      let registryRow = registryRows[0];
      if (!registryRow) {
        const existing = rows<DbRegistry>(await tx.execute(sql`
          SELECT * FROM language_decision_registry_versions
          WHERE user_id=${input.userId} AND registry_id=${input.registry.identity.registryId}
            AND version=${input.registry.version} AND content_sha256=${input.contentSha256}
          LIMIT 1
        `));
        registryRow = existing[0];
      }
      if (!registryRow) return null;

      const proposalRows = rows<DbProposal>(await tx.execute(sql`
        UPDATE language_decision_proposals
        SET status='accepted', review_note=${input.note},
          review_evidence_status=${input.evidenceReviewStatus}, review_confidence=${input.confidence},
          reviewed_at=now(), promoted_registry_record_id=${registryRow.id}
        WHERE id=${input.proposalId} AND user_id=${input.userId} AND status='pending_review'
        RETURNING *
      `));
      if (!proposalRows[0]) return null;
      return { proposal: mapProposal(proposalRows[0]), registry: mapRegistry(registryRow) };
    });
  },
};
