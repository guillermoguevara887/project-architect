CREATE TYPE "discovery_status" AS ENUM (
  'not_started',
  'in_progress',
  'ready_for_review',
  'completed'
);

CREATE TYPE "discovery_question_type" AS ENUM (
  'short_text',
  'long_text',
  'number',
  'date',
  'single_select',
  'multi_select',
  'yes_no'
);

CREATE TABLE "discovery_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "status" "discovery_status" DEFAULT 'in_progress' NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_sessions_current_step_check" CHECK ("current_step" >= 0)
);

CREATE UNIQUE INDEX "discovery_sessions_project_id_unique"
  ON "discovery_sessions" ("project_id");
CREATE INDEX "discovery_sessions_status_idx"
  ON "discovery_sessions" ("status");

CREATE TABLE "discovery_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "discovery_session_id" uuid NOT NULL
    REFERENCES "discovery_sessions"("id") ON DELETE CASCADE,
  "question_key" text NOT NULL,
  "question_text" text NOT NULL,
  "category" text NOT NULL,
  "section_key" text NOT NULL,
  "section_title" text NOT NULL,
  "question_type" "discovery_question_type" NOT NULL,
  "options" jsonb,
  "position" integer NOT NULL,
  "section_position" integer NOT NULL,
  "is_required" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_questions_position_check" CHECK ("position" >= 0),
  CONSTRAINT "discovery_questions_section_position_check"
    CHECK ("section_position" >= 0)
);

CREATE UNIQUE INDEX "discovery_questions_session_key_unique"
  ON "discovery_questions" ("discovery_session_id", "question_key");
CREATE INDEX "discovery_questions_session_position_idx"
  ON "discovery_questions"
  ("discovery_session_id", "section_position", "position");

CREATE TABLE "discovery_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "question_id" uuid NOT NULL
    REFERENCES "discovery_questions"("id") ON DELETE CASCADE,
  "answer" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "discovery_answers_question_id_unique"
  ON "discovery_answers" ("question_id");
