CREATE TABLE language_profile_research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adaptation_resolution_run_id uuid NOT NULL REFERENCES language_adaptation_resolution_runs(id),
  resumed_resolution_run_id uuid REFERENCES language_adaptation_resolution_runs(id),
  base_profile_record_id uuid NOT NULL REFERENCES language_knowledge_profiles(id),
  enriched_profile_record_id uuid REFERENCES language_knowledge_profiles(id),
  stage text NOT NULL,
  research_task_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate jsonb,
  observed_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_model text,
  validation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail text,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_profile_research_runs_stage_check
    CHECK (stage IN ('completed', 'needs_review', 'failed')),
  CONSTRAINT language_profile_research_runs_tasks_array_check
    CHECK (jsonb_typeof(research_task_refs) = 'array'),
  CONSTRAINT language_profile_research_runs_urls_array_check
    CHECK (jsonb_typeof(observed_urls) = 'array'),
  CONSTRAINT language_profile_research_runs_validation_array_check
    CHECK (jsonb_typeof(validation_history) = 'array')
);

CREATE INDEX language_profile_research_runs_user_created_idx
  ON language_profile_research_runs(user_id, created_at DESC);

CREATE INDEX language_profile_research_runs_resolution_idx
  ON language_profile_research_runs(adaptation_resolution_run_id, created_at DESC);
