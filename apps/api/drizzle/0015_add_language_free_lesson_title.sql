ALTER TABLE "language_lessons"
  ADD COLUMN "free_title" text,
  ADD CONSTRAINT "language_lessons_free_title_check"
    CHECK (
      "free_title" IS NULL
      OR length(btrim("free_title")) BETWEEN 1 AND 160
    );

ALTER TABLE "language_lessons"
  DROP CONSTRAINT "language_lessons_ready_content_check",
  ADD CONSTRAINT "language_lessons_ready_content_check"
    CHECK (
      "status" <> 'ready'
      OR (
        "processed_at" IS NOT NULL
        AND (
          "structured_content" IS NOT NULL
          OR (
            "lesson_source" = 'free'
            AND "free_title" IS NOT NULL
            AND length(btrim("source_content")) > 0
          )
        )
      )
    );
