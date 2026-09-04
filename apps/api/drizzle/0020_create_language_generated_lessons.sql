CREATE TABLE language_lesson_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_spec_id text NOT NULL,
  lesson_spec_version text NOT NULL,
  language_id text NOT NULL,
  variety_id text NOT NULL,
  level_id text NOT NULL,
  unit_id text NOT NULL,
  route_node_ref text NOT NULL,
  generation_intent text NOT NULL,
  lesson_spec jsonb NOT NULL,
  generator_key text NOT NULL,
  provider text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'running',
  attempts integer,
  validation_history jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT language_lesson_generation_runs_status_check
    CHECK (status IN ('running', 'ready', 'failed')),
  CONSTRAINT language_lesson_generation_runs_intent_check
    CHECK (generation_intent IN ('canonical', 'variant', 'regeneration', 'simplified_variant')),
  CONSTRAINT language_lesson_generation_runs_spec_check
    CHECK (jsonb_typeof(lesson_spec) = 'object'),
  CONSTRAINT language_lesson_generation_runs_history_check
    CHECK (validation_history IS NULL OR jsonb_typeof(validation_history) = 'array'),
  CONSTRAINT language_lesson_generation_runs_attempts_check
    CHECK (attempts IS NULL OR attempts BETWEEN 1 AND 3),
  CONSTRAINT language_lesson_generation_runs_state_check
    CHECK (
      (status = 'running' AND completed_at IS NULL AND error_code IS NULL)
      OR (status = 'ready' AND completed_at IS NOT NULL AND attempts IS NOT NULL AND error_code IS NULL)
      OR (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
    )
);

CREATE INDEX language_lesson_generation_runs_user_started_idx
  ON language_lesson_generation_runs (user_id, started_at DESC);

CREATE INDEX language_lesson_generation_runs_lesson_spec_idx
  ON language_lesson_generation_runs (user_id, lesson_spec_id, lesson_spec_version, started_at DESC);

CREATE TABLE language_generated_lessons (
  id uuid PRIMARY KEY,
  generation_run_id uuid NOT NULL UNIQUE
    REFERENCES language_lesson_generation_runs(id) ON DELETE CASCADE,
  generated_lesson jsonb NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_generated_lessons_payload_check
    CHECK (jsonb_typeof(generated_lesson) = 'object'),
  CONSTRAINT language_generated_lessons_sha_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX language_generated_lessons_created_idx
  ON language_generated_lessons (created_at DESC);
