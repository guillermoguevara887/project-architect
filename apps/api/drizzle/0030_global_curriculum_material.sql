DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM language_curriculum_documents) THEN
    RAISE EXCEPTION '0030 cannot assign global curriculum slots to legacy user-owned documents; reconcile explicitly before migration';
  END IF;
END $$;

DROP INDEX language_curriculum_documents_user_document_unique;
DROP INDEX language_curriculum_documents_user_created_at_idx;
ALTER TABLE language_curriculum_documents DROP CONSTRAINT language_curriculum_documents_user_id_fkey;
ALTER TABLE language_curriculum_documents RENAME COLUMN user_id TO uploaded_by_user_id;
ALTER TABLE language_curriculum_documents ALTER COLUMN uploaded_by_user_id DROP NOT NULL;
ALTER TABLE language_curriculum_documents ADD CONSTRAINT language_curriculum_documents_uploaded_by_user_id_fkey
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE language_curriculum_documents ADD COLUMN unit_order integer NOT NULL;
ALTER TABLE language_curriculum_documents ADD COLUMN unit_id text NOT NULL;
ALTER TABLE language_curriculum_documents ADD CONSTRAINT language_curriculum_documents_level_check
  CHECK (level_id IN ('A1', 'A2', 'B1', 'B2', 'C1'));
ALTER TABLE language_curriculum_documents ADD CONSTRAINT language_curriculum_documents_order_check
  CHECK (unit_order > 0);
ALTER TABLE language_curriculum_documents ADD CONSTRAINT language_curriculum_documents_unit_identity_check
  CHECK (unit_id = level_id || '-U' || CASE WHEN unit_order < 10 THEN '0' ELSE '' END || unit_order::text);
ALTER TABLE language_curriculum_documents ADD CONSTRAINT language_curriculum_documents_curriculum_check
  CHECK (curriculum_id = 'memoos-core-language');
CREATE UNIQUE INDEX language_curriculum_documents_slot_unique
  ON language_curriculum_documents(curriculum_id, level_id, unit_id);
CREATE UNIQUE INDEX language_curriculum_documents_order_unique
  ON language_curriculum_documents(curriculum_id, level_id, unit_order);
CREATE UNIQUE INDEX language_curriculum_documents_document_unique
  ON language_curriculum_documents(document_id);

CREATE FUNCTION language_curriculum_documents_enforce_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.curriculum_id, NEW.level_id, NEW.unit_id, NEW.unit_order, NEW.document_id)
       IS DISTINCT FROM (OLD.curriculum_id, OLD.level_id, OLD.unit_id, OLD.unit_order, OLD.document_id) THEN
      RAISE EXCEPTION 'Curriculum slot identity is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'language_curriculum_documents_identity_immutable';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.curriculum_id), hashtext(NEW.level_id));
  IF NEW.unit_order <> (
    SELECT COALESCE(MAX(unit_order), 0) + 1
    FROM language_curriculum_documents
    WHERE curriculum_id = NEW.curriculum_id AND level_id = NEW.level_id
  ) THEN
    RAISE EXCEPTION 'Curriculum units must be inserted in sequence'
      USING ERRCODE = '23514', CONSTRAINT = 'language_curriculum_documents_sequential_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER language_curriculum_documents_sequence_trigger
  BEFORE INSERT OR UPDATE ON language_curriculum_documents
  FOR EACH ROW EXECUTE FUNCTION language_curriculum_documents_enforce_sequence();

ALTER TABLE language_curriculum_document_versions ADD CONSTRAINT language_curriculum_document_versions_neutral_check
  CHECK (source_language_hint IS NULL);

CREATE UNIQUE INDEX language_curriculum_compilation_runs_active_version_unique
  ON language_curriculum_compilation_runs(document_version_id)
  WHERE status IN ('running', 'ready');
CREATE UNIQUE INDEX language_curriculum_units_run_single_unit_unique
  ON language_curriculum_units(compilation_run_id);

ALTER TABLE language_curriculum_unit_reviews DROP CONSTRAINT language_curriculum_unit_reviews_user_id_fkey;
DROP INDEX language_curriculum_unit_reviews_user_reviewed_idx;
ALTER TABLE language_curriculum_unit_reviews RENAME COLUMN user_id TO reviewed_by_user_id;
ALTER TABLE language_curriculum_unit_reviews ALTER COLUMN reviewed_by_user_id DROP NOT NULL;
ALTER TABLE language_curriculum_unit_reviews ADD CONSTRAINT language_curriculum_unit_reviews_reviewed_by_user_id_fkey
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX language_curriculum_unit_reviews_reviewed_at_idx
  ON language_curriculum_unit_reviews(reviewed_at DESC);
