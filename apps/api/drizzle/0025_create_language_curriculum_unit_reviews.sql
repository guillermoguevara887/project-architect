CREATE TABLE language_curriculum_unit_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_unit_record_id uuid NOT NULL REFERENCES language_curriculum_units(id) ON DELETE CASCADE,
  action text NOT NULL,
  review_note text NOT NULL,
  promoted_spec jsonb,
  promoted_spec_sha256 text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT language_curriculum_unit_reviews_action_check
    CHECK (action IN ('accepted', 'rejected')),
  CONSTRAINT language_curriculum_unit_reviews_promotion_shape_check
    CHECK (
      (action = 'accepted' AND promoted_spec IS NOT NULL AND promoted_spec_sha256 IS NOT NULL)
      OR
      (action = 'rejected' AND promoted_spec IS NULL AND promoted_spec_sha256 IS NULL)
    ),
  CONSTRAINT language_curriculum_unit_reviews_source_unique
    UNIQUE (source_unit_record_id)
);

CREATE INDEX language_curriculum_unit_reviews_user_reviewed_idx
  ON language_curriculum_unit_reviews(user_id, reviewed_at DESC);
