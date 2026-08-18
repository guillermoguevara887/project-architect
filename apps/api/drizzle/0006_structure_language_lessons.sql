ALTER TABLE "language_lessons"
  ADD COLUMN "status" text DEFAULT 'draft' NOT NULL,
  ADD COLUMN "structured_content" jsonb,
  ADD COLUMN "processed_at" timestamp with time zone,
  ADD CONSTRAINT "language_lessons_status_check"
    CHECK ("status" IN ('draft', 'processing', 'ready', 'failed')),
  ADD CONSTRAINT "language_lessons_ready_content_check"
    CHECK (
      "status" <> 'ready'
      OR ("structured_content" IS NOT NULL AND "processed_at" IS NOT NULL)
    );
