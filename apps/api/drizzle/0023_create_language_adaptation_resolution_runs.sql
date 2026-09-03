CREATE TABLE language_adaptation_resolution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  curriculum_unit_record_id uuid NOT NULL REFERENCES language_curriculum_units(id),
  profile_record_id uuid NOT NULL REFERENCES language_knowledge_profiles(id),
  registry_record_id uuid NOT NULL REFERENCES language_decision_registry_versions(id),
  previous_run_id uuid REFERENCES language_adaptation_resolution_runs(id),
  stage text NOT NULL,
  adaptation_plan jsonb NOT NULL,
  active_research_task_ref text,
  blocked_research_task_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposal_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail text,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_adaptation_resolution_runs_stage_check
    CHECK (stage IN (
      'awaiting_decision_review',
      'awaiting_profile_research',
      'awaiting_external_research',
      'awaiting_upstream_research',
      'ready_for_planning',
      'failed'
    )),
  CONSTRAINT language_adaptation_resolution_runs_plan_check
    CHECK (jsonb_typeof(adaptation_plan) = 'object'),
  CONSTRAINT language_adaptation_resolution_runs_blocked_tasks_check
    CHECK (jsonb_typeof(blocked_research_task_refs) = 'array'),
  CONSTRAINT language_adaptation_resolution_runs_proposal_ids_check
    CHECK (jsonb_typeof(proposal_ids) = 'array'),
  CONSTRAINT language_adaptation_resolution_runs_sha_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT language_adaptation_resolution_runs_stage_payload_check
    CHECK (
      (stage = 'awaiting_decision_review'
        AND active_research_task_ref IS NOT NULL
        AND jsonb_array_length(proposal_ids) = 1)
      OR
      (stage IN ('awaiting_profile_research', 'awaiting_external_research')
        AND active_research_task_ref IS NULL
        AND jsonb_array_length(blocked_research_task_refs) > 0
        AND jsonb_array_length(proposal_ids) = 0)
      OR
      (stage = 'awaiting_upstream_research'
        AND jsonb_array_length(proposal_ids) = 0)
      OR
      (stage = 'ready_for_planning'
        AND active_research_task_ref IS NULL
        AND jsonb_array_length(blocked_research_task_refs) = 0
        AND jsonb_array_length(proposal_ids) = 0)
      OR
      stage = 'failed'
    )
);

CREATE INDEX language_adaptation_resolution_runs_user_created_idx
  ON language_adaptation_resolution_runs(user_id, created_at DESC);

CREATE INDEX language_adaptation_resolution_runs_unit_created_idx
  ON language_adaptation_resolution_runs(
    user_id,
    curriculum_unit_record_id,
    created_at DESC
  );

CREATE INDEX language_adaptation_resolution_runs_previous_idx
  ON language_adaptation_resolution_runs(previous_run_id)
  WHERE previous_run_id IS NOT NULL;
