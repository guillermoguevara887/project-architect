CREATE TABLE IF NOT EXISTS language_curriculum_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id text NOT NULL,
  curriculum_id text NOT NULL,
  level_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS language_curriculum_documents_user_document_unique
  ON language_curriculum_documents(user_id, document_id);

CREATE INDEX IF NOT EXISTS language_curriculum_documents_user_created_at_idx
  ON language_curriculum_documents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS language_curriculum_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_record_id uuid NOT NULL REFERENCES language_curriculum_documents(id) ON DELETE CASCADE,
  document_version text NOT NULL,
  source_title text NOT NULL,
  source_language_hint text,
  source_format text NOT NULL,
  original_filename text NOT NULL,
  media_type text NOT NULL,
  storage_key text NOT NULL,
  content_sha256 text NOT NULL,
  byte_size integer NOT NULL,
  storage_status text NOT NULL DEFAULT 'pending',
  extracted_text text,
  extracted_text_sha256 text,
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_curriculum_document_versions_source_format_check
    CHECK (source_format IN ('pdf_extracted_text', 'docx_extracted_text', 'plain_text', 'other_extracted_text')),
  CONSTRAINT language_curriculum_document_versions_storage_status_check
    CHECK (storage_status IN ('pending', 'ready', 'failed')),
  CONSTRAINT language_curriculum_document_versions_extraction_status_check
    CHECK (extraction_status IN ('pending', 'ready', 'failed')),
  CONSTRAINT language_curriculum_document_versions_content_sha256_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT language_curriculum_document_versions_extracted_sha256_check
    CHECK (extracted_text_sha256 IS NULL OR extracted_text_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT language_curriculum_document_versions_byte_size_check
    CHECK (byte_size > 0),
  CONSTRAINT language_curriculum_document_versions_extraction_state_check
    CHECK (
      (extraction_status = 'ready' AND extracted_text IS NOT NULL AND length(btrim(extracted_text)) > 0 AND extracted_text_sha256 IS NOT NULL)
      OR
      (extraction_status <> 'ready' AND extracted_text IS NULL AND extracted_text_sha256 IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS language_curriculum_document_versions_document_version_unique
  ON language_curriculum_document_versions(document_record_id, document_version);

CREATE UNIQUE INDEX IF NOT EXISTS language_curriculum_document_versions_storage_key_unique
  ON language_curriculum_document_versions(storage_key);

CREATE INDEX IF NOT EXISTS language_curriculum_document_versions_document_created_at_idx
  ON language_curriculum_document_versions(document_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS language_curriculum_compilation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES language_curriculum_document_versions(id) ON DELETE CASCADE,
  boundary_key text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  attempts integer,
  validation_history jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT language_curriculum_compilation_runs_status_check
    CHECK (status IN ('running', 'ready', 'failed')),
  CONSTRAINT language_curriculum_compilation_runs_attempts_check
    CHECK (attempts IS NULL OR attempts > 0),
  CONSTRAINT language_curriculum_compilation_runs_state_check
    CHECK (
      (status = 'running' AND completed_at IS NULL AND error_code IS NULL)
      OR
      (status = 'ready' AND completed_at IS NOT NULL AND attempts IS NOT NULL AND error_code IS NULL)
      OR
      (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS language_curriculum_compilation_runs_version_started_at_idx
  ON language_curriculum_compilation_runs(document_version_id, started_at DESC);

CREATE TABLE IF NOT EXISTS language_curriculum_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compilation_run_id uuid NOT NULL REFERENCES language_curriculum_compilation_runs(id) ON DELETE CASCADE,
  unit_id text NOT NULL,
  spec_version text NOT NULL,
  unit_order integer NOT NULL,
  status text NOT NULL,
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_curriculum_units_order_check
    CHECK (unit_order > 0),
  CONSTRAINT language_curriculum_units_status_check
    CHECK (status IN ('draft', 'review', 'canonical', 'deprecated'))
);

CREATE UNIQUE INDEX IF NOT EXISTS language_curriculum_units_run_unit_version_unique
  ON language_curriculum_units(compilation_run_id, unit_id, spec_version);

CREATE UNIQUE INDEX IF NOT EXISTS language_curriculum_units_run_order_unique
  ON language_curriculum_units(compilation_run_id, unit_order);
