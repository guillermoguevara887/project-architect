ALTER TABLE "language_lessons"
  ADD COLUMN "learning_status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN "difficulty" text,
  ADD CONSTRAINT "language_lessons_learning_status_check"
    CHECK ("learning_status" IN ('pending', 'in_progress', 'completed')),
  ADD CONSTRAINT "language_lessons_difficulty_check"
    CHECK (
      "difficulty" IS NULL
      OR "difficulty" IN ('easy', 'normal', 'hard')
    );
