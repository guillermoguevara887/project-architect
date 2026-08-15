CREATE TABLE "architect_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "project_type" text NOT NULL,
  "source_text" text,
  "official_url" text,
  "analysis_status" text DEFAULT 'pending' NOT NULL,
  "structured_data" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "architect_projects_project_type_check"
    CHECK ("project_type" IN ('project', 'competition')),
  CONSTRAINT "architect_projects_analysis_status_check"
    CHECK ("analysis_status" IN ('pending', 'completed', 'failed')),
  CONSTRAINT "architect_projects_completed_data_check"
    CHECK ("analysis_status" <> 'completed' OR "structured_data" IS NOT NULL)
);

CREATE INDEX "architect_projects_user_created_at_idx"
  ON "architect_projects" ("user_id", "created_at" DESC);
