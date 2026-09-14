-- S3B only. Exact S3A JSON is TEXT; JSONB stores envelope/decision metadata.
CREATE SEQUENCE language_profile_v2_event_sequence;

CREATE TABLE language_profile_v2_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint NOT NULL DEFAULT nextval('language_profile_v2_event_sequence') UNIQUE,
  profile_id text NOT NULL CHECK (length(btrim(profile_id)) > 0),
  version text NOT NULL CHECK (length(btrim(version)) > 0),
  schema_version text NOT NULL CHECK (schema_version = '2.0.0'),
  contract_version text NOT NULL CHECK (contract_version = '1.0.0'),
  status text NOT NULL CHECK (status = 'review'),
  snapshot_json text NOT NULL CHECK (jsonb_typeof(snapshot_json::jsonb) = 'object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[0-9a-f]{64}$'),
  lineage jsonb NOT NULL CHECK (jsonb_typeof(lineage) = 'object'),
  parent_canonical_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lpv2_candidates_context_unique UNIQUE (candidate_sha256),
  CONSTRAINT lpv2_candidates_id_profile_unique UNIQUE (id, profile_id)
);

CREATE TABLE language_profile_v2_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint NOT NULL DEFAULT nextval('language_profile_v2_event_sequence') UNIQUE,
  profile_id text NOT NULL,
  candidate_record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('ACCEPT', 'REJECT')),
  decision_json jsonb NOT NULL CHECK (jsonb_typeof(decision_json) = 'object'),
  canonical_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lpv2_decisions_terminal_unique UNIQUE (candidate_record_id),
  CONSTRAINT lpv2_decisions_candidate_fk FOREIGN KEY (candidate_record_id, profile_id)
    REFERENCES language_profile_v2_candidates(id, profile_id),
  CONSTRAINT lpv2_decisions_outcome_check CHECK (
    (action = 'ACCEPT' AND canonical_record_id IS NOT NULL) OR
    (action = 'REJECT' AND canonical_record_id IS NULL)
  ),
  CONSTRAINT lpv2_decisions_id_canonical_unique UNIQUE (id, canonical_record_id),
  CONSTRAINT lpv2_decisions_id_candidate_profile_unique UNIQUE (id, candidate_record_id, profile_id)
);

CREATE TABLE language_profile_v2_canonicals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint NOT NULL DEFAULT nextval('language_profile_v2_event_sequence') UNIQUE,
  profile_id text NOT NULL CHECK (length(btrim(profile_id)) > 0),
  version text NOT NULL CHECK (length(btrim(version)) > 0),
  schema_version text NOT NULL CHECK (schema_version = '2.0.0'),
  contract_version text NOT NULL CHECK (contract_version = '1.0.0'),
  status text NOT NULL CHECK (status = 'canonical'),
  snapshot_json text NOT NULL CHECK (jsonb_typeof(snapshot_json::jsonb) = 'object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_record_id uuid NOT NULL UNIQUE,
  decision_record_id uuid NOT NULL UNIQUE,
  parent_canonical_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lpv2_canonicals_version_unique UNIQUE (profile_id, version),
  CONSTRAINT lpv2_canonicals_id_profile_unique UNIQUE (id, profile_id),
  CONSTRAINT lpv2_canonicals_id_decision_unique UNIQUE (id, decision_record_id),
  CONSTRAINT lpv2_canonicals_candidate_fk FOREIGN KEY (candidate_record_id, profile_id)
    REFERENCES language_profile_v2_candidates(id, profile_id),
  CONSTRAINT lpv2_canonicals_parent_fk FOREIGN KEY (parent_canonical_record_id, profile_id)
    REFERENCES language_profile_v2_canonicals(id, profile_id),
  CONSTRAINT lpv2_canonicals_decision_candidate_fk FOREIGN KEY (decision_record_id, candidate_record_id, profile_id)
    REFERENCES language_profile_v2_decisions(id, candidate_record_id, profile_id),
  -- A canonical must be the canonical promised by its ACCEPT, never a REJECT.
  CONSTRAINT lpv2_canonicals_accept_fk FOREIGN KEY (decision_record_id, id)
    REFERENCES language_profile_v2_decisions(id, canonical_record_id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE language_profile_v2_candidates
  ADD CONSTRAINT lpv2_candidates_parent_fk FOREIGN KEY (parent_canonical_record_id, profile_id)
  REFERENCES language_profile_v2_canonicals(id, profile_id);

-- An ACCEPT cannot commit without its corresponding canonical (and vice versa).
ALTER TABLE language_profile_v2_decisions
  ADD CONSTRAINT lpv2_decisions_canonical_fk FOREIGN KEY (canonical_record_id, id)
  REFERENCES language_profile_v2_canonicals(id, decision_record_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX lpv2_canonicals_one_bootstrap
  ON language_profile_v2_canonicals(profile_id) WHERE parent_canonical_record_id IS NULL;
CREATE UNIQUE INDEX lpv2_canonicals_one_child
  ON language_profile_v2_canonicals(parent_canonical_record_id) WHERE parent_canonical_record_id IS NOT NULL;
CREATE INDEX lpv2_candidates_history_idx ON language_profile_v2_candidates(profile_id, event_sequence);
CREATE INDEX lpv2_decisions_history_idx ON language_profile_v2_decisions(profile_id, event_sequence);
CREATE INDEX lpv2_canonicals_current_idx ON language_profile_v2_canonicals(profile_id, event_sequence DESC);
