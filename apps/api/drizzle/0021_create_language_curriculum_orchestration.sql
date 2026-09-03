CREATE TABLE language_curriculum_planning_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  curriculum_unit_record_id uuid NOT NULL
    REFERENCES language_curriculum_units(id) ON DELETE CASCADE,
  language_id text NOT NULL,
  variety_id text NOT NULL,
  level_id text NOT NULL,
  unit_id text NOT NULL,
  curriculum_unit_spec jsonb NOT NULL,
  language_profile jsonb NOT NULL,
  decision_registry jsonb NOT NULL,
  adaptation_plan jsonb NOT NULL,
  adapted_unit_spec jsonb NOT NULL,
  lesson_route jsonb NOT NULL,
  lesson_specs jsonb NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_curriculum_planning_bundles_curriculum_check
    CHECK (jsonb_typeof(curriculum_unit_spec) = 'object'),
  CONSTRAINT language_curriculum_planning_bundles_profile_check
    CHECK (jsonb_typeof(language_profile) = 'object'),
  CONSTRAINT language_curriculum_planning_bundles_registry_check
    CHECK (jsonb_typeof(decision_registry) = 'object'),
  CONSTRAINT language_curriculum_planning_bundles_plan_check
    CHECK (jsonb_typeof(adaptation_plan) = 'object'),
  CONSTRAINT language_curriculum_planning_bundles_adapted_check
    CHECK (jsonb_typeof(adapted_unit_spec) = 'object'),
  CONSTRAINT language_curriculum_planning_bundles_route_check
    CHECK (jsonb_typeof(lesson_route) = 'object'),
  CONSTRAINT language_curriculum_planning_bundles_lessons_check
    CHECK (jsonb_typeof(lesson_specs) = 'array' AND jsonb_array_length(lesson_specs) > 0),
  CONSTRAINT language_curriculum_planning_bundles_sha_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX language_curriculum_planning_bundles_content_unique
  ON language_curriculum_planning_bundles (
    user_id,
    curriculum_unit_record_id,
    language_id,
    variety_id,
    content_sha256
  );

CREATE INDEX language_curriculum_planning_bundles_user_created_idx
  ON language_curriculum_planning_bundles (user_id, created_at DESC);

CREATE TABLE language_curriculum_orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planning_bundle_id uuid NOT NULL
    REFERENCES language_curriculum_planning_bundles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  expected_lesson_count integer NOT NULL,
  generation_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT language_curriculum_orchestration_runs_status_check
    CHECK (status IN ('running', 'ready', 'failed')),
  CONSTRAINT language_curriculum_orchestration_runs_count_check
    CHECK (expected_lesson_count > 0),
  CONSTRAINT language_curriculum_orchestration_runs_generation_ids_check
    CHECK (jsonb_typeof(generation_run_ids) = 'array'),
  CONSTRAINT language_curriculum_orchestration_runs_state_check
    CHECK (
      (status = 'running' AND completed_at IS NULL AND error_code IS NULL)
      OR (status = 'ready' AND completed_at IS NOT NULL AND error_code IS NULL)
      OR (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
    )
);

CREATE INDEX language_curriculum_orchestration_runs_user_started_idx
  ON language_curriculum_orchestration_runs (user_id, started_at DESC);

CREATE INDEX language_curriculum_orchestration_runs_bundle_started_idx
  ON language_curriculum_orchestration_runs (planning_bundle_id, started_at DESC);
