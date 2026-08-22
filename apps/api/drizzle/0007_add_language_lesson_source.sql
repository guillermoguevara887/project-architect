ALTER TABLE "language_lessons"
  ADD COLUMN "lesson_source" text DEFAULT 'free' NOT NULL,
  ADD CONSTRAINT "language_lessons_source_check"
    CHECK ("lesson_source" IN ('assimil', 'language_framework', 'free'));
