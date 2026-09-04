CREATE TABLE language_knowledge_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id text NOT NULL,
  language_id text NOT NULL,
  variety_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL,
  profile jsonb NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_knowledge_profiles_status_check
    CHECK (status IN ('draft', 'review', 'canonical', 'deprecated')),
  CONSTRAINT language_knowledge_profiles_payload_check
    CHECK (jsonb_typeof(profile) = 'object'),
  CONSTRAINT language_knowledge_profiles_sha_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX language_knowledge_profiles_user_profile_version_unique
  ON language_knowledge_profiles(user_id, profile_id, version);

CREATE INDEX language_knowledge_profiles_lookup_idx
  ON language_knowledge_profiles(user_id, language_id, variety_id, created_at DESC);

CREATE TABLE language_decision_registry_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_record_id uuid NOT NULL REFERENCES language_knowledge_profiles(id),
  registry_id text NOT NULL,
  language_id text NOT NULL,
  variety_id text NOT NULL,
  curriculum_id text NOT NULL,
  version text NOT NULL,
  status text NOT NULL,
  registry jsonb NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_decision_registry_versions_status_check
    CHECK (status IN ('draft', 'review', 'canonical', 'deprecated')),
  CONSTRAINT language_decision_registry_versions_payload_check
    CHECK (jsonb_typeof(registry) = 'object'),
  CONSTRAINT language_decision_registry_versions_sha_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX language_decision_registry_versions_user_registry_version_unique
  ON language_decision_registry_versions(user_id, registry_id, version);

CREATE INDEX language_decision_registry_versions_lookup_idx
  ON language_decision_registry_versions(
    user_id,
    language_id,
    variety_id,
    curriculum_id,
    created_at DESC
  );

CREATE TABLE language_decision_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_record_id uuid NOT NULL REFERENCES language_knowledge_profiles(id),
  base_registry_record_id uuid NOT NULL REFERENCES language_decision_registry_versions(id),
  adaptation_plan_id text NOT NULL,
  adaptation_plan_version text NOT NULL,
  research_task_ref text NOT NULL,
  operation text NOT NULL,
  requirement_refs jsonb NOT NULL,
  base_decision_id text,
  base_decision_version text,
  decision_id text NOT NULL,
  decision_version text NOT NULL,
  proposed_decision jsonb NOT NULL,
  proposal_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review',
  review_note text,
  review_evidence_status text,
  review_confidence text,
  reviewed_at timestamptz,
  promoted_registry_record_id uuid REFERENCES language_decision_registry_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_decision_proposals_operation_check
    CHECK (operation IN ('create', 'extend')),
  CONSTRAINT language_decision_proposals_status_check
    CHECK (status IN ('pending_review', 'accepted', 'rejected')),
  CONSTRAINT language_decision_proposals_requirement_refs_check
    CHECK (jsonb_typeof(requirement_refs) = 'array' AND jsonb_array_length(requirement_refs) > 0),
  CONSTRAINT language_decision_proposals_payload_check
    CHECK (jsonb_typeof(proposed_decision) = 'object'),
  CONSTRAINT language_decision_proposals_sha_check
    CHECK (proposal_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT language_decision_proposals_base_ref_check
    CHECK (
      (operation = 'create' AND base_decision_id IS NULL AND base_decision_version IS NULL)
      OR
      (operation = 'extend' AND base_decision_id IS NOT NULL AND base_decision_version IS NOT NULL)
    ),
  CONSTRAINT language_decision_proposals_review_state_check
    CHECK (
      (status = 'pending_review' AND reviewed_at IS NULL AND promoted_registry_record_id IS NULL)
      OR
      (status = 'accepted' AND reviewed_at IS NOT NULL AND promoted_registry_record_id IS NOT NULL
        AND review_note IS NOT NULL AND review_evidence_status IS NOT NULL AND review_confidence IS NOT NULL)
      OR
      (status = 'rejected' AND reviewed_at IS NOT NULL AND promoted_registry_record_id IS NULL
        AND review_note IS NOT NULL)
    )
);

CREATE UNIQUE INDEX language_decision_proposals_user_base_decision_version_sha_unique
  ON language_decision_proposals(
    user_id,
    base_registry_record_id,
    decision_id,
    decision_version,
    proposal_sha256
  );

CREATE INDEX language_decision_proposals_review_queue_idx
  ON language_decision_proposals(user_id, status, created_at ASC);
