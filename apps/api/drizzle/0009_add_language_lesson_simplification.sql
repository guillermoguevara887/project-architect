ALTER TABLE "language_lessons"
  ADD COLUMN "simplified_structured_content" jsonb,
  ADD COLUMN "simplification_started_at" timestamp with time zone,
  ADD COLUMN "simplified_at" timestamp with time zone,
  ADD CONSTRAINT "language_lessons_simplified_content_check"
    CHECK (
      (
        "simplified_structured_content" IS NULL
        AND "simplified_at" IS NULL
      )
      OR (
        "simplified_structured_content" IS NOT NULL
        AND "simplified_at" IS NOT NULL
      )
    );
