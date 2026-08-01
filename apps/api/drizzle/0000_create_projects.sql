CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "project_type" AS ENUM ('research', 'competition');

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "project_type" "project_type" NOT NULL,
  "global_objective" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "projects_created_at_idx" ON "projects" ("created_at" DESC);
