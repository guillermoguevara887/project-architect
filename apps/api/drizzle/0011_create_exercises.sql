CREATE TABLE "exercises" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "source_name" text,
  "chapter" text,
  "exercise_number" text,
  "prompt" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "guide_content" text,
  "suggested_steps" jsonb,
  "workspace_type" text,
  "workspace_value" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "exercises_status_check"
    CHECK ("status" IN ('pending', 'working', 'solved')),
  CONSTRAINT "exercises_workspace_type_check"
    CHECK (
      "workspace_type" IS NULL
      OR "workspace_type" IN ('colab', 'local', 'url')
    ),
  CONSTRAINT "exercises_workspace_pair_check"
    CHECK (
      ("workspace_type" IS NULL AND "workspace_value" IS NULL)
      OR ("workspace_type" IS NOT NULL AND "workspace_value" IS NOT NULL)
    ),
  CONSTRAINT "exercises_suggested_steps_check"
    CHECK (
      "suggested_steps" IS NULL
      OR jsonb_typeof("suggested_steps") = 'array'
    )
);

CREATE INDEX "exercises_user_created_at_idx"
  ON "exercises" ("user_id", "created_at" DESC);
