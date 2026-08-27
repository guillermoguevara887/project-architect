ALTER TABLE "exercises"
  ADD COLUMN "guide_structured_content" jsonb,
  ADD COLUMN "guide_generation_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "exercises"
  ADD CONSTRAINT "exercises_guide_structured_content_check"
    CHECK (
      "guide_structured_content" IS NULL
      OR jsonb_typeof("guide_structured_content") = 'object'
    ),
  ADD CONSTRAINT "exercises_guide_generation_count_check"
    CHECK ("guide_generation_count" BETWEEN 0 AND 2);
