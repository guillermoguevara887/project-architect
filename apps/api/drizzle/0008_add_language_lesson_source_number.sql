ALTER TABLE "language_lessons"
  ADD COLUMN "source_lesson_number" integer;

WITH "numbered_lessons" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "language_project_id", "lesson_source"
      ORDER BY "lesson_number"
    )::integer AS "source_lesson_number"
  FROM "language_lessons"
)
UPDATE "language_lessons" AS "lesson"
SET "source_lesson_number" = "numbered_lessons"."source_lesson_number"
FROM "numbered_lessons"
WHERE "lesson"."id" = "numbered_lessons"."id";

ALTER TABLE "language_lessons"
  ALTER COLUMN "source_lesson_number" SET NOT NULL,
  ADD CONSTRAINT "language_lessons_source_number_check"
    CHECK ("source_lesson_number" > 0);

CREATE UNIQUE INDEX "language_lessons_project_source_number_unique"
  ON "language_lessons" (
    "language_project_id",
    "lesson_source",
    "source_lesson_number"
  );
