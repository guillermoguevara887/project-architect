CREATE TABLE "language_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "language" text NOT NULL,
  "level" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "language_projects_user_created_at_idx"
  ON "language_projects" ("user_id", "created_at" DESC);

CREATE TABLE "language_lessons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "language_project_id" uuid NOT NULL
    REFERENCES "language_projects" ("id") ON DELETE CASCADE,
  "lesson_number" integer NOT NULL,
  "source_content" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "language_lessons_number_check" CHECK ("lesson_number" > 0)
);

CREATE UNIQUE INDEX "language_lessons_project_number_unique"
  ON "language_lessons" ("language_project_id", "lesson_number");
