ALTER TABLE "architect_projects"
  ADD COLUMN "name" text,
  ADD COLUMN "objective" text,
  ADD COLUMN "status" text;

ALTER TABLE "architect_projects"
  ADD CONSTRAINT "architect_projects_status_check"
  CHECK ("status" IS NULL OR "status" IN ('idea', 'in_progress', 'completed'));

CREATE TABLE "project_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "architect_projects" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "project_links_project_created_at_idx"
  ON "project_links" ("project_id", "created_at");
