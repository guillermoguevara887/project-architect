ALTER TABLE "language_lessons"
  ADD COLUMN "split_parent_lesson_id" uuid,
  ADD COLUMN "split_part" text,
  ADD CONSTRAINT "language_lessons_split_parent_fkey"
    FOREIGN KEY ("split_parent_lesson_id")
    REFERENCES "language_lessons" ("id")
    ON DELETE CASCADE,
  ADD CONSTRAINT "language_lessons_split_pair_check"
    CHECK (
      (
        "split_parent_lesson_id" IS NULL
        AND "split_part" IS NULL
      )
      OR (
        "split_parent_lesson_id" IS NOT NULL
        AND "split_part" IS NOT NULL
        AND "split_part" IN ('A', 'B')
      )
    ),
  ADD CONSTRAINT "language_lessons_split_self_check"
    CHECK (
      "split_parent_lesson_id" IS NULL
      OR "split_parent_lesson_id" <> "id"
    ),
  ADD CONSTRAINT "language_lessons_split_framework_only_check"
    CHECK (
      "split_parent_lesson_id" IS NULL
      OR "lesson_source" = 'language_framework'
    );

DROP INDEX "language_lessons_project_source_number_unique";

CREATE UNIQUE INDEX "language_lessons_project_source_number_unique"
  ON "language_lessons" (
    "language_project_id",
    "lesson_source",
    "source_lesson_number"
  )
  WHERE "split_parent_lesson_id" IS NULL;

CREATE UNIQUE INDEX "language_lessons_split_parent_part_unique"
  ON "language_lessons" (
    "split_parent_lesson_id",
    "split_part"
  )
  WHERE "split_parent_lesson_id" IS NOT NULL;
